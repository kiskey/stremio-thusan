// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMoviesForCatalog } = require('./database');
const { getStreamUrls } = require('./scraper'); // Still needed for on-demand streams

// ... (manifest definition remains the same)

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const lang = id.replace('einthusan-', '');
    const skip = parseInt(extra.skip || '0', 10);
    const limit = 50; // Number of items per page
    
    console.log(`[ADDON] Serving catalog for ${lang} from database (skip: ${skip})`);
    const metas = await getMoviesForCatalog(lang, extra.genre, skip, limit);
    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[ADDON] Serving meta for ${id} from database`);
    const meta = await getMovieForMeta(id);
    return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[ADDON] Fetching on-demand streams for ${id}`);
    // First, get the movie's page URL from the database
    const movie = await getMovieForMeta(id);
    if (!movie || !movie.movie_page_url) {
        return { streams: [] };
    }
    const streams = await getStreamUrls(movie.movie_page_url);
    return { streams };
});

module.exports = builder.getInterface();
