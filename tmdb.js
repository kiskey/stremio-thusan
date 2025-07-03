// tmdb.js
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
    console.warn('[TMDB] WARNING: TMDB_API_KEY is not set. Movie enrichment will be skipped.');
}

/**
 * Cleans a movie title by removing common artifacts that interfere with searching.
 * @param {string} title - The original movie title.
 * @returns {string} The cleaned title.
 */
function standardizeTitle(title) {
    let cleanedTitle = title;
    
    // Remove year in parentheses, e.g., "Movie (2024)" -> "Movie"
    cleanedTitle = cleanedTitle.replace(/\s*\(\d{4}\)\s*$/, '');
    
    // Remove "(Language Movie)" or "(Movie)" suffixes (case-insensitive)
    const movieSuffixRegex = /\s*\((?:Kannada|Tamil|Malayalam|Hindi|Telugu|)\s*Movie\)/i;
    cleanedTitle = cleanedTitle.replace(movieSuffixRegex, '');

    // Remove "UNCUT" (case-insensitive)
    cleanedTitle = cleanedTitle.replace(/\s*uncut\s*/i, '');

    // Remove leading/trailing quotes (single or double)
    cleanedTitle = cleanedTitle.replace(/^['"]+|['"]+$/g, '');
    
    // Trim whitespace from the ends
    return cleanedTitle.trim();
}

/**
 * Enriches a movie with data from TMDB, with an option to clean the title first.
 * @param {object} movie - A movie object with `title` and `year`.
 * @param {object} options - Optional settings. { cleanTitle: boolean }
 * @returns {Promise<object|null>} Object with {tmdb_id, imdb_id} or null on network error.
 */
async function enrichMovieFromTMDB(movie, options = {}) {
    if (!TMDB_API_KEY) {
        return null;
    }

    let searchTitle = movie.title;
    if (options.cleanTitle) {
        searchTitle = standardizeTitle(movie.title);
        if (searchTitle !== movie.title) {
            console.log(`[TMDB] Standardized title from "${movie.title}" to "${searchTitle}"`);
        }
    }

    try {
        // --- THIS IS THE CORE BUG FIX ---
        // Build the params object programmatically to handle missing years.
        const params = {
            api_key: TMDB_API_KEY,
            query: searchTitle,
            page: 1
        };
        // Only add the year to the search if it exists in our database.
        if (movie.year) {
            params.year = movie.year;
        }

        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const searchResponse = await axios.get(searchUrl, { params });

        const searchResults = searchResponse.data.results;
        if (!searchResults || searchResults.length === 0) {
            const failureCode = options.cleanTitle ? -2 : -1;
            console.log(`[TMDB] No results for "${searchTitle}" (Year: ${movie.year || 'N/A'}). Marking as ${failureCode}.`);
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
