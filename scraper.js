// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const ITEMS_PER_PAGE = 20;

const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;
let premiumSession = null;

crawleeLogger.setLevel(process.env.LOG_LEVEL === 'debug' ? LogLevel.INFO : LogLevel.INFO);

function log(message, level = 'info') {
    if (process.env.LOG_LEVEL === 'debug' || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

// Create a new, lightweight CheerioCrawler instance for each task.
function createCrawler() {
    return new CheerioCrawler({
        requestHandler: async (context) => {
            if (typeof context.request.handler === 'function') {
                await context.request.handler(context);
            }
        },
        preNavigationHooks: [({ request, session }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            };
            if (session) {
                request.headers.Cookie = session.getCookieString(request.url);
            }
        }],
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 30,
    });
}

async function getMovies(lang, genre, searchQuery, skip = 0) {
    const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    let baseUrl = searchQuery
        ? `${BASE_URL}/movie/results/?lang=${lang}&query=${encodeURIComponent(searchQuery)}`
        : `${BASE_URL}/movie/results/?lang=${lang}&find=${genre || 'Recent'}`;
    const finalUrl = page > 1 ? `${baseUrl}&page=${page}` : baseUrl;
    log(`Visiting movie list page: ${finalUrl}`);

    const movies = [];
    const crawler = createCrawler();

    await crawler.run([{
        url: finalUrl,
        handler: ({ $ }) => {
            log(`Page HTML received. Searching for movies using selector: '#UIMovieSummary > ul > li'`);

            // --- THE CORRECTED SELECTOR LOGIC ---
            const movieElements = $('#UIMovieSummary > ul > li');
            
            if (movieElements.length === 0) {
                log('Found 0 movie elements with the correct selector. The page might be empty or its structure changed.');
            } else {
                log(`Found ${movieElements.length} potential movie entries. Parsing now...`);
                movieElements.each((i, el) => {
                    const listItem = $(el); // The current <li> element
                    
                    // Find elements relative to the <li>
                    const linkElement = listItem.find('.block1 a');
                    const titleElement = listItem.find('.block2 a.title h3');
                    
                    const href = linkElement.attr('href');
                    const title = titleElement.text().trim();
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href ? href.match(/\/watch\/([a-zA-Z0-9.-]+)\//) : null;

                    if (idMatch && title) {
                        log(`  [+] Found Movie: ${title}`);
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                            type: 'movie',
                            name: title,
                            poster: poster && poster.startsWith('http') ? poster : `https:${poster}`,
                        });
                    }
                });
            }
        }
    }]);

    log(`Scraping finished. Returning ${movies.length} movies for this request.`);
    return movies;
}

// getMovieMeta and getStreamUrls can now be simplified as they don't need the heavyweight PlaywrightCrawler
async function getMovieMeta(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    log(`Getting meta for ID: ${stremioId} from ${watchUrl}`);
    
    let scrapedMeta = null;
    const crawler = createCrawler();
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
            const getInfo = (label) => {
                const text = $(`div.info > p:contains("${label}")`).text();
                return text.replace(label, '').replace(':', '').trim();
            };
            const year = getInfo('Year');
            const cast = getInfo('Cast').split(',').map(c => c.trim()).filter(Boolean);
            const director = getInfo('Director');
            scrapedMeta = {
                id: stremioId, type: 'movie', name, poster, background: poster, description,
                year: year || null,
                cast: cast.length > 0 ? cast : null,
                director: director ? [director] : null,
            };
            log(`Successfully scraped meta for: ${name}`);
        }
    }]);
    return scrapedMeta;
}

// This function can also use a lightweight crawler now
async function fetchStream(stremioId, quality, session) {
    const [_, lang, movieId] = stremioId.split(':');
    let watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    if (quality === 'HD') {
        watchUrl += '&uhd=true';
    }

    log(`Attempting to fetch ${quality} stream from: ${watchUrl}`);
    let streamInfo = null;

    const crawler = createCrawler();
    await crawler.run([{
        url: watchUrl,
        session: session,
        handler: async ({ $, request }) => {
            // Using the HTML you provided, we know the data-ejpingables is on the UIVideoPlayer section
            const videoPlayerSection = $('#UIVideoPlayer');
            const ejp = videoPlayerSection.attr('data-ejpingables');
            const csrfToken = $('html').attr('data-pageid'); // The csrf token is on the root html element
            
            if (!ejp || !csrfToken) {
                log(`Could not find tokens for ${quality} stream. It might be premium-only or unavailable.`, 'error');
                return;
            }

            const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${lang}`;
            const postData = new URLSearchParams({
                'xEvent': 'UIVideoPlayer.PingOutcome',
                'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
                'gorilla.csrf.Token': csrfToken,
            }).toString();

            const ajaxHeaders = {
                'User-Agent': request.headers['User-Agent'],
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': watchUrl,
                'Cookie': session.getCookieString(ajaxUrl),
            };

            const ajaxResponse = await axios.post(ajaxUrl, postData, { headers: ajaxHeaders });
            
            if (ajaxResponse.data && ajaxResponse.data.Data && ajaxResponse.data.Data.EJLinks) {
                const ejl = ajaxResponse.data.Data.EJLinks;
                const decodedLnk = Buffer.from(decodeEinth(ejl), 'base64').toString('utf-8');
                const streamData = JSON.parse(decodedLnk);
                if (streamData.HLSLink) {
                    streamInfo = { title: `Einthusan ${quality}`, url: streamData.HLSLink };
                    log(`Successfully found ${quality} HLS Link.`);
                }
            }
        }
    }]);

    return streamInfo;
}

// Dummy login function - full implementation is complex and out of scope of this fix
async function getPremiumSession() {
    if (PREMIUM_USERNAME) {
        log('Premium login not implemented in this version, proceeding as free user.');
    }
    return null;
}


async function getStreamUrls(stremioId) {
    const streams = [];
    const loggedInSession = await getPremiumSession();

    if (loggedInSession) {
        log('Executing premium user stream search...');
        const hdStream = await fetchStream(stremioId, 'HD', loggedInSession);
        if (hdStream) streams.push(hdStream);
    }
    
    log('Executing standard SD stream search (fallback)...');
    const sdStream = await fetchStream(stremioId, 'SD', new Session()); 
    if (sdStream) {
        if (!streams.find(s => s.url === sdStream.url)) {
            streams.push(sdStream);
        }
    }

    return streams;
}

module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
