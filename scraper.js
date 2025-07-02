// scraper.js
const fetch = require('node-fetch');
const cheerio = require('cheerio');
// --- THE FIX IS HERE ---
// We now import getStreamUrls from auth.js where it lives.
const { getStreamUrls } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const PROXY_URLS = (process.env.PROXY_URLS || '').split(',').map(url => url.trim()).filter(Boolean);

if (PROXY_URLS.length > 0) {
    console.log(`[SCRAPER] Loaded ${PROXY_URLS.length} proxies for rotation.`);
} else {
    console.log('[SCRAPER] No proxies configured. Will make direct requests.');
}

function shuffleProxies() {
    const shuffled = [...PROXY_URLS];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function scrapePage(lang, pageNum) {
    const finalUrl = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${pageNum}`;
    console.log(`[SCRAPER] Beginning scrape job for: ${finalUrl}`);
    const proxiesToTry = PROXY_URLS.length > 0 ? shuffleProxies() : [null];

    for (const proxyUrl of proxiesToTry) {
        const proxyIdentifier = proxyUrl || 'DIRECT';
        try {
            let htmlContent;
            if (proxyUrl) {
                const res = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageURL: finalUrl })
                });
                htmlContent = await res.text();
            } else {
                const res = await fetch(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }});
                htmlContent = await res.text();
            }

            const $ = cheerio.load(htmlContent);

            if ($('title').text().includes('Rate Limited')) {
                console.error(`[SCRAPER] Proxy ${proxyIdentifier} was RATE LIMITED. Rotating to next proxy.`);
                continue;
            }

            const movies = [];
            $('#UIMovieSummary > ul > li').each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        const movieId = idMatch[1];
                        const poster = listItem.find('.block1 img').attr('src');
                        const yearText = listItem.find('.info p').first().text();
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${movieId}`,
                            lang, title,
                            year: yearText ? parseInt(yearText.match(/\d{4}/)?.[0], 10) : null,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                            movie_page_url: `${BASE_URL}${href}`,
                            description: listItem.find('p.synopsis').text().trim(),
                            director: listItem.find('.professionals .prof:contains("Director") p').text().trim() || null,
                            cast: listItem.find('.professionals .prof:not(:contains("Director")) p').map((i, el) => $(el).text().trim()).get(),
                        });
                    }
                }
            });
            
            console.log(`[SCRAPER] SUCCESS via ${proxyIdentifier}. Found ${movies.length} movies.`);
            return { movies, rateLimited: false };

        } catch (error) {
            console.error(`[SCRAPER] Proxy ${proxyIdentifier} FAILED: ${error.message}. Rotating to next proxy.`);
            continue;
        }
    }

    console.error(`[SCRAPER] All proxies failed for ${finalUrl}. Signaling worker to pause.`);
    return { movies: [], rateLimited: true };
}

module.exports = { 
    scrapePage, 
    getStreamUrls,
    ID_PREFIX
};
