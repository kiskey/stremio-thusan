// auth.js
const axios = require('axios');
const { CheerioCrawler, SessionPool, Session } = require('crawlee');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

// This pool is created but NOT yet initialized.
const loginPool = new SessionPool({ maxPoolSize: 1 });
let premiumSessionIsAuthenticated = false;

// --- THE FIX IS HERE (Part 1) ---
// A new function to be called once at server startup.
async function initializeAuth() {
    console.log('[AUTH] Initializing session pool...');
    await loginPool.initialize();
    console.log('[AUTH] Session pool initialized successfully.');
}

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function getPremiumSession() {
    if (premiumSessionIsAuthenticated) {
        console.log('[AUTH] Using cached premium session from pool.');
        // The pool is now guaranteed to be initialized.
        return await loginPool.getSession();
    }
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        return null;
    }

    console.log('[AUTH] Attempting premium login...');
    const session = await loginPool.getSession();
    let csrfToken = '';

    const crawler = new CheerioCrawler({
        sessionPool: loginPool,
        maxRequests: 1,
        async requestHandler({ $ }) {
            csrfToken = $('#login-form').attr('data-pageid');
        }
    });

    await crawler.run([{ url: `${BASE_URL}/login/`, session: session }]);
    
    if (!csrfToken) {
        console.error('[AUTH] Could not find CSRF token on login page.');
        return null;
    }

    try {
        const postData = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ Email: PREMIUM_USERNAME, Password: PREMIUM_PASSWORD }),
            'gorilla.csrf.Token': csrfToken,
        }).toString();

        const loginResponse = await axios.post(`${BASE_URL}/ajax/login/`, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (loginResponse.data?.Message !== 'success') {
            console.error('[AUTH] Login failed, server did not return success. Please check credentials.');
            session.retire(); // Mark the session as unusable
            return null;
        }

        console.log('[AUTH] Premium login successful!');
        const setCookieHeaders = loginResponse.headers['set-cookie'] || [];
        const cookies = setCookieHeaders.map(header => {
            const [pair] = header.split(';');
            const [name, ...vals] = pair.split('=');
            return { name: name.trim(), value: vals.join('=') };
        });
        
        session.setCookies(cookies, `${BASE_URL}/`);
        premiumSessionIsAuthenticated = true;
        return session;

    } catch (error) {
        console.error(`[AUTH] An error occurred during the login AJAX request: ${error.message}`);
        session.retire();
        return null;
    }
}

async function fetchStream(moviePageUrl, quality, session) {
    console.log(`[STREAMER] Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    let streamInfo = null;
    const urlToVisit = quality === 'HD' ? `${moviePageUrl}&uhd=true` : moviePageUrl;

    const crawler = new CheerioCrawler({
        async requestHandler({ $ }) {
            const videoPlayerSection = $('#UIVideoPlayer');
            const ejp = videoPlayerSection.attr('data-ejpingables');
            const csrfToken = $('html').attr('data-pageid')?.replace(/+/g, '+');

            if (!ejp || !csrfToken) {
                console.error(`[STREAMER] Could not find tokens for ${quality} stream.`);
                return;
            }

            const movieId = new URL(moviePageUrl).pathname.split('/')[3];
            const lang = new URL(moviePageUrl).searchParams.get('lang');
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
                        'X-Requested-With': 'XMLHttpRequest', 'Referer': urlToVisit,
                        'Cookie': session.getCookieString(urlToVisit),
                    }
                });
                if (ajaxResponse.data?.Data?.EJLinks) {
                    const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
                    const streamData = JSON.parse(decodedLnk);
                    if (streamData.HLSLink) {
                        streamInfo = { title: `Einthusan ${quality}`, url: streamData.HLSLink };
                        console.log(`[STREAMER] Successfully found ${quality} stream.`);
                    }
                }
            } catch (error) {
                console.error(`[STREAMER] AJAX request for ${quality} stream failed: ${error.message}`);
            }
        }
    });

    await crawler.run([{ url: urlToVisit, session: session }]);
    return streamInfo;
}

async function getStreamUrls(moviePageUrl) {
    const streams = [];
    const premiumSession = await getPremiumSession();

    if (premiumSession) {
        console.log('[STREAMER] Fetching HD via premium session…');
        const hdStream = await fetchStream(moviePageUrl, 'HD', premiumSession);
        if (hdStream) streams.push(hdStream);
    }

    console.log('[STREAMER] Falling back to SD (no login)…');
    const sdSession = new Session({}); // This is correct for a one-off, non-pooled session
    const sdStream = await fetchStream(moviePageUrl, 'SD', sdSession);
    if (sdStream && !streams.find(s => s.url === sdStream.url)) {
        streams.push(sdStream);
    }

    return streams;
}

module.exports = { initializeAuth, getStreamUrls };
