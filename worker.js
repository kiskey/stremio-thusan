// worker.js
const { scrapePage } = require('./scraper');
const { upsertMovie, getScrapeProgress, updateScrapeProgress } = require('./database');

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada'];
const MAX_PAGES_TO_SCRAPE = parseInt(process.env.MAX_PAGES_TO_SCRAPE || '500', 10);
const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeLanguage(lang, startPage, maxPage) {
    console.log(`[WORKER] Starting job for lang: ${lang}, from page ${startPage} to ${maxPage}.`);
    for (let page = startPage; page <= maxPage; page++) {
        const { movies, rateLimited } = await scrapePage(lang, page);

        if (rateLimited) {
            const delay = Math.random() * 20000 + 10000; // 10s to 30s
            console.log(`[WORKER] Rate limited. Pausing for ${Math.round(delay / 1000)} seconds...`);
            await sleep(delay);
            page--; // Decrement to retry the same page
            continue;
        }

        if (movies.length === 0 && page > 1) {
            console.log(`[WORKER] No movies found on page ${page} for ${lang}. Assuming end of list for this run.`);
            // Mark the full scrape as "done" by setting progress to the max, so it doesn't retry until config changes.
            await updateScrapeProgress(lang, maxPage);
            break;
        }

        for (const movie of movies) {
            await upsertMovie(movie);
        }

        // Update progress after each successful page scrape
        await updateScrapeProgress(lang, page);
        console.log(`[WORKER] Successfully scraped page ${page} for ${lang}. Progress saved.`);

        const politeDelay = Math.random() * 1500 + 500; // 0.5s to 2s
        await sleep(politeDelay);
    }
    console.log(`[WORKER] Finished job for language: ${lang}`);
}

async function runInitialScrape() {
    console.log('[WORKER] Checking for any pending full scrapes...');
    for (const lang of LANGUAGES) {
        const lastPageScraped = await getScrapeProgress(lang);
        if (lastPageScraped < MAX_PAGES_TO_SCRAPE) {
            console.log(`[WORKER] Found pending work for ${lang}. Last scraped: ${lastPageScraped}, Target: ${MAX_PAGES_TO_SCRAPE}.`);
            await scrapeLanguage(lang, lastPageScraped + 1, MAX_PAGES_TO_SCRAPE);
        } else {
            console.log(`[WORKER] Full scrape for ${lang} is already complete.`);
        }
    }
    console.log('[WORKER] Initial scrape check completed.');
}

async function runPeriodicUpdate() {
    console.log('[WORKER] Checking for new releases (first 2 pages)...');
    for (const lang of LANGUAGES) {
        // This job is simple: just scrape the first two pages regardless of past progress.
        await scrapeLanguage(lang, 1, 2); 
    }
    console.log('[WORKER] Periodic update completed.');
}

async function startWorker() {
    // On startup, always check if the full scrape needs to be run or continued.
    await runInitialScrape();

    // After the initial check, schedule periodic updates every 3 hours.
    const threeHours = 3 * 60 * 60 * 1000;
    setInterval(runPeriodicUpdate, threeHours);
    console.log(`[WORKER] Scheduled periodic updates to run every 3 hours.`);
}

module.exports = { startWorker };
