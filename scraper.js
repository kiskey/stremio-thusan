// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;
let premiumSession = null; // We will cache the logged-in session here

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

async function getPremiumSession() {
    if (premiumSession && !premiumSession.isBlocked()) {
        log('Using cached premium session.');
        return premiumSession;
    }
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        log('No premium credentials provided. Proceeding as free user.');
        return null;
    }

    log('Attempting premium login...');
    const loginSession = new Session({ sessionPool: { isSessionUsable: async (s) => !s.isBlocked() } });
    let csrfToken = '';

    const crawler = new CheerioCrawler({ maxRequests: 1, async requestHandler({ $ }) {
        csrfToken = $('#login-form').attr('data-pageid');
    }});
    await crawler.run([`${BASE_URL}/login/`]);
    
    if (!csrfToken) {
        log('Could not find CSRF token on login page.', 'error');
        return null;
    }
    log(`Got login CSRF token: ${csrfToken}`, 'debug');

    try {
        const loginUrl = `${BASE_URL}/ajax/login/`;
        const postData = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ "Email": PREMIUM_USERNAME, "Password": PREMIUM_PASSWORD }),
            'arcVersion': '3', 'appVersion': '59', 'gorilla.csrf.Token': csrfToken,
        }).toString();
        
        const loginResponse = await axios.post(loginUrl, postData, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest', 'Referer': `${BASE_URL}/login/`,
            }
        });

        if (loginResponse.data?.Message === "success") {
            log('Premium login successful!');
            const cookies = loginResponse.headers['set-cookie'];
            if (cookies) {
                const sessionCookies = cookies.map(c => {
                    const [name, ...valueParts] = c.split(';')[0].split('=');
                    return { name, value: valueParts.join('=') };
                });
                loginSession.setCookies(sessionCookies, loginUrl);
                premiumSession = loginSession;
                return premiumSession;
            }
        } else {
            log('Premium login failed. Response did not indicate success. Check credentials.', 'error');
            return null;
        }
    } catch (error) {
        log(`An error occurred during login: ${error.message}`, 'error');
        return null;
    }
    return null;
}

async function fetchStream(stremioId, quality, session) {
    const [_, lang, movieId] = stremioId.split(':');
    let watchUrl = `${BASE_URL}/movie/watch/${movieId}/?lang=${lang}`;
    if (quality === 'HD') {
        watchUrl += '&uhd=true';
    }

    log(`Attempting to fetch ${quality} stream from: ${watchUrl}`);
    let streamInfo = null;

    const crawler = new CheerioCrawler({
        maxRequests: 1,
        async requestHandler({ $, body }) {
            const videoPlayerHtml = $('#UIVideoPlayer').toString();
            const rootHtml = $('html').toString();
            const ejpMatch = videoPlayerHtml.match(/data-ejpingables="([^"]+)"/);
            const csrfMatch = rootHtml.match(/data-pageid="([^"]+)"/);
            
            const ejp = ejpMatch ? ejpMatch[1] : null;

            // --- THE CORRECTED LINE ---
            const csrfToken = csrfMatch ? csrfMatch[1].replace(/+/g, '+') : null;

            if (!ejp || !csrfToken) {
                log(`Could not find tokens for ${quality} stream for ${stremioId}.`, 'error');
                return;
            }

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
                        'X-Requested-With': 'XMLHttpRequest', 'Referer': watchUrl,
                        'Cookie': session.getCookieString(watchUrl),
                    }
                });
                if (ajaxResponse.data?.Data?.EJLinks) {
                    const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
                    const streamData = JSON.parse(decodedLnk);
                    if (streamData.HLSLink) {
                        streamInfo = { title: `Einthusan ${quality}`, url: streamData.HLSLink };
                        log(`Successfully found ${quality} stream for ${stremioId}.`);
                    }
                }
            } catch (error) {
                log(`AJAX request for ${quality} stream failed: ${error.message}`, 'error');
            }
        }
    });

    await crawler.run([{ url: watchUrl, session: session }]);
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
    const pageNum = Math.floor(skip / 20) + 1;
    const finalUrl = `${BASE_URL}/movie/results/?lang=${lang}&${searchQuery ? `query=${encodeURIComponent(searchQuery)}` : `find=${genre || 'Recent'}`}&page=${pageNum}`;
    log(`Visiting movie list page: ${finalUrl}`);
    const movies = [];
    const crawler = new CheerioCrawler({
        maxConcurrency: 2, minRequestDelay: 100, maxRequestDelay: 500,
        async requestHandler({ $ }) {
            if ($('title').text().includes('Rate Limited')) {
                log(`Got a rate-limit page for [${lang}]. Skipping.`, 'error');
                return;
            }
            const selector = '#UIMovieSummary > ul > li';
            const movieElements = $(selector);
            movieElements.each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                            type: 'movie', name: title,
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
        maxRequests: 1,
        async requestHandler({ $ }) {
            const name = $('div.single-title > h1').text().replace(/Watch Online/, '').trim();
            if (!name) return;
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


module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
