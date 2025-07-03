// tmdb_worker.js
const { getUnenrichedMovies, getFailedEnrichmentMovies, updateMovieEnrichment } = require('./database');
const { enrichMovieFromTMDB } = require('./tmdb');

const BATCH_SIZE = 25;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs the full two-phase enrichment process.
 * @returns {Promise<boolean>} Resolves to true if any work was done, false otherwise.
 */
async function runFullEnrichmentProcess() {
    let workWasDone = false;

    // --- Phase 1: First Pass for new movies (tmdb_id IS NULL) ---
    console.log('[TMDB WORKER] Starting Phase 1: Processing new movies.');
    const newMovies = await getUnenrichedMovies(BATCH_SIZE);
    if (newMovies.length > 0) {
        workWasDone = true;
        console.log(`[TMDB WORKER] Phase 1: Found ${newMovies.length} new movies to process.`);
        for (const movie of newMovies) {
            const enrichedData = await enrichMovieFromTMDB(movie); // No cleaning options
            if (enrichedData) {
                await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            }
            await sleep(500);
        }
    } else {
        console.log('[TMDB WORKER] Phase 1: No new movies to process.');
    }

    // --- Phase 2: Second Pass for movies that failed once (tmdb_id = -1) ---
    console.log('[TMDB WORKER] Starting Phase 2: Retrying failed movies with title standardization.');
    const failedMovies = await getFailedEnrichmentMovies(BATCH_SIZE);
    if (failedMovies.length > 0) {
        workWasDone = true;
        console.log(`[TMDB WORKER] Phase 2: Found ${failedMovies.length} failed movies to retry.`);
        for (const movie of failedMovies) {
            // Pass the cleanTitle option for the second attempt
            const enrichedData = await enrichMovieFromTMDB(movie, { cleanTitle: true });
            if (enrichedData) {
                await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            }
            await sleep(500);
        }
    } else {
        console.log('[TMDB WORKER] Phase 2: No failed movies to retry.');
    }
    
    return workWasDone;
}


function startTmdbWorker() {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) {
        console.log('[TMDB WORKER] TMDB_API_KEY not found. The TMDB enrichment worker will not start.');
        return;
    }
    
    console.log('[TMDB WORKER] Starting TMDB enrichment worker...');
    
    (async () => {
        console.log('[TMDB WORKER] Starting initial aggressive catch-up mode...');
        let moreWorkToDo = true;
        while (moreWorkToDo) {
            moreWorkToDo = await runFullEnrichmentProcess();
            if (moreWorkToDo) {
                await sleep(5000); // 5-second delay between full cycles
            }
        }
        console.log('[TMDB WORKER] Aggressive catch-up mode complete. Switching to periodic checks.');

        const fifteenMinutes = 15 * 60 * 1000;
        setInterval(runFullEnrichmentProcess, fifteenMinutes);
        console.log(`[TMDB WORKER] Scheduled periodic checks to run every 15 minutes.`);
    })();
}

module.exports = { startTmdbWorker };
