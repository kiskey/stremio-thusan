// auth.js
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const PREMIUM_USERNAME = process.env.EINTHUSAN_USERNAME;
const PREMIUM_PASSWORD = process.env.EINTHUSAN_PASSWORD;

// This single, stateful client will be shared across the application.
const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

let isAuthenticated = false;

function decodeEinth(lnk) {
    const t = 10;
    return lnk.slice(0, t) + lnk.slice(-1) + lnk.slice(t + 2, -1);
}

async function initializeAuth() {
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        console.log('[AUTH] No premium credentials provided. Proceeding in non-logged-in mode.');
        return;
    }

    console.log('[AUTH] Attempting premium login...');
    try {
        const loginPageRes = await client.get(`${BASE_URL}/login/`);
        const $ = cheerio.load(loginPageRes.data);
        const csrfToken = $('html').attr('data-pageid')?.replace(/+/g, '+');

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

        if (loginRes.data.Data) {
            console.log('[AUTH] Login successful, finalizing session by visiting account page...');
            await client.get(`${BASE_URL}${loginRes.data.Data}`);
        }
        
        console.log('[AUTH] Client is now fully authenticated.');
        isAuthenticated = true;

    } catch (error) {
        console.error(`[AUTH] A fatal error occurred during login: ${error.message}`);
        // The client remains non-authenticated, but the app can continue.
    }
}

function getAuthenticatedClient() {
    return client;
}

function isClientAuthenticated() {
    return isAuthenticated;
}

module.exports = { initializeAuth, getAuthenticatedClient, isClientAuthenticated, decodeEinth };
