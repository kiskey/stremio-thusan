// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel } = require('crawlee');
const axios = require('axios'); // For the final POST request

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

// Silence Crawlee's verbose logging unless our own log level is debug
crawleeLogger.setLevel(process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO);

function log(message, level = 'info') {
    if (process.env.LOG_LEVEL === 'debug' || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

const crawler = new CheerioCrawler({
    preNavigationHooks: [({ request }) => {
        request.headers = {
            ...request.headers,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };
    }],
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 30,
});

async function getLanguages() {
    log('Fetching languages from homepage...');
    const languages = [];
    await crawler.run([{
        url: `${BASE_URL}/`,
        handler: ({ $ }) => {
            $('ul.language-list li a').each((i, el) => {
                const href = $(el).attr('href');
                const langCodeMatch = href.match(/lang=([^&]+)/);
                if (langCodeMatch) {
                    const langCode = langCodeMatch[1];
                    const name = $(el).find('p').text().trim();
                    if (name && langCode) languages.push({ code: langCode, name });
                }
            });
        }
    }]);
    log(`Found ${languages.length} languages.`);
    return languages;
}

async function getMovies(lang, genre, searchQuery) {
    const url = searchQuery
        ? `${BASE_URL}/movie/results/?lang=${lang}&query=${encodeURIComponent(searchQuery)}`
        : `${BASE_URL}/movie/results/?lang=${lang}&find=${genre || 'Recent'}`;
    log(`Scraping movie list from: ${url}`);
    
    const movies = [];
    await crawler.run([{
        url,
        handler: ({ $ }) => {
            $('div.block1').each((i, el) => {
                const link = $(el).find('a.movielink');
                const href = link.attr('href');
                const title = link.find('h3').text().trim();
                const poster = $(el).find('img').attr('src');
                
                const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                if (idMatch && title) {
                    movies.push({
                        id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                        type: 'movie',
                        name: title,
                        poster: poster.startsWith('http') ? poster : `https:${poster}`,
                    });
                }
            });
        }
    }]);
    log(`Found ${movies.length} movies for the request.`);
    return movies;
}

async function getMovieMeta(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    
    log(`Getting meta for ID: ${stremioId} from ${watchUrl}`);
    
    let scrapedMeta = null;
    await crawler.run([{
        url: watchUrl,
        handler: ({ $ }) => {
            const name = $('div.single-title > h2').text().replace(/Watch Online/, '').trim() || $('div.single-title > h1').text().replace(/Watch Online/, '').trim();
            if (!name) {
                log(`Failed to scrape title for ${stremioId}`, 'error');
                return;
            }

            const posterSrc = $('div.movie-cover-image img').attr('src');
            const poster = posterSrc && (posterSrc.startsWith('http') ? posterSrc : `https:${posterSrc}`);
            const description = $('p.plot').text().trim();
            
            // Helper to parse info paragraphs
            const getInfo = (label) => {
                const text = $(`div.info > p:contains("${label}")`).text();
                return text.replace(label, '').replace(':', '').trim();
            };
            
            const year = getInfo('Year');
            const cast = getInfo('Cast').split(',').map(c => c.trim()).filter(Boolean);
            const director = getInfo('Director');

            scrapedMeta = {
                id: stremioId,
                type: 'movie',
                name,
                poster: poster,
                background: poster, // Use poster as fallback for background
                description,
                year: year || null,
                cast: cast.length > 0 ? cast : null,
                director: director ? [director] : null,
            };
            log(`Successfully scraped meta for: ${name}`);
        }
    }]);

    return scrapedMeta;
}


async function getStreamUrl(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    let streamInfo = null;

    // Use Crawler to get the page and tokens to leverage its stealth features
    await crawler.run([{
        url: watchUrl,
        handler: async ({ $, request }) => {
            const ejp = $('section#UIVideoPlayer').attr('data-ejpingables');
            const csrfToken = $('section#UIVideoPlayer').attr('data-pageid');
            
            if (!ejp || !csrfToken) {
                log('Could not find EJP or CSRF token.', 'error');
                return;
            }

            // Use lightweight axios for the final AJAX POST
            const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${lang}`;
            const postData = new URLSearchParams({
                'xEvent': 'UIVideoPlayer.PingOutcome',
                'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
                'arcVersion': '3',
                'appVersion': '59',
                'gorilla.csrf.Token': csrfToken,
            }).toString();

            const ajaxHeaders = {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': watchUrl,
                'User-Agent': request.headers['User-Agent'],
            };

            const ajaxResponse = await axios.post(ajaxUrl, postData, { headers: ajaxHeaders });
            const ejl = ajaxResponse.data.Data.EJLinks;
            const decodedLnk = Buffer.from(decodeEinth(ejl), 'base64').toString('utf-8');
            const streamData = JSON.parse(decodedLnk);

            if (streamData.HLSLink) {
                 streamInfo = { title: 'Einthusan SD', url: streamData.HLSLink };
                 log(`Successfully found HLS Link for ${stremioId}`);
            }
        }
    }]);

    return streamInfo;
}

module.exports = { getLanguages, getMovies, getMovieMeta, getStreamUrl, ID_PREFIX };
