// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

const IS_DEBUG_MODE = process.env.LOG_LEVEL === 'debug';
console.log(`[SERVER] Debug mode is: ${IS_DEBUG_MODE}`);
crawleeLogger.setLevel(LogLevel.INFO);

function log(message, level = 'info') {
    if (IS_DEBUG_MODE || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function getMovies(lang, genre, searchQuery, skip = 0) {
    const pageNum = Math.floor(skip / 20) + 1;
    const finalUrl = `${BASE_URL}/movie/results/?lang=${lang}&${searchQuery ? `query=${encodeURIComponent(searchQuery)}` : `find=${genre || 'Recent'}`}&page=${pageNum}`;
    log(`Visiting movie list page: ${finalUrl}`);

    const movies = []; // This array will be populated by the handler
    
    const crawler = new CheerioCrawler({
        // --- RATE LIMITING SOLUTION ---
        maxConcurrency: 2, // Only allow 2 requests to run at the same time
        minRequestDelay: 100, // Wait at least 100ms between requests
        maxRequestDelay: 500, // Wait at most 500ms
        
        async requestHandler({ $, body }) {
            // Check if we were rate-limited
            if ($('title').text().includes('Rate Limited')) {
                log(`Got a rate-limit page for [${lang}]. Skipping.`, 'error');
                return;
            }

            const selector = '#UIMovieSummary > ul > li';
            const movieElements = $(selector);
            log(`Found ${movieElements.length} movie elements on the page for [${lang}].`);

            movieElements.each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');

                if (title && href) {
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        log(`  [+] Success: Extracted "${title}"`, 'debug');
                        // Push directly to the `movies` array in the parent scope
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                            type: 'movie',
                            name: title,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                        });
                    }
                }
            });
        }
    });

    await crawler.run([finalUrl]);

    log(`Scraping finished for [${lang}]. Returning ${movies.length} movies.`);
    return movies;
}

async function getMovieMeta(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    log(`Getting meta for ID: ${stremioId} from ${watchUrl}`);
    
    let scrapedMeta = null;

    const crawler = new CheerioCrawler({
        maxRequests: 1, // Only ever one request for this task
        async requestHandler({ $ }) {
            const name = $('div.single-title > h1').text().replace(/Watch Online/, '').trim();
            if (!name) {
                log(`Failed to scrape title for ${stremioId}`, 'error');
                return;
            }
            const posterSrc = $('div.movie-cover-image img').attr('src');
            const poster = posterSrc && !posterSrc.startsWith('http') ? `https:${posterSrc}` : posterSrc;
            const description = $('p.plot').text().trim();
            const getInfo = (label) => $(`div.info > p:contains("${label}")`).text().replace(label, '').replace(':', '').trim();
            
            scrapedMeta = {
                id: stremioId, type: 'movie', name, poster, background: poster, description,
                year: getInfo('Year') || null,
                cast: getInfo('Cast').split(',').map(c => c.trim()).filter(Boolean),
                director: [getInfo('Director')].filter(Boolean),
            };
            log(`Successfully scraped meta for: ${name}`);
        }
    });

    await crawler.run([watchUrl]);
    return scrapedMeta;
}

async function getStreamUrls(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    log(`Getting streams for ID: ${stremioId} from ${watchUrl}`);

    const streams = [];

    const crawler = new CheerioCrawler({
        maxRequests: 1,
        async requestHandler({ $, body }) {
            const videoPlayerHtml = $('#UIVideoPlayer').toString();
            const ejpMatch = videoPlayerHtml.match(/data-ejpingables="([^"]+)"/);
            const rootHtml = $('html').toString();
            const csrfMatch = rootHtml.match(/data-pageid="([^"]+)"/);
            
            const ejp = ejpMatch ? ejpMatch[1] : null;
            const csrfToken = csrfMatch ? csrfMatch[1] : null;

            if (!ejp || !csrfToken) {
                log(`Could not find EJP or CSRF tokens for ${stremioId}.`, 'error');
                return;
            }

            log(`Found EJP and CSRF tokens for ${stremioId}.`, 'debug');
            const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${lang}`;
            const postData = new URLSearchParams({
                'xEvent': 'UIVideoPlayer.PingOutcome',
                'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
                'gorilla.csrf.Token': csrfToken,
            }).toString();

            try {
                const ajaxResponse = await axios.post(ajaxUrl, postData, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': watchUrl,
                    }
                });

                if (ajaxResponse.data?.Data?.EJLinks) {
                    const ejl = ajaxResponse.data.Data.EJLinks;
                    const decodedLnk = Buffer.from(decodeEinth(ejl), 'base64').toString('utf-8');
                    const streamData = JSON.parse(decodedLnk);
                    if (streamData.HLSLink) {
                        streams.push({ title: 'Einthusan SD', url: streamData.HLSLink });
                        log(`Successfully found SD stream for ${stremioId}.`);
                    }
                }
            } catch (error) {
                log(`AJAX request to get stream URL failed: ${error.message}`, 'error');
            }
        }
    });

    await crawler.run([watchUrl]);
    return streams;
}

module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
