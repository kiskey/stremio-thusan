// tmdb.js
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
    console.warn('[TMDB] WARNING: TMDB_API_KEY is not set. Movie enrichment will be skipped.');
}

function standardizeTitle(title) {
    let cleanedTitle = title;
    cleanedTitle = cleanedTitle.replace(/\s*\(\d{4}\)\s*$/, '');
    const movieSuffixRegex = /\s*\((?:Kannada|Tamil|Malayalam|Hindi|Telugu|)\s*Movie\)/i;
    cleanedTitle = cleanedTitle.replace(movieSuffixRegex, '');
    cleanedTitle = cleanedTitle.replace(/\s*uncut\s*/i, '');
    cleanedTitle = cleanedTitle.replace(/^['"]+|['"]+$/g, '');
    return cleanedTitle.trim();
}

/**
 * Enriches a movie with data from TMDB using a multi-phase strategy.
 * @param {object} movie - A movie object with `title` and `year`.
 * @param {object} options - Optional settings. { cleanTitle: boolean, broadSearch: boolean }
 * @returns {Promise<object|null>} Object with {tmdb_id, imdb_id} or null on network error.
 */
async function enrichMovieFromTMDB(movie, options = {}) {
    if (!TMDB_API_KEY) {
        return null;
    }

    let searchTitle = movie.title;
    if (options.cleanTitle || options.broadSearch) {
        searchTitle = standardizeTitle(movie.title);
        if (searchTitle !== movie.title) {
            console.log(`[TMDB] Standardized title from "${movie.title}" to "${searchTitle}"`);
        }
    }

    try {
        const params = {
            api_key: TMDB_API_KEY,
            query: searchTitle,
            page: 1
        };

        // Phase 1 & 2: Use the year if available.
        if (!options.broadSearch && movie.year) {
            params.year = movie.year;
        }

        // Phase 3: Don't use the year, but add the region bias.
        if (options.broadSearch) {
            params.region = 'IN'; // Bias search to India
        }

        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const searchResponse = await axios.get(searchUrl, { params });

        const searchResults = searchResponse.data.results;
        if (!searchResults || searchResults.length === 0) {
            let failureCode = -1; // Default for Phase 1 failure
            if (options.cleanTitle) failureCode = -3; // Phase 2 failure
            if (options.broadSearch) failureCode = -2; // Phase 3 (final) failure
            
            console.log(`[TMDB] No results for "${searchTitle}" (Phase: ${options.broadSearch ? 3 : (options.cleanTitle ? 2 : 1)}). Marking as ${failureCode}.`);
            return { tmdb_id: failureCode, imdb_id: null };
        }

        const tmdbId = searchResults[0].id;
        const movieUrl = `${TMDB_BASE_URL}/movie/${tmdbId}`;
        const movieResponse = await axios.get(movieUrl, {
            params: { api_key: TMDB_API_KEY, append_to_response: 'external_ids' }
        });

        const imdbId = movieResponse.data.external_ids?.imdb_id;
        console.log(`[TMDB] Enriched "${searchTitle}": TMDB ID=${tmdbId}, IMDb ID=${imdbId}`);
        return { tmdb_id: tmdbId, imdb_id: imdbId };

    } catch (error) {
        console.error(`[TMDB] API Error while enriching "${searchTitle}":`, error.message);
        return null;
    }
}

module.exports = { enrichMovieFromTMDB };
