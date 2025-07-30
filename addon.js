// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMoviesForCatalog, getMovieForMeta, getMovieByImdbId, searchMovies } = require('./database');
const { getStreamUrls } = require('./auth');
const { ID_PREFIX } = require('./scraper');

const LANGUAGES = [
    { code: 'tamil', name: 'Tamil' },
    { code: 'hindi', name: 'Hindi' },
    { code: 'telugu', name: 'Telugu' },
    { code: 'malayalam', name: 'Malayalam' },
    { code: 'kannada', name: 'Kannada' },
];

const manifest = {
    id: 'org.einthusan.stremio.db',
    version: '8.0.0', // Definitive version with correct ID and aggregation handling
    name: 'Einthusan (DB)',
    description: 'A persistent, database-backed addon for Einthusan with background scraping and TMDB enrichment.',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    catalogs: LANGUAGES.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    })),
    idPrefixes: [ID_PREFIX, 'tt']
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const lang = id.replace('einthusan-', '');
    const searchTerm = extra.search;

    let metas = [];

    if (searchTerm) {
        console.log(`[ADDON] Handling search request for "${searchTerm}" in ${lang}`);
        metas = await searchMovies(lang, searchTerm);
    } else {
        const skip = parseInt(extra.skip || '0', 10);
        const limit = 30;
        console.log(`[ADDON] Serving catalog for ${lang} from database (skip: ${skip})`);
        metas = await getMoviesForCatalog(lang, skip, limit);
    }

    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[ADDON] Serving meta for ID: ${id}`);
    
    let result;
    if (id.startsWith('tt')) {
        // This handles a pure IMDb ID lookup from another addon or global search.
        console.log(`[ADDON] Pure IMDb ID detected for meta. Looking up best match: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        // This handles a request for one of our specific internal IDs.
        result = await getMovieForMeta(id);
    }

    return { meta: result.meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching streams for ID: ${id}`);
    
    // This logic is now simple and correct. The 'id' received here is always
    // the specific, context-aware ID we need, because it comes from either:
    // a) Our addon's meta object, where the primary 'id' is our internal ID.
    // b) A lookup from another addon, where the 'id' is an IMDb ID.
    let result;
    if (id.startsWith('tt')) {
        console.log(`[ADDON] Pure IMDb ID detected for stream. Looking up best match: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        console.log(`[ADDON] Internal ID received. Fetching exact record: ${id}`);
        result = await getMovieForMeta(id);
    }
    
    const movie = result.meta;

    if (!movie || !movie.movie_page_url) {
        console.error(`[ADDON] Could not find movie page URL for ID: ${id}`);
        return { streams: [] };
    }
    
    // The 'movie' object is now guaranteed to be the correct one from the user's selection.
    const streams = await getStreamUrls(movie);
    return { streams };
});

module.exports = builder.getInterface();
