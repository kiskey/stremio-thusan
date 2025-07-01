// scraper.js
const fs = require('fs');
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const ITEMS_PER_PAGE = 20;

crawleeLogger.setLevel(LogLevel.INFO);

function log(message, level = 'info') {
    if (process.env.LOG_LEVEL === 'debug' || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

function createCrawler() {
    return new CheerioCrawler({
        requestHandler: async (context) => {
            if (typeof context.request.handler === 'function') {
                await context.request.handler(context);
            }
        },
        navigationTimeoutSecs: 45,
        maxRequestRetries: 2,
    });
}

async function getMovies(lang, genre, searchQuery, skip = 0) {
    const pageNum = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    let baseUrl = searchQuery
        ? `${BASE_URL}/movie/results/?lang=${lang}&query=${encodeURIComponent(searchQuery)}`
        : `${BASE_URL}/movie/results/?lang=${lang}&find=${genre || 'Recent'}`;
    const finalUrl = pageNum > 1 ? `${baseUrl}&page=${pageNum}` : baseUrl;
    log(`Visiting movie list page: ${finalUrl}`);

    const movies = [];
    const crawler = createCrawler();

    await crawler.run([{
        url: finalUrl,
        handler: ({ $, body }) => {
            const selector = '#UIMovieSummary > ul > li';
            log(`HTML received for ${lang}. Parsing with selector: "${selector}"`);

            const movieElements = $(selector);

            if (movieElements.length === 0) {
                log(`Found 0 movie elements for [${lang}]. The page might be empty or is blocking the crawler.`, 'error');
                const debugFileName = `debug-content-EMPTY-${lang}.html`;
                fs.writeFileSync(debugFileName, body);
                log(`SAVED HTML to ./${debugFileName} for inspection.`);
                return; // Exit if no list items are found at all
            }
            
            log(`Found ${movieElements.length} potential movie list items for [${lang}]. Looping through them...`);
            movieElements.each((i, el) => {
                const listItem = $(el);

                // --- POWERFUL DEBUGGING STEP ---
                // We will log the HTML of the first 2 list items to see their structure.
                if (i < 2) {
                    log(`[DEBUG HTML for list item #${i}]:\n${listItem.html()}`);
                }

                // --- SIMPLIFIED AND CORRECTED SUB-SELECTORS ---
                const title = listItem.find('.block2 h3').text().trim();
                const linkElement = listItem.find('.block1 a');
                const href = linkElement.attr('href');
                
                if (title && href) {
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    
                    if (idMatch) {
                        log(`  [+] SUCCESS: Extracted "${title}"`);
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                            type: 'movie',
                            name: title,
                            poster: poster && poster.startsWith('http') ? poster : `https:${poster}`,
                        });
                    } else {
                        log(`  [-] FAILED: Found title "${title}" but could not extract a valid ID from href: "${href}"`);
                    }
                } else {
                     log(`  [-] FAILED: Could not extract a title or href for list item #${i}.`);
                }
            });
        }
    }]);

    log(`Scraping finished for ${lang}. Returning ${movies.length} movies.`);
    return movies;
}

// --- Dummy functions below for simplicity. The main focus is fixing the catalog. ---

async function getMovieMeta(stremioId) {
    log(`Meta requested for ${stremioId}. (To be implemented)`);
    return null;
}

async function getStreamUrls(stremioId) {
    log(`Stream requested for ${stremioId}. (To be implemented)`);
    return [];
}


module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
