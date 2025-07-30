// auth.js
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

let isAuthenticated = false;

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
    console.log('[AUTH] Initializing authentication module...');
    await getAuthenticatedClient();
    console.log('[AUTH] Authentication module ready.');
}

async function getAuthenticatedClient() {
    if (isAuthenticated) return client;
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        console.log('[AUTH] No premium credentials. Using a non-logged-in client.');
        return client;
    }

    console.log('[AUTH] Attempting premium login...');
    try {
        const loginPageRes = await client.get(`${BASE_URL}/login/`);
        const $ = cheerio.load(loginPageRes.data);
        const csrfToken = $('html').attr('data-pageid'); 

        if (!csrfToken) throw new Error('Could not find CSRF token on the login page.');
        console.log('[AUTH] Successfully retrieved CSRF token.');

        const loginPayload = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ Email: PREMIUM_USERNAME, Password: PREMIUM_PASSWORD }),
            'tabID': 'vwmSPyo0giMK9nETr0vMMrE/dIBvZQ6a11v+i2kVk6/t7UCLFWORSxePRTDTpRTAeuu/D/9t32a7lO3aJNo7EA==25',
            'gorilla.csrf.Token': csrfToken,
        });

        const loginRes = await client.post(`${BASE_URL}/ajax/login/`, loginPayload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/login/`,
            },
        });

        if (loginRes.data?.Event !== 'redirect' && loginRes.data?.Message !== 'success') {
            throw new Error('Login failed. Server response did not indicate success. Please check credentials.');
        }

        if (loginRes.data.Data) {
            console.log('[AUTH] Login successful, finalizing session...');
            await client.get(`${BASE_URL}${loginRes.data.Data}`);
        }
        
        console.log('[AUTH] Client is now fully authenticated.');
        isAuthenticated = true;

    } catch (error) {
        console.error(`[AUTH] A fatal error occurred during login: ${error.message}`);
    }
    
    return client;
}

async function fetchStream(client, moviePageUrl, quality, isUhd = false) {
    console.log(`[STREAMER] Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    
    const usePremiumUrl = quality === 'HD' && isAuthenticated;
    const urlToVisit = usePremiumUrl ? moviePageUrl.replace('/movie/', '/premium/movie/') : moviePageUrl;
    console.log(`[STREAMER] Visiting URL: ${urlToVisit}`);

    try {
        const pageResponse = await client.get(urlToVisit);
        const $ = cheerio.load(pageResponse.data);
        const videoPlayerSection = $('#UIVideoPlayer');
        const mp4Link = videoPlayerSection.attr('data-mp4-link');
        
        if (mp4Link) {
            console.log(`[STREAMER] Successfully found direct MP4 link for ${quality}.`);
            // R2 (FIXED): Correctly build the stream title.
            let streamTitle = `Einthusan ${quality}`;
            if (quality === 'HD' && isUhd === true) {
                streamTitle = `UHD 💎 ${streamTitle}`;
            }
            return { title: streamTitle, url: mp4Link };
        }

        console.log(`[STREAMER] No direct MP4 link found. Falling back to AJAX method for ${quality}.`);
        const ejp = videoPlayerSection.attr('data-ejpingables');
        const csrfToken = $('html').attr('data-pageid'); 

        if (!ejp || !csrfToken) {
            console.error(`[STREAMER] Could not find AJAX tokens for ${quality} stream.`);
            return null;
        }

        const movieId = new URL(moviePageUrl).pathname.split('/')[3];
        const lang = new URL(moviePageUrl).searchParams.get('lang');
        const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${lang}`;
        const postData = new URLSearchParams({
            'xEvent': 'UIVideoPlayer.PingOutcome',
            'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
            'gorilla.csrf.Token': csrfToken,
        }).toString();

        const ajaxResponse = await client.post(ajaxUrl, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': urlToVisit }
        });

        if (ajaxResponse.data?.Data?.EJLinks) {
            const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
            const streamData = JSON.parse(decodedLnk);
            if (streamData.HLSLink) {
                console.log(`[STREAMER] Successfully found AJAX HLS link for ${quality}.`);
                // R2 (FIXED): Correctly build the stream title for the fallback method.
                let streamTitle = `Einthusan ${quality} (AJAX)`;
                if (quality === 'HD' && isUhd === true) {
                    streamTitle = `UHD 💎 ${streamTitle}`;
                }
                return { title: streamTitle, url: streamData.HLSLink };
            }
        }
    } catch (error) {
        console.error(`[STREAMER] Request for ${quality} stream failed: ${error.message}`);
    }
    return null;
}

async function getStreamUrls(moviePageUrl, isUhd = false) {
    // Add diagnostic logging to confirm the flag is received.
    console.log(`[AUTH] getStreamUrls received call. isUhd: ${isUhd}`);
    
    const streams = [];
    const client = await getAuthenticatedClient();

    if (isAuthenticated) {
        let hdStream = await fetchStream(client, moviePageUrl, 'HD', isUhd);
        if (hdStream) {
            streams.push(replaceIpInStreamUrl(hdStream));
        }
    }
    
    let sdStream = await fetchStream(client, moviePageUrl, 'SD', false); // SD is never UHD
    if (sdStream) {
        sdStream = replaceIpInStreamUrl(sdStream);
        if (!streams.find(s => s.url === sdStream.url)) {
            streams.push(sdStream);
        }
    }

    return streams;
}

module.exports = { initializeAuth, getStreamUrls, decodeEinth };
