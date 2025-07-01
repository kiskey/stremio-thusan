// scraper.js
const fs = require('fs');
const { CheerioCrawler, log: crawleeLogger, LogLevel } = require('crawlee');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const ITEMS_PER_PAGE = 20;

const IS_DEBUG_MODE = process.env.LOG_LEVEL === 'debug';
console.log(`[SERVER] Debug mode is: ${IS_DEBUG_MODE}`);

crawleeLogger.setLevel(LogLevel.INFO);

// --- THE FIX IS HERE, IMPLEMENTING YOUR SUGGESTED PATTERN ---

// 1. The requestHandler contains all the parsing logic.
function createCrawler() {
    return new CheerioCrawler({
        navigationTimeoutSecs: 45,
        maxRequestRetries: 2,
        async requestHandler({ $, request, body }) {
            // Destructure the context passed via userData
            const { lang, movies } = request.userData;

            console.log(`[SCRAPER][INFO] HTML received for [${lang}].`);

            if (IS_DEBUG_MODE) {
                console.log(`[SCRAPER][DEBUG] ---- START OF RAW HTML FOR ${lang} ----`);
                const debugFileName = `debug-content-${lang}.html`;
                fs.writeFileSync(debugFileName, body);
                console.log(`[SCRAPER][DEBUG] DUMPED HTML to ./${debugFileName}`);
                console.log(`[SCRAPER][DEBUG] ---- END OF RAW HTML FOR ${lang} ----`);
            }

            const selector = '#UIMovieSummary > ul > li';
            if (IS_DEBUG_MODE) console.log(`[SCRAPER][DEBUG] Parsing with selector: "${selector}"`);

            const movieElements = $(selector);
            if (movieElements.length === 0) {
                console.log(`[SCRAPER][ERROR] Found 0 movie elements for [${lang}] even after receiving HTML.`);
                return; // Stop processing for this request
            }

            console.log(`[SCRAPER][INFO] Found ${movieElements.length} movie elements on the page for [${lang}].`);

            movieElements.each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');

                if (title && href) {
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);

                    if (idMatch) {
                        if (IS_DEBUG_MODE) console.log(`[SCRAPER][DEBUG]   [+] Success: Extracted "${title}"`);
                        // IMPORTANT: We push to the 'movies' array that was passed in via userData.
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                            type: 'movie',
                            name: title,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                        });
                    }
                }
            });
        }
    });
}

// 2. The getMovies function now prepares the data and the request.
async function getMovies(lang, genre, searchQuery, skip = 0) {
    const pageNum = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    let baseUrl = searchQuery
        ? `${BASE_URL}/movie/results/?lang=${lang}&query=${encodeURIComponent(searchQuery)}`
        : `${BASE_URL}/movie/results/?lang=${lang}&find=${genre || 'Recent'}`;
    const finalUrl = pageNum > 1 ? `${baseUrl}&page=${pageNum}` : baseUrl;
    console.log(`[SCRAPER][INFO] Visiting movie list page: ${finalUrl}`);

    // This array will be populated by the crawler's requestHandler.
    const movies = []; 
    const crawler = createCrawler();

    // The 'lang' and the 'movies' array are passed into the crawler's context.
    await crawler.run([{
        url: finalUrl,
        userData: { lang, movies }
    }]);

    console.log(`[SCRAPER][INFO] Scraping finished for [${lang}]. Returning ${movies.length} movies.`);
    return movies;
}


// --- Dummy functions below for simplicity. ---
async function getMovieMeta(stremioId) {
    console.log(`[SCRAPER][INFO] Meta requested for ${stremioId}. (Not implemented)`);
    return null;
}

async function getStreamUrls(stremioId) {
    console.log(`[SCRAPER][INFO] Stream requested for ${stremioId}. (Not implemented)`);
    return [];
}


module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
