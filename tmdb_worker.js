// tmdb_worker.js
const { getUnenrichedMovies, getFailedEnrichmentMovies, getBroadSearchMovies, updateMovieEnrichment } = require('./database');
const { enrichMovieFromTMDB } = require('./tmdb');

const BATCH_SIZE = 25;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFullEnrichmentProcess() {
    let workWasDone = false;

    // --- Phase 1: First Pass (Strict: original title + year) ---
    const newMovies = await getUnenrichedMovies(BATCH_SIZE);
    if (newMovies.length > 0) {
        workWasDone = true;
        console.log(`[TMDB WORKER] Phase 1: Found ${newMovies.length} new movies.`);
        for (const movie of newMovies) {
            const enrichedData = await enrichMovieFromTMDB(movie);
            if (enrichedData) await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            await sleep(250); // Shorter delay as these are distinct API calls
        }
    }

    // --- Phase 2: Second Pass (Standardized: cleaned title + year) ---
    const failedMovies = await getFailedEnrichmentMovies(BATCH_SIZE);
    if (failedMovies.length > 0) {
        workWasDone = true;
        console.log(`[TMDB WORKER] Phase 2: Found ${failedMovies.length} movies for standardized retry.`);
        for (const movie of failedMovies) {
            const enrichedData = await enrichMovieFromTMDB(movie, { cleanTitle: true });
            if (enrichedData) await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            await sleep(250);

        }
    }

    // --- Phase 3: Third Pass (Broad: cleaned title + no year + region=IN) ---
    const broadSearchMovies = await getBroadSearchMovies(BATCH_SIZE);
    if (broadSearchMovies.length > 0) {
        workWasDone = true;
        console.log(`[TMDB WORKER] Phase 3: Found ${broadSearchMovies.length} movies for broad, regional search.`);
        for (const movie of broadSearchMovies) {
            const enrichedData = await enrichMovieFromTMDB(movie, { broadSearch: true });
            if (enrichedData) await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            await sleep(250);
        }
    }
    
    if (!workWasDone) {
        console.log('[TMDB WORKER] All enrichment phases complete. No movies needed processing in this cycle.');
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
                await sleep(5000); // 5-second delay between full 3-phase cycles
            }
        }
        console.log('[TMDB WORKER] Aggressive catch-up mode complete. Switching to periodic checks.');

        const fifteenMinutes = 15 * 60 * 1000;
        setInterval(runFullEnrichmentProcess, fifteenMinutes);
        console.log(`[TMDB WORKER] Scheduled periodic checks to run every 15 minutes.`);
    })();
}

module.exports = { startTmdbWorker };
