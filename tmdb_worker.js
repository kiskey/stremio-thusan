// tmdb_worker.js
const { getUnenrichedMovies, updateMovieEnrichment } = require('./database');
const { enrichMovieFromTMDB } = require('./tmdb');

const BATCH_SIZE = 25; // Increased batch size for faster initial processing

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs one cycle of the enrichment process.
 * @returns {Promise<boolean>} A promise that resolves to true if there might be more work, false otherwise.
 */
async function runEnrichmentCycle() {
    try {
        const moviesToEnrich = await getUnenrichedMovies(BATCH_SIZE);

        if (moviesToEnrich.length === 0) {
            console.log('[TMDB WORKER] No more movies need enrichment.');
            return false; // Signal that the work is done
        }

        console.log(`[TMDB WORKER] Found ${moviesToEnrich.length} movies to enrich in this batch.`);

        for (const movie of moviesToEnrich) {
            const enrichedData = await enrichMovieFromTMDB(movie);
            
            if (enrichedData) {
                await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            }
            await sleep(500); // Small polite delay between individual API calls
        }

        return true; // Signal that there might be more work to do

    } catch (error) {
        console.error('[TMDB WORKER] An error occurred during the enrichment cycle:', error);
        return true; // Assume there's still work to do on error, will retry after a delay
    }
}

function startTmdbWorker() {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) {
        console.log('[TMDB WORKER] TMDB_API_KEY not found. The TMDB enrichment worker will not start.');
        return;
    }
    
    console.log('[TMDB WORKER] Starting TMDB enrichment worker...');
    
    // Immediately Invoked Function Expression (IIFE) to handle the async catch-up process
    (async () => {
        console.log('[TMDB WORKER] Starting initial aggressive catch-up mode...');
        let moreWorkToDo = true;
        while (moreWorkToDo) {
            moreWorkToDo = await runEnrichmentCycle();
            if (moreWorkToDo) {
                // Wait only a few seconds between batches during the aggressive phase
                await sleep(5000); // 5-second delay
            }
        }
        console.log('[TMDB WORKER] Aggressive catch-up mode complete. Switching to periodic checks.');

        // After the backlog is clear, switch to the slower, periodic checks for new content
        const fifteenMinutes = 15 * 60 * 1000;
        setInterval(runEnrichmentCycle, fifteenMinutes);
        console.log(`[TMDB WORKER] Scheduled periodic checks to run every 15 minutes.`);
    })();
}

module.exports = { startTmdbWorker };
