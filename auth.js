// auth.js
const axios = require('axios');
const { CheerioCrawler, Session } = require('crawlee');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

// This will hold our single, authenticated session object once login is complete.
let premiumSession = null;

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

// Helper function to parse cookies as per your previous recommendation
function parseCookies(setCookieHeaders) {
    return setCookieHeaders.map(header => {
        const [pair] = header.split(';');
        const [name, ...vals] = pair.split('=');
        return { name: name.trim(), value: vals.join('=') };
    });
}

async function getPremiumSession() {
    // If we already have a valid, cached session, return it.
    if (premiumSession && !premiumSession.isBlocked()) {
        console.log('[AUTH] Using cached premium session.');
        return premiumSession;
    }
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        return null;
    }

    console.log('[AUTH] Attempting premium login...');
    let csrfToken = '';

    // --- THE FIX IS HERE: Using the correct crawler configuration ---
    const crawler = new CheerioCrawler({
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 1,
            isSessionUsable: async (s) => !s.isBlocked(),
        },
        persistCookiesPerSession: true,
        maxRequests: 1,
        async requestHandler({ $ }) {
            csrfToken = $('#login-form').attr('data-pageid');
        },
    });

    await crawler.run([{ url: `${BASE_URL}/login/` }]);

    if (!csrfToken) {
        console.error('[AUTH] Could not find CSRF token.');
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
            console.error('[AUTH] Login failed, bad credentials.');
            return null;
        }

        console.log('[AUTH] Premium login successful!');
        const cookies = parseCookies(loginResponse.headers['set-cookie'] || []);

        // Grab the single session that CheerioCrawler created and used.
        premiumSession = crawler.sessionPool.sessions[0];
        premiumSession.setCookies(cookies, `${BASE_URL}/`);
        return premiumSession;

    } catch (error) {
        console.error(`[AUTH] An error occurred during the login AJAX request: ${error.message}`);
        return null;
    }
}

async function getStreamUrls(moviePageUrl) {
    const streams = [];
    const loggedInSession = await getPremiumSession();

    if (loggedInSession) {
        console.log('[STREAMER] Fetching HD via premium session…');
        const hdStream = await fetchStream(moviePageUrl, 'HD', loggedInSession);
        if (hdStream) streams.push(hdStream);
    }

    console.log('[STREAMER] Falling back to SD (no login)…');
    // For the SD stream, we don't need a persistent session, so a one-off is fine.
    const sdSession = new Session({});
    const sdStream = await fetchStream(moviePageUrl, 'SD', sdSession);
    if (sdStream && !streams.find(s => s.url === sdStream.url)) {
        streams.push(sdStream);
    }

    return streams;
}

async function fetchStream(moviePageUrl, quality, session) {
    console.log(`[STREAMER] Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    let streamInfo = null;
    const urlToVisit = quality === 'HD' ? `${moviePageUrl}&uhd=true` : moviePageUrl;

    const crawler = new CheerioCrawler({
        // This crawler uses the session passed into its run() call.
        async requestHandler({ $ }) {
            const videoPlayerSection = $('#UIVideoPlayer');
            const ejp = videoPlayerSection.attr('data-ejpingables');
            const csrfToken = $('html').attr('data-pageid')?.replace(/\+/g, '+');

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

module.exports = { getStreamUrls };
