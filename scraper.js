// scraper.js
const { CheerioCrawler, Session } = require('crawlee');
const axios = require('axios');
const { getPremiumSession, decodeEinth } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const PROXY_URL = process.env.PROXY_URL;

const IS_DEBUG_MODE = process.env.LOG_LEVEL === 'debug';

function log(message, level = 'info') {
    if (IS_DEBUG_MODE || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

async function scrapePage(lang, pageNum) {
    const finalUrl = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${pageNum}`;
    log(`Scraping page: ${finalUrl}`);
    const movies = [];
    let rateLimited = false;

    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        async requestHandler({ $ }) {
            if ($('title').text().includes('Rate Limited')) {
                log(`Got a rate-limit page for [${lang}].`, 'error');
                rateLimited = true;
                return;
            }
            $('#UIMovieSummary > ul > li').each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        const movieId = idMatch[1];
                        const poster = listItem.find('.block1 img').attr('src');
                        const yearText = listItem.find('.info p').first().text();
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${movieId}`,
                            lang,
                            title,
                            year: yearText ? parseInt(yearText.match(/\d{4}/)?.[0], 10) : null,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                            movie_page_url: `${BASE_URL}${href}`,
                            description: listItem.find('p.synopsis').text().trim(),
                        });
                    }
                }
            });
        }
    });

    await crawler.run([finalUrl]);
    return { movies, rateLimited };
}


async function fetchStream(moviePageUrl, quality, session) {
    log(`Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    let streamInfo = null;
    const urlToVisit = quality === 'HD' ? `${moviePageUrl}&uhd=true` : moviePageUrl;

    const crawler = new CheerioCrawler({
        async requestHandler({ $ }) {
            const videoPlayerHtml = $('#UIVideoPlayer').toString();
            const rootHtml = $('html').toString();
            const ejpMatch = videoPlayerHtml.match(/data-ejpingables="([^"]+)"/);
            const csrfMatch = rootHtml.match(/data-pageid="([^"]+)"/);
            
            const ejp = ejpMatch ? ejpMatch[1] : null;
            const csrfToken = csrfMatch ? csrfMatch[1].replace(/+/g, '+') : null;

            if (!ejp || !csrfToken) {
                log(`Could not find tokens for ${quality} stream.`, 'error');
                return;
            }

            const ajaxUrl = `${BASE_URL}/ajax${new URL(moviePageUrl).pathname}${new URL(moviePageUrl).search}`;
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
                        'X-Requested-With': 'XMLHttpRequest', 'Referer': urlToVisit,
                        'Cookie': session.getCookieString(urlToVisit),
                    }
                });
                if (ajaxResponse.data?.Data?.EJLinks) {
                    const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
                    const streamData = JSON.parse(decodedLnk);
                    if (streamData.HLSLink) {
                        streamInfo = { title: `Einthusan ${quality}`, url: streamData.HLSLink };
                        log(`Successfully found ${quality} stream.`);
                    }
                }
            } catch (error) {
                log(`AJAX request for ${quality} stream failed: ${error.message}`, 'error');
            }
        }
    });

    await crawler.run([{ url: urlToVisit, session: session }]);
    return streamInfo;
}

async function getStreamUrls(moviePageUrl) {
    const streams = [];
    const loggedInSession = await getPremiumSession();

    if (loggedInSession) {
        log('Executing premium user stream search...');
        const hdStream = await fetchStream(moviePageUrl, 'HD', loggedInSession);
        if (hdStream) streams.push(hdStream);
    }
    
    log('Executing standard SD stream search (fallback)...');
    const sdStream = await fetchStream(moviePageUrl, 'SD', new Session()); 
    if (sdStream) {
        if (!streams.find(s => s.url === sdStream.url)) {
            streams.push(sdStream);
        }
    }

    return streams;
}

module.exports = { 
    scrapePage, 
    getStreamUrls,
    ID_PREFIX
};
