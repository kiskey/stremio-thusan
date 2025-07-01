// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios'); // Still used for the targeted stream POST

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const ITEMS_PER_PAGE = 20;

// Credentials from environment
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;
let premiumSession = null; // We will store our logged-in session here

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

// --- THE FIX IS HERE ---
// 1. Create a helper function that returns a NEW crawler instance.
// This ensures every task is isolated and doesn't share state.
function createCrawler() {
    return new CheerioCrawler({
        requestHandler: async (context) => {
            if (typeof context.request.handler === 'function') {
                await context.request.handler(context);
            }
        },
        preNavigationHooks: [({ request, session }) => {
            request.headers = {
                ...request.headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            };
            if (session) {
                request.headers.Cookie = session.getCookieString(request.url);
            }
        }],
        postNavigationHooks: [({ response, session }) => {
            if (session) {
                session.setCookiesFromResponse(response);
            }
        }],
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 45,
    });
}

// The login function that creates a logged-in session
async function getPremiumSession() {
    if (premiumSession && !premiumSession.isBlocked()) {
        log('Using cached premium session.');
        return premiumSession;
    }

    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        log('No premium credentials provided.');
        return null;
    }

    log('Attempting to log in as premium user...');
    const loginSession = new Session({
        sessionPool: {
            isSessionUsable: async (s) => !s.isBlocked(),
        },
    });

    let csrfToken = '';

    // 2. Use a fresh crawler for this task.
    const crawler = createCrawler();
    await crawler.run([{
        url: `${BASE_URL}/login/`,
        session: loginSession,
        handler: async ({ $ }) => {
            csrfToken = $('#login-form').attr('data-pageid');
            if (!csrfToken) throw new Error('Could not find CSRF token on login page.');
            log(`Got login CSRF token: ${csrfToken}`);
        },
    }]);

    const loginUrl = `${BASE_URL}/ajax/login/`;
    const postData = new URLSearchParams({
        'xEvent': 'Login',
        'xJson': JSON.stringify({ "Email": PREMIUM_USERNAME, "Password": PREMIUM_PASSWORD }),
        'arcVersion': '3',
        'appVersion': '59',
        'gorilla.csrf.Token': csrfToken,
    }).toString();
    
    const loginResponse = await axios.post(loginUrl, postData, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `${BASE_URL}/login/`,
            'Cookie': loginSession.getCookieString(loginUrl),
        }
    });

    if (loginResponse.data && loginResponse.data.Message === "success") {
        log('Premium login successful.');
        const cookies = loginResponse.headers['set-cookie'];
        if (cookies) {
            loginSession.setCookies(cookies.map(c => ({...c, domain: new URL(BASE_URL).hostname})), loginUrl);
        }
        premiumSession = loginSession;
        return premiumSession;
    } else {
        log('Premium login failed. Check credentials.', 'error');
        premiumSession = null;
        return null;
    }
}

async function fetchStream(stremioId, quality, session) {
    const [_, lang, movieId] = stremioId.split(':');
    let watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    if (quality === 'HD') {
        watchUrl += '&uhd=true';
    }

    log(`Attempting to fetch ${quality} stream from: ${watchUrl}`);
    let streamInfo = null;
    
    // Use a fresh crawler for this task.
    const crawler = createCrawler();
    await crawler.run([{
        url: watchUrl,
        session: session,
        handler: async ({ $, request }) => {
            const ejp = $('section#UIVideoPlayer').attr('data-ejpingables');
            const csrfToken = $('section#UIVideoPlayer').attr('data-pageid');
            
            if (!ejp || !csrfToken) {
                log(`Could not find tokens for ${quality} stream. It might be premium-only or unavailable.`, 'error');
                return;
            }

            const ajaxUrl = `${BASE_URL}/ajax${new URL(watchUrl).pathname}${new URL(watchUrl).search}`;
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

async function getMovies(lang, genre, searchQuery, skip = 0) {
    const page = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    let baseUrl = searchQuery
        ? `${BASE_URL}/movie/results/?lang=${lang}&query=${encodeURIComponent(searchQuery)}`
        : `${BASE_URL}/movie/results/?lang=${lang}&find=${genre || 'Recent'}`;
    const finalUrl = page > 1 ? `${baseUrl}&page=${page}` : baseUrl;
    log(`Scraping movie list from: ${finalUrl} (skip: ${skip}, page: ${page})`);
    
    const movies = [];
    // Use a fresh crawler for this task.
    const crawler = createCrawler();
    await crawler.run([{
        url: finalUrl,
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
    log(`Found ${movies.length} movies for this request.`);
    return movies;
}

async function getMovieMeta(stremioId) {
    const [_, lang, movieId] = stremioId.split(':');
    const watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    log(`Getting meta for ID: ${stremioId} from ${watchUrl}`);
    
    let scrapedMeta = null;
    // Use a fresh crawler for this task.
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
                id: stremioId,
                type: 'movie',
                name,
                poster: poster,
                background: poster,
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


module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
