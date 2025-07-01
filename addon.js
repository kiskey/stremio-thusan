// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getMovies, getMovieMeta, getStreamUrls, ID_PREFIX } = require('./scraper');

// --- THE FIX IS HERE ---
// 1. Hardcode the static list of languages. This is faster and more reliable.
const LANGUAGES = [
    { code: 'tamil', name: 'Tamil' },
    { code: 'hindi', name: 'Hindi' },
    { code: 'telugu', name: 'Telugu' },
    { code: 'malayalam', name: 'Malayalam' },
    { code: 'kannada', name: 'Kannada' },
    { code: 'bengali', name: 'Bengali' },
    { code: 'marathi', name: 'Marathi' },
    { code: 'punjabi', name: 'Punjabi' },
];

const genres = [
    { key: 'Recent', name: 'Recently Added' },
    { key: 'Popularity', name: 'Most Watched' },
    { key: 'StaffPick', name: 'Staff Picks' }
];

// 2. The manifest is now built synchronously.
const manifest = {
    id: 'org.einthusan.stremio',
    version: '1.5.0', // Bump version for the fix
    name: 'Einthusan',
    description: 'Fast and efficient addon for South Asian movies with Premium HD support and pagination.',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie'],
    // 3. Map over the hardcoded list to build the catalogs.
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
    console.log('Catalog request:', { type, id, extra });
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
        console.error('Error in catalog handler:', error);
    }

    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log('Meta request:', { type, id });
    if (type === 'movie' && id.startsWith(ID_PREFIX)) {
        try {
            const meta = await getMovieMeta(id);
            return { meta };
        } catch (error)
        {
            console.error('Error in meta handler:', error);
            return { meta: null };
        }
    }
    return { meta: null };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log('Stream request:', { type, id });
    let streams = [];

    if (type === 'movie' && id.startsWith(ID_PREFIX)) {
        try {
            streams = await getStreamUrls(id);
        } catch (error) {
            console.error('Error in stream handler:', error);
        }
    }

    return { streams };
});

// Export the fully built interface directly.
module.exports = builder.getInterface();
