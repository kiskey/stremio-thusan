// auth.js
const axios = require('axios');
const { CheerioCrawler, Session } = require('crawlee');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;
let premiumSession = null;

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function getPremiumSession() {
    if (premiumSession) return premiumSession;
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) return null;

    console.log('[AUTH] Attempting premium login...');
    const loginSession = new Session();
    let csrfToken = '';
    const crawler = new CheerioCrawler({ maxRequests: 1, async requestHandler({ $ }) {
        csrfToken = $('#login-form').attr('data-pageid');
    }});
    await crawler.run([`${BASE_URL}/login/`]);
    
    if (!csrfToken) {
        console.error('[AUTH] Could not find CSRF token on login page.');
        return null;
    }

    try {
        const loginUrl = `${BASE_URL}/ajax/login/`;
        const postData = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ "Email": PREMIUM_USERNAME, "Password": PREMIUM_PASSWORD }),
            'gorilla.csrf.Token': csrfToken,
        }).toString();
        
        const loginResponse = await axios.post(loginUrl, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (loginResponse.data?.Message === "success") {
            console.log('[AUTH] Premium login successful!');
            const cookies = loginResponse.headers['set-cookie'];
            if (cookies) {
                const sessionCookies = cookies.map(c => ({ name: c.split(';')[0].split('=')[0], value: c.split(';')[0].split('=')[1] }));
                loginSession.setCookies(sessionCookies, loginUrl);
                premiumSession = loginSession;
                return premiumSession;
            }
        }
    } catch (error) {
        console.error(`[AUTH] An error occurred during login: ${error.message}`);
    }
    return null;
}


async function fetchStream(moviePageUrl, quality, session) {
    console.log(`[STREAMER] Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    let streamInfo = null;
    const urlToVisit = quality === 'HD' ? `${moviePageUrl}&uhd=true` : moviePageUrl;

    const crawler = new CheerioCrawler({
        async requestHandler({ $ }) {
            const videoPlayerSection = $('#UIVideoPlayer');
            const ejp = videoPlayerSection.attr('data-ejpingables');
            const csrfToken = $('html').attr('data-pageid')?.replace(/\+/g, '+');

            if (!ejp || !csrfToken) {
                console.error(`[STREAMER] Could not find tokens for ${quality} stream.`);
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
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': urlToVisit,
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
    const loggedInSession = await getPremiumSession();

    if (loggedInSession) {
        const hdStream = await fetchStream(moviePageUrl, 'HD', loggedInSession);
        if (hdStream) streams.push(hdStream);
    }
    
    const sdStream = await fetchStream(moviePageUrl, 'SD', new Session()); 
    if (sdStream && !streams.find(s => s.url === sdStream.url)) {
        streams.push(sdStream);
    }

    return streams;
}

module.exports = { getStreamUrls };
