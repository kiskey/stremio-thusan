// worker.js
const { scrapePage } = require('./scraper');
const { upsertMovie, getMovieCount } = require('./database');

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada'];
const MAX_PAGES_TO_SCRAPE = parseInt(process.env.MAX_PAGES_TO_SCRAPE || '500', 10);
const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeLanguage(lang, maxPages) {
    console.log(`[WORKER] Starting scrape for language: ${lang}, up to ${maxPages} pages.`);
    for (let page = 1; page <= maxPages; page++) {
        const url = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${page}`;
        const { movies, rateLimited } = await scrapePage(lang, 'Recent', null, (page - 1) * 20);

        if (rateLimited) {
            const delay = Math.random() * 20000 + 10000; // 10s to 30s
            console.log(`[WORKER] Rate limited. Pausing for ${Math.round(delay / 1000)} seconds...`);
            await sleep(delay);
            page--; // Decrement to retry the same page
            continue;
        }

        if (movies.length === 0 && page > 1) {
            console.log(`[WORKER] No movies found on page ${page} for ${lang}. Assuming end of list.`);
            break;
        }

        for (const movie of movies) {
            await upsertMovie(movie);
        }

        const politeDelay = Math.random() * 1500 + 500; // 0.5s to 2s
        await sleep(politeDelay);
    }
    console.log(`[WORKER] Finished scrape for language: ${lang}`);
}

async function runInitialScrape() {
    console.log('[WORKER] Starting initial full scrape of all languages...');
    for (const lang of LANGUAGES) {
        await scrapeLanguage(lang, MAX_PAGES_TO_SCRAPE);
    }
    console.log('[WORKER] Initial full scrape completed.');
}

async function runPeriodicUpdate() {
    console.log('[WORKER] Checking for new releases (first 2 pages)...');
    for (const lang of LANGUAGES) {
        await scrapeLanguage(lang, 2);
    }
    console.log('[WORKER] Periodic update completed.');
}

async function startWorker() {
    const movieCount = await getMovieCount();
    if (movieCount < 100) {
        await runInitialScrape();
    } else {
        console.log('[WORKER] Database already populated. Skipping initial full scrape.');
        await runPeriodicUpdate();
    }

    const threeHours = 3 * 60 * 60 * 1000;
    setInterval(runPeriodicUpdate, threeHours);
    console.log(`[WORKER] Scheduled periodic updates to run every 3 hours.`);
}

module.exports = { startWorker };
