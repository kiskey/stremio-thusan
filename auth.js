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
    if (premiumSession && !premiumSession.isBlocked()) {
        return premiumSession;
    }
    if (!PREMIUM_USERNAME || !PREMIUM_PASSWORD) {
        return null;
    }

    console.log('[AUTH] Attempting premium login...');
    const loginSession = new Session({ sessionPool: { isSessionUsable: async (s) => !s.isBlocked() } });
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
            console.log('[AUTH] Premium login successful!');
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
            console.error('[AUTH] Premium login failed. Check credentials.');
            return null;
        }
    } catch (error) {
        console.error(`[AUTH] An error occurred during login: ${error.message}`);
        return null;
    }
    return null;
}

module.exports = { getPremiumSession, decodeEinth };
