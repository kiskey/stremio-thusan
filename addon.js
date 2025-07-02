// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMoviesForCatalog, getMovieForMeta } = require('./database');
// --- FIX: Importing ID_PREFIX ---
const { getStreamUrls, ID_PREFIX } = require('./scraper');

const LANGUAGES = [
    { code: 'tamil', name: 'Tamil' },
    { code: 'hindi', name: 'Hindi' },
    { code: 'telugu', name: 'Telugu' },
    { code: 'malayalam', name: 'Malayalam' },
    { code: 'kannada', name: 'Kannada' },
];

const manifest = {
    id: 'org.einthusan.stremio',
    version: '3.3.0', // Final working version
    name: 'Einthusan (DB)',
    description: 'A persistent, database-backed addon for Einthusan with background scraping.',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    catalogs: LANGUAGES.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    })),
    // This line will now work correctly
    idPrefixes: [ID_PREFIX]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const lang = id.replace('einthusan-', '');
    const skip = parseInt(extra.skip || '0', 10);
    const limit = 30;
    
    console.log(`[ADDON] Serving catalog for ${lang} from database (skip: ${skip})`);
    const metas = await getMoviesForCatalog(lang, skip, limit);
    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[ADDON] Serving meta for ${id} from database`);
    const meta = await getMovieForMeta(id);
    return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching on-demand streams for ${id}`);
    const movie = await getMovieForMeta(id);
    if (!movie || !movie.movie_page_url) {
        console.error(`[ADDON] Could not find movie page URL for ID: ${id}`);
        return { streams: [] };
    }
    const streams = await getStreamUrls(movie.movie_page_url);
    return { streams };
});

module.exports = builder.getInterface();
