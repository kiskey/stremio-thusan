// tmdb_worker.js
const { getUnenrichedMovies, updateMovieEnrichment } = require('./database');
const { enrichMovieFromTMDB } = require('./tmdb');

const BATCH_SIZE = 10; // Number of movies to process at once
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds to be polite to the TMDB API

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runEnrichmentCycle() {
    console.log('[TMDB WORKER] Starting enrichment cycle...');
    try {
        const moviesToEnrich = await getUnenrichedMovies(BATCH_SIZE);

        if (moviesToEnrich.length === 0) {
            console.log('[TMDB WORKER] No movies need enrichment. Cycle finished.');
            return;
        }

        console.log(`[TMDB WORKER] Found ${moviesToEnrich.length} movies to enrich.`);

        for (const movie of moviesToEnrich) {
            const enrichedData = await enrichMovieFromTMDB(movie);
            
            // This will be an object even if no result was found, so we update to prevent retries
            if (enrichedData) {
                await updateMovieEnrichment(movie.id, enrichedData.tmdb_id, enrichedData.imdb_id);
            }
            // A small delay between individual API calls
            await sleep(500);
        }

    } catch (error) {
        console.error('[TMDB WORKER] An error occurred during the enrichment cycle:', error);
    }
    console.log(`[TMDB WORKER] Enrichment cycle complete. Will run again later.`);
}

function startTmdbWorker() {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) {
        console.log('[TMDB WORKER] TMDB_API_KEY not found. The TMDB enrichment worker will not start.');
        return;
    }
    
    console.log('[TMDB WORKER] Starting TMDB enrichment worker...');
    
    // Run once on start to catch up
    runEnrichmentCycle();

    // Then run every 15 minutes to catch new scrapes
    const fifteenMinutes = 15 * 60 * 1000;
    setInterval(runEnrichmentCycle, fifteenMinutes);
    
    console.log(`[TMDB WORKER] Scheduled to run every 15 minutes.`);
}

// Create a tmdb.js file with enrichMovieFromTMDB function
// For now, defining a placeholder to avoid crashes if the file is missing
const tmdb = require('./tmdb');
if (!tmdb.enrichMovieFromTMDB) {
    tmdb.enrichMovieFromTMDB = async () => { 
        console.error('[TMDB] Placeholder function called. Please create tmdb.js');
        return null; 
    };
}


module.exports = { startTmdbWorker };
