// scraper.js
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { getStreamUrls } = require('./auth'); // Still needed for on-demand streams

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

// --- NEW: Proxy Rotation Logic ---
const PROXY_URLS = (process.env.PROXY_URLS || '')
    .split(',')
    .map(url => url.trim())
    .filter(url => url.length > 0);

if (PROXY_URLS.length > 0) {
    console.log(`[SCRAPER] Loaded ${PROXY_URLS.length} proxies for rotation.`);
} else {
    console.log('[SCRAPER] No proxies configured. Will make direct requests.');
}

// Helper function to shuffle the proxy array for each page request
function shuffleProxies() {
    // Return a new shuffled array
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

    // If no proxies are configured, add a 'null' entry to represent a direct connection.
    const proxiesToTry = PROXY_URLS.length > 0 ? shuffleProxies() : [null];

    for (const proxyUrl of proxiesToTry) {
        const proxyIdentifier = proxyUrl || 'DIRECT';
        console.log(`[SCRAPER] Attempting to fetch via proxy: ${proxyIdentifier}`);
        
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
                continue; // Try the next proxy
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
            return { movies, rateLimited: false }; // Success!

        } catch (error) {
            console.error(`[SCRAPER] Proxy ${proxyIdentifier} FAILED: ${error.message}. Rotating to next proxy.`);
            continue; // Try the next proxy
        }
    }

    // If the loop finishes, all proxies have failed for this page.
    console.error(`[SCRAPER] All proxies failed for ${finalUrl}. Signaling worker to pause.`);
    return { movies: [], rateLimited: true };
}

module.exports = { 
    scrapePage, 
    getStreamUrls,
    ID_PREFIX
};
