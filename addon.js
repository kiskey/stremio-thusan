// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMoviesForCatalog, getHighestPriorityMovie, searchMovies } = require('./database');
const { getStreamUrls } = require('./auth');
const { ID_PREFIX } = require('./scraper');

const LANGUAGES = [
    { code: 'tamil', name: 'Tamil' },
    { code: 'hindi', name: 'Hindi' },
    { code: 'telugu', name: 'Telugu' },
    { code: 'malayalam', name: 'Malayalam' },
    { code: 'kannada', name: 'Kannada' },
];

// R6: 'meta' resource is removed to delegate all metadata to Cinemata.
const manifest = {
    id: 'org.einthusan.stremio.db',
    version: '10.0.0', // Version bump for major logic change.
    name: 'Einthusan (DB)',
    description: 'A persistent, database-backed addon for Einthusan with prioritized language handling.',
    resources: ['catalog', 'stream'], // 'meta' handler is disabled.
    types: ['movie'],
    catalogs: LANGUAGES.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    })),
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const lang = id.replace('einthusan-', '');
    const searchTerm = extra.search;

    let movies = [];

    // R4 & R5: The database functions now handle the complex unique listing logic.
    if (searchTerm) {
        console.log(`[ADDON] Handling search request for "${searchTerm}" in ${lang}`);
        movies = await searchMovies(lang, searchTerm);
    } else {
        const skip = parseInt(extra.skip || '0', 10);
        const limit = 30;
        console.log(`[ADDON] Serving catalog for ${lang} from database (skip: ${skip})`);
        movies = await getMoviesForCatalog(lang, skip, limit);
    }

    // R6: Create meta stubs with the standard IMDb ID for Cinemata to handle.
    const metas = movies.map(movie => ({
            id: movie.imdb_id,
            type: 'movie',
            name: movie.title,
            poster: movie.poster,
        }));

    return { metas };
});

// R6: The meta handler is removed entirely.

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching streams for ID: ${id}`);
    
    if (!id.startsWith('tt')) {
        console.warn(`[ADDON] Stream handler received non-IMDb ID: ${id}. Cannot process.`);
        return { streams: [] };
    }

    // R7 & R8: Fetch the single highest-priority movie record for this IMDb ID.
    const movie = await getHighestPriorityMovie(id);

    if (!movie) {
        console.error(`[ADDON] Could not find a suitable movie record for ID: ${id}`);
        return { streams: [] };
    }
    
    console.log(`[ADDON] Found highest priority version for ${id} in language: ${movie.lang}`);

    if (!movie.movie_page_url) {
        console.error(`[ADDON] Movie record found for ${id}, but it is incomplete (missing movie_page_url).`);
        return { streams: [] };
    }
    
    // R9 & R10: getStreamUrls will now receive the correct movie object and format titles accordingly.
    const streams = await getStreamUrls(movie);
    return { streams };
});

module.exports = builder.getInterface();
