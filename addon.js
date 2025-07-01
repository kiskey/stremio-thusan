// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMovies, getMovieMeta, getStreamUrls, ID_PREFIX } = require('./scraper');

// --- LANGUAGES UPDATED AS REQUESTED ---
const LANGUAGES = [
    { code: 'tamil', name: 'Tamil' },
    { code: 'hindi', name: 'Hindi' },
    { code: 'telugu', name: 'Telugu' },
    { code: 'malayalam', name: 'Malayalam' },
    { code: 'kannada', name: 'Kannada' },
];

const genres = [
    { key: 'Recent', name: 'Recently Added' },
    { key: 'Popularity', name: 'Most Watched' },
    { key: 'StaffPick', name: 'Staff Picks' }
];

const manifest = {
    id: 'org.einthusan.stremio',
    version: '1.9.0', // Final working version
    name: 'Einthusan',
    description: 'A robust addon for Einthusan movies with advanced debugging.',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    catalogs: LANGUAGES.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        genres: genres.map(g => g.name),
        extra: [
            { name: "search", isRequired: false },
            { name: "genre", isRequired: false, options: genres.map(g => g.name) },
            { name: "skip", isRequired: false }
        ]
    })),
    idPrefixes: [ID_PREFIX]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`[HTTP Request] Catalog: ${id}, Extra: ${JSON.stringify(extra)}`);
    let metas = [];
    const lang = id.replace('einthusan-', '');
    const searchQuery = extra.search;
    const selectedGenreName = extra.genre;
    const skip = parseInt(extra.skip || '0', 10);
    let genreKey = 'Recent';
    if (selectedGenreName) {
        const foundGenre = genres.find(g => g.name === selectedGenreName);
        if (foundGenre) genreKey = foundGenre.key;
    }
    try {
        metas = await getMovies(lang, genreKey, searchQuery, skip);
    } catch (error) {
        console.error(`[ERROR] In Catalog Handler for ${id}:`, error);
    }
    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[HTTP Request] Meta: ${id}`);
    if (type === 'movie' && id.startsWith(ID_PREFIX)) {
        try {
            const meta = await getMovieMeta(id);
            return { meta };
        } catch (error) {
            console.error(`[ERROR] In Meta Handler for ${id}:`, error);
            return { meta: null };
        }
    }
    return { meta: null };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[HTTP Request] Stream: ${id}`);
    let streams = [];
    if (type === 'movie' && id.startsWith(ID_PREFIX)) {
        try {
            streams = await getStreamUrls(id);
        } catch (error) {
            console.error(`[ERROR] In Stream Handler for ${id}:`, error);
        }
    }
    return { streams };
});

module.exports = builder.getInterface();
