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

module.exports = { getPremiumSession, decodeEinth };
