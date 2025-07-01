// scraper.js
const fs = require('fs'); // Import the Node.js File System module
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const ITEMS_PER_PAGE = 20;

// Set crawlee's log level. 'INFO' is standard, 'DEBUG' is for extreme verbosity.
crawleeLogger.setLevel(LogLevel.INFO);

function log(message, level = 'info') {
    if (process.env.LOG_LEVEL === 'debug' || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

// This function creates a new, isolated crawler for each request to prevent race conditions.
function createCrawler() {
    return new CheerioCrawler({
        requestHandler: async (context) => {
            // This is our main dispatcher. It calls the 'handler' we attach to each request.
            if (typeof context.request.handler === 'function') {
                await context.request.handler(context);
            }
        },
        // We will keep navigation timeouts generous just in case of slow network.
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
        handler: ({ $, body }) => { // We destructure 'body' to get the raw HTML
            
            // This is the selector from the HTML you provided.
            const selector = '#UIMovieSummary > ul > li';
            log(`HTML received for ${lang}. Parsing with selector: "${selector}"`);

            const movieElements = $(selector);
            
            if (movieElements.length === 0) {
                log(`Found 0 movie elements for [${lang}]. The page might be empty or is blocking the crawler.`, 'error');
                
                // --- POWERFUL DEBUGGING AS REQUESTED ---
                // Save the exact HTML content the crawler received to a file.
                const debugFileName = `debug-content-${lang}.html`;
                fs.writeFileSync(debugFileName, body);
                log(`SAVED HTML to ./${debugFileName} for inspection.`);
                
            } else {
                log(`Found ${movieElements.length} movie elements on the page for [${lang}].`);
                movieElements.each((i, el) => {
                    const listItem = $(el); // The current <li> element
                    const titleElement = listItem.find('.block2 a.title h3');
                    const title = titleElement.text().trim();
                    
                    if (title) { // Ensure there is a title before proceeding
                        const linkElement = listItem.find('.block1 a');
                        const href = linkElement.attr('href');
                        const poster = listItem.find('.block1 img').attr('src');
                        const idMatch = href ? href.match(/\/watch\/([a-zA-Z0-9.-]+)\//) : null;
                        
                        if (idMatch) {
                            log(`  [+] Found: ${title}`);
                            movies.push({
                                id: `${ID_PREFIX}:${lang}:${idMatch[1]}`,
                                type: 'movie',
                                name: title,
                                poster: poster && poster.startsWith('http') ? poster : `https:${poster}`,
                            });
                        }
                    }
                });
            }
        }
    }]);

    log(`Scraping finished for ${lang}. Returning ${movies.length} movies.`);
    return movies;
}

// --- Dummy functions below for simplicity. The main focus is fixing the catalog. ---

async function getMovieMeta(stremioId) {
    log(`Meta requested for ${stremioId}. (Not implemented in this version)`);
    return null;
}

async function getStreamUrls(stremioId) {
    log(`Stream requested for ${stremioId}. (Not implemented in this version)`);
    return [];
}


module.exports = { 
    getMovies, 
    getMovieMeta, 
    getStreamUrls,
    ID_PREFIX
};
