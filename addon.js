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
    version: '4.2.1', // Version updated for stream title fix
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
    console.log(`[ADDON] Serving meta for ${id}`);
    
    let result;
    if (id.startsWith('tt')) {
        console.log(`[ADDON] Meta request is for an IMDb ID: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        result = await getMovieForMeta(id);
    }

    return { meta: result.meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching on-demand streams for ${id}`);

    let result;
    if (id.startsWith('tt')) {
        console.log(`[ADDON] Stream request is for an IMDb ID: ${id}`);
        result = await getMovieByImdbId(id);
    } else {
        result = await getMovieForMeta(id);
    }
    
    const movie = result.meta;
    if (!movie || !movie.movie_page_url) {
        console.error(`[ADDON] Could not find movie page URL for ID: ${id}`);
        return { streams: [] };
    }
    
    // ** THE FIX IS HERE **
    // Pass the entire 'movie' meta object to the stream generator.
    // This guarantees all necessary data (like is_uhd) is available.
    const streams = await getStreamUrls(movie);
    return { streams };
});

module.exports = builder.getInterface();
