// auth.js
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

let authenticatedClient = null;

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function initializeAuth() {
    console.log('[AUTH] Initializing authentication module...');
    // This will attempt to log in once at startup and cache the client.
    await getAuthenticatedClient();
    console.log('[AUTH] Authentication module ready.');
}

async function getAuthenticatedClient() {
    if (authenticatedClient) {
        return authenticatedClient;
    }

    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar }));

    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        console.log('[AUTH] No premium credentials. Using a non-logged-in client.');
        authenticatedClient = client;
        return authenticatedClient;
    }

    console.log('[AUTH] Attempting premium login...');
    try {
        const loginPageRes = await client.get(`${BASE_URL}/login/`);
        const $ = cheerio.load(loginPageRes.data);
        const csrfToken = $('html').attr('data-pageid')?.replace(/\+/g, '+');

        if (!csrfToken) throw new Error('Could not find CSRF token on the login page.');
        console.log('[AUTH] Successfully retrieved CSRF token.');

        const loginPayload = new URLSearchParams({
            'xEvent': 'Login',
            'xJson': JSON.stringify({ Email: PREMIUM_USERNAME, Password: PREMIUM_PASSWORD }),
            'gorilla.csrf.Token': csrfToken,
        });

        const loginRes = await client.post(`${BASE_URL}/ajax/login/`, loginPayload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${BASE_URL}/login/`,
            },
        });

        if (loginRes.data?.Event !== 'redirect' && loginRes.data?.Message !== 'success') {
            throw new Error('Login failed. The server did not return a success message. Please check credentials.');
        }

        // --- THE CRITICAL STEP I MISSED ---
        // Perform the follow-up GET request to finalize the session.
        if (loginRes.data.Data) {
            console.log('[AUTH] Login successful, finalizing session...');
            await client.get(`${BASE_URL}${loginRes.data.Data}`);
        }
        
        console.log('[AUTH] Client is now fully authenticated.');
        authenticatedClient = client;
        return authenticatedClient;

    } catch (error) {
        console.error(`[AUTH] A fatal error occurred during login: ${error.message}`);
        authenticatedClient = client; // Return the basic client on failure
        return authenticatedClient;
    }
}

module.exports = { initializeAuth, getAuthenticatedClient, decodeEinth };
