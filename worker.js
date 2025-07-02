// worker.js
const { scrapePage } = require('./scraper');
const { upsertMovie, getScrapeProgress, updateScrapeProgress, setFullScrapeCompleted } = require('./database');

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada'];
const MAX_PAGES_TO_SCRAPE = parseInt(process.env.MAX_PAGES_TO_SCRAPE || '500', 10);
const SKIP_INITIAL_SCRAPE = process.env.SKIP_INITIAL_SCRAPE === 'true';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeLanguage(lang, startPage, maxPage, isFullScrape = false) {
    console.log(`[WORKER] Starting job for lang: ${lang}, from page ${startPage} to ${maxPage}. (Full scrape: ${isFullScrape})`);
    
    let jobCompletedSuccessfully = true;

    for (let page = startPage; page <= maxPage; page++) {
        const { movies, rateLimited } = await scrapePage(lang, page);

        if (rateLimited) {
            console.log(`[WORKER] Rate limited on page ${page}. Pausing job and will retry later.`);
            jobCompletedSuccessfully = false;
            break;
        }

        if (movies.length === 0 && page > 1) {
            console.log(`[WORKER] No movies found on page ${page} for ${lang}. Assuming end of list.`);
            break;
        }

        for (const movie of movies) {
            await upsertMovie(movie);
        }

        if (isFullScrape) {
            await updateScrapeProgress(lang, page);
        }
        console.log(`[WORKER] Successfully scraped page ${page} for ${lang}.`);
        
        await sleep(Math.random() * 1500 + 500);
    }
    
    if (isFullScrape && jobCompletedSuccessfully) {
        await setFullScrapeCompleted(lang);
    }

    console.log(`[WORKER] Finished job for language: ${lang}`);
}

async function runInitialScrape() {
    if (SKIP_INITIAL_SCRAPE) {
        console.log('[WORKER] SKIP_INITIAL_SCRAPE is set to true. The addon will assume the initial scrape is complete.');
    }

    console.log('[WORKER] Checking for any pending full scrapes...');
    for (const lang of LANGUAGES) {
        const progress = await getScrapeProgress(lang);

        if (SKIP_INITIAL_SCRAPE && !progress.isCompleted) {
            console.log(`[WORKER] Forcing 'full_scrape_completed' flag for ${lang} due to environment variable.`);
            await setFullScrapeCompleted(lang);
            continue;
        }

        if (!progress.isCompleted) {
            console.log(`[WORKER] Found pending full scrape work for ${lang}. Last page: ${progress.lastPage}. Target: ${MAX_PAGES_TO_SCRAPE}.`);
            await scrapeLanguage(lang, progress.lastPage + 1, MAX_PAGES_TO_SCRAPE, true);
        } else {
            console.log(`[WORKER] Full scrape for ${lang} is already complete (according to DB). Skipping.`);
        }
    }
    console.log('[WORKER] Initial scrape check completed.');
}

async function runPeriodicUpdate() {
    console.log('[WORKER] Checking for new releases (first 2 pages)...');
    for (const lang of LANGUAGES) {
        await scrapeLanguage(lang, 1, 2); 
    }
    console.log('[WORKER] Periodic update completed.');
}

async function startWorker() {
    await runInitialScrape();

    const threeHours = 3 * 60 * 60 * 1000;
    setInterval(runPeriodicUpdate, threeHours);
    console.log(`[WORKER] Scheduled periodic updates to run every 3 hours.`);
}

module.exports = { startWorker };
