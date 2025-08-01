// auth.js
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

// R10: Map for language codes.
const LANG_CODES = {
    tamil: 'TA',
    malayalam: 'ML',
    telugu: 'TE',
    hindi: 'HI',
    kannada: 'KA',
};

const mainClient = wrapper(axios.create());

let isAuthenticated = false;

async function createPremiumSession() {
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        console.error('[AUTH-SESSION] Cannot create premium session: credentials not set.');
        return null;
    }

    console.log('[AUTH-SESSION] Creating new, isolated premium session...');
    const tempJar = new CookieJar();
    const tempClient = wrapper(axios.create({ jar: tempJar }));

    try {
        const loginPageRes = await tempClient.get(`${BASE_URL}/login/`);
        const $ = cheerio.load(loginPageRes.data);
        const csrfToken = $('html').attr('data-pageid');

        if (!csrfToken) throw new Error('Could not find CSRF token for new session.');

        const loginPayload = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ Email: PREMIUM_USERNAME, Password: PREMIUM_PASSWORD }),
            'tabID': 'vwmSPyo0giMK9nETr0vMMrE/dIBvZQ6a11v+i2kVk6/t7UCLFWORSxePRTDTpRTAeuu/D/9t32a7lO3aJNo7EA==25',
            'gorilla.csrf.Token': csrfToken,
        });

        const loginRes = await tempClient.post(`${BASE_URL}/ajax/login/`, loginPayload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/login/`,
            },
        });

        if (loginRes.data?.Event !== 'redirect' && loginRes.data?.Message !== 'success') {
            throw new Error('New session login failed. Please check credentials.');
        }

        if (loginRes.data.Data) {
            await tempClient.get(`${BASE_URL}${loginRes.data.Data}`);
        }
        
        console.log('[AUTH-SESSION] New premium session successfully created and authenticated.');
        return tempClient;

    } catch (error) {
        console.error(`[AUTH-SESSION] A fatal error occurred during isolated login: ${error.message}`);
        return null;
    }
}

function replaceIpInStreamUrl(streamInfo) {
    if (!streamInfo || !streamInfo.url) return streamInfo;
    const ipRegex = /https?:\/\/\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    const replacementDomain = 'https://cdn1.einthusan.io';
    const originalUrl = streamInfo.url;
    streamInfo.url = originalUrl.replace(ipRegex, replacementDomain);
    if (originalUrl !== streamInfo.url) {
        console.log(`[STREAMER] Replaced IP in stream URL. New URL: ${streamInfo.url}`);
    }
    return streamInfo;
}

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function initializeAuth() {
    console.log('[AUTH] Checking for premium credentials...');
    if (PREMIUM_USERNAME && PREMIUM_PASSWORD) {
        isAuthenticated = true;
        console.log('[AUTH] Premium credentials found. HD streaming is enabled.');
    } else {
        console.log('[AUTH] No premium credentials found. HD streaming is disabled.');
    }
}

// R9 & R10: Modified to accept the full movie object for title formatting.
async function fetchStream(movie, quality) {
    const { movie_page_url, is_uhd, lang, title: movieName } = movie;
    
    const isPremiumRequest = quality === 'HD' && isAuthenticated;
    
    let clientToUse;
    let urlToVisit;

    if (isPremiumRequest) {
        const qualityLabel = is_uhd ? 'UHD' : 'HD';
        console.log(`[STREAMER] Premium request detected for "${movie.name}". Quality: ${qualityLabel}. Initiating new session.`);
        clientToUse = await createPremiumSession();
        
        if (!clientToUse) {
            console.error(`[STREAMER] Could not create premium session for "${movie.name}". Aborting.`);
            return null;
        }

        const pageUrl = new URL(movie_page_url);
        pageUrl.pathname = pageUrl.pathname.replace('/movie/', '/premium/movie/');
        if (is_uhd) {
            pageUrl.searchParams.set('uhd', 'true');
        }
        urlToVisit = pageUrl.toString();
    } else {
        clientToUse = mainClient;
        urlToVisit = movie_page_url;
    }

    console.log(`[STREAMER] Visiting URL: ${urlToVisit}`);

    try {
        const pageResponse = await clientToUse.get(urlToVisit);
        const $ = cheerio.load(pageResponse.data);

        if (isPremiumRequest) {
            const isPremiumPage = $('#html5-player').attr('data-premium') === 'true';
            if (!isPremiumPage) {
                console.error(`[STREAMER] ERROR: Page for "${movie.name}" is not a valid premium page as expected. The session may have failed. Aborting.`);
                return null;
            }
            console.log(`[STREAMER] Premium page for "${movie.name}" successfully validated.`);
        }

        const videoPlayerSection = $('#UIVideoPlayer');
        const mp4Link = videoPlayerSection.attr('data-mp4-link');

        // R10: Title formatting logic
        const langCode = LANG_CODES[lang] || '??';
        let streamTitle;
        
        if (mp4Link) {
            console.log(`[STREAMER] Successfully found direct MP4 link for ${quality}.`);
            const qualityLabel = (is_uhd && quality === 'HD') ? 'UHD 💎' : quality;
            streamTitle = `${qualityLabel} - ${langCode} - ${movieName}`;
            return { title: streamTitle, url: mp4Link };
        }

        console.log(`[STREAMER] No direct MP4 link found. Falling back to AJAX method for ${quality}.`);
        const ejp = videoPlayerSection.attr('data-ejpingables');
        const csrfToken = $('html').attr('data-pageid'); 

        if (!ejp || !csrfToken) {
            console.error(`[STREAMER] Could not find AJAX tokens for ${quality} stream.`);
            return null;
        }

        const movieId = new URL(movie_page_url).pathname.split('/')[3];
        const ajaxLang = new URL(movie_page_url).searchParams.get('lang');
        const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${ajaxLang}`;
        const postData = new URLSearchParams({
            'xEvent': 'UIVideoPlayer.PingOutcome',
            'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
            'gorilla.csrf.Token': csrfToken,
        }).toString();

        const ajaxResponse = await clientToUse.post(ajaxUrl, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': urlToVisit }
        });

        if (ajaxResponse.data?.Data?.EJLinks) {
            const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
            const streamData = JSON.parse(decodedLnk);
            if (streamData.HLSLink) {
                console.log(`[STREAMER] Successfully found AJAX HLS link for ${quality}.`);
                const qualityLabel = (is_uhd && quality === 'HD') ? 'UHD 💎' : quality;
                streamTitle = `${qualityLabel} - ${langCode} - ${movieName} (AJAX)`;
                return { title: streamTitle, url: streamData.HLSLink };
            }
        }
    } catch (error) {
        console.error(`[STREAMER] Request for ${quality} stream failed: ${error.message}`);
    }
    return null;
}

async function getStreamUrls(movie) {
    if (!movie) {
        console.error("[AUTH] getStreamUrls was called with a null movie object.");
        return [];
    }
    
    const streams = [];

    if (isAuthenticated) {
        // R9: Pass the full movie object down.
        let hdStream = await fetchStream(movie, 'HD');
        if (hdStream) {
            streams.push(replaceIpInStreamUrl(hdStream));
        }
    }
    
    // R9: Pass the full movie object down.
    let sdStream = await fetchStream(movie, 'SD');
    if (sdStream) {
        sdStream = replaceIpInStreamUrl(sdStream);
        if (!streams.find(s => s.url === sdStream.url)) {
            streams.push(sdStream);
        }
    }

    return streams;
}

module.exports = { initializeAuth, getStreamUrls, decodeEinth };
