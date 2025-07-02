// tmdb.js
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
    console.warn('[TMDB] WARNING: TMDB_API_KEY is not set. Movie enrichment will be skipped.');
}

/**
 * Takes a movie object and enriches it with data from The Movie Database (TMDB).
 * @param {object} movie - A movie object containing at least `title` and `year`.
 * @returns {Promise<object|null>} A promise that resolves to an object with {tmdb_id, imdb_id} or null if a network error occurs.
 */
async function enrichMovieFromTMDB(movie) {
    if (!TMDB_API_KEY) {
        return null;
    }

    try {
        // Step 1: Search for the movie by title and year to find its TMDB ID.
        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const searchResponse = await axios.get(searchUrl, {
            params: {
                api_key: TMDB_API_KEY,
                query: movie.title,
                year: movie.year,
                page: 1
            }
        });

        const searchResults = searchResponse.data.results;
        if (!searchResults || searchResults.length === 0) {
            console.log(`[TMDB] No results found for "${movie.title}" (${movie.year}). Marking as processed.`);
            return { tmdb_id: -1, imdb_id: null }; // Use -1 to signify "not found"
        }

        const tmdbId = searchResults[0].id;

        // Step 2: Get the full movie details using the found TMDB ID to get the IMDb ID.
        const movieUrl = `${TMDB_BASE_URL}/movie/${tmdbId}`;
        const movieResponse = await axios.get(movieUrl, {
            params: {
                api_key: TMDB_API_KEY,
                append_to_response: 'external_ids'
            }
        });

        const imdbId = movieResponse.data.external_ids?.imdb_id;

        if (!imdbId) {
            console.log(`[TMDB] Found TMDB ID (${tmdbId}) but no IMDb ID for "${movie.title}".`);
        } else {
            console.log(`[TMDB] Enriched "${movie.title}": TMDB ID=${tmdbId}, IMDb ID=${imdbId}`);
        }
        
        return { tmdb_id: tmdbId, imdb_id: imdbId };

    } catch (error) {
        console.error(`[TMDB] API Error while enriching movie "${movie.title}":`, error.message);
        return null; // Return null to signal that this movie should be retried later.
    }
}

module.exports = { enrichMovieFromTMDB };
