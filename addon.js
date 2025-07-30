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
    version: '5.0.0', // Final, robust version with Hybrid IDs
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
    
    // The meta handler now also parses the hybrid ID to fetch the specific record.
    const idParts = id.split(':');
    let result;

    if (id.startsWith('tt') && idParts.length > 1) {
        // This is a Hybrid ID like 'tt12345:ein:lang:id'. We use the internal part.
        const internalId = idParts.slice(1).join(':');
        console.log(`[ADDON] Hybrid ID detected. Using internal ID for meta: ${internalId}`);
        result = await getMovieForMeta(internalId);
    } else if (id.startsWith('tt')) {
        // This is a pure IMDb ID lookup.
        console.log(`[ADDON] Pure IMDb ID detected. Looking up best match: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        // This is one of our internal IDs without an IMDb entry.
        result = await getMovieForMeta(id);
    }

    return { meta: result.meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching streams for ID: ${id}`);

    // The stream handler parses the hybrid ID to get the exact internal ID.
    const idParts = id.split(':');
    let result;

    if (id.startsWith('tt') && idParts.length > 1) {
        // This is our primary, context-aware path for enriched movies.
        const internalId = idParts.slice(1).join(':');
        console.log(`[ADDON] Hybrid ID detected. Using internal ID for stream: ${internalId}`);
        result = await getMovieForMeta(internalId);
    } else if (id.startsWith('tt')) {
        // Fallback for requests from other addons that only know the IMDb ID.
        console.log(`[ADDON] Pure IMDb ID stream request. Looking up best match: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        // Path for unenriched movies.
        result = await getMovieForMeta(id);
    }
    
    const movie = result.meta;
    if (!movie || !movie.movie_page_url) {
        console.error(`[ADDON] Could not find movie page URL for ID: ${id}`);
        return { streams: [] };
    }
    
    const streams = await getStreamUrls(movie);
    return { streams };
});

module.exports = builder.getInterface();
