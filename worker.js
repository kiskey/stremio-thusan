// worker.js
const { scrapePage } = require('./scraper');
const { upsertMovie } = require('./database');

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada'];
const TOTAL_PAGES_PER_LANG = 500; // A reasonable estimate

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAllLanguages() {
    console.log('[WORKER] Starting full scrape of all languages...');
    for (const lang of LANGUAGES) {
        console.log(`[WORKER] Starting scrape for language: ${lang}`);
        for (let page = 1; page <= TOTAL_PAGES_PER_LANG; page++) {
            const url = `https://einthusan.tv/movie/results/?find=Recent&lang=${lang}&page=${page}`;
            const { movies, rateLimited } = await scrapePage(url);

            if (rateLimited) {
                console.log('[WORKER] Rate limited. Pausing for 60 seconds...');
                await sleep(60000);
                page--; // Retry the same page after the pause
                continue;
            }

            if (movies.length === 0) {
                console.log(`[WORKER] No movies found on page ${page} for ${lang}. Assuming end of list.`);
                break; // Stop scraping this language if a page is empty
            }

            for (const movie of movies) {
                await upsertMovie(movie);
            }

            // Polite random delay
            const delay = Math.random() * 2000 + 500; // 0.5s to 2.5s
            await sleep(delay);
        }
        console.log(`[WORKER] Finished scrape for language: ${lang}`);
    }
    console.log('[WORKER] Full scrape completed.');
}

async function checkForUpdates() {
    console.log('[WORKER] Checking for new releases (Page 1 of all languages)...');
    // This function would be similar to scrapeAllLanguages but only ever scrapes page=1
    // It can be run on a more frequent schedule.
}

function startWorker() {
    // Initial full scrape
    scrapeAllLanguages();

    // Schedule periodic checks
    setInterval(checkForUpdates, 60 * 60 * 1000); // Check for updates every hour
    setInterval(scrapeAllLanguages, 24 * 60 * 60 * 1000); // Do a full re-scrape once a day
}

module.exports = { startWorker };
