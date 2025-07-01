// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getLanguages, getMovies, getMovieMeta, getStreamUrl, ID_PREFIX } = require('./scraper');

const genres = [
    { key: 'Recent', name: 'Recently Added' },
    { key: 'Popularity', name: 'Most Watched' },
    { key: 'StaffPick', name: 'Staff Picks' }
];

async function buildManifest() {
    const languages = await getLanguages();
    const catalogs = languages.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        genres: genres.map(g => g.name),
        extra: [
            { name: "search", isRequired: false },
            { name: "genre", isRequired: false, options: genres.map(g => g.name) }
        ]
    }));

    return {
        id: 'org.einthusan.stremio',
        version: '1.2.0',
        name: 'Einthusan',
        description: 'Fast and efficient addon for South Asian movies, with metadata scraped directly from Einthusan.',
        resources: ['catalog', 'stream', 'meta'],
        types: ['movie'],
        catalogs: catalogs,
        idPrefixes: [ID_PREFIX]
    };
}

const builder = new addonBuilder(buildManifest());

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log('Catalog request:', { type, id, extra });
    let metas = [];

    const lang = id.replace('einthusan-', '');
    const searchQuery = extra.search;
    const selectedGenreName = extra.genre;

    let genreKey = 'Recent';
    if (selectedGenreName) {
        const foundGenre = genres.find(g => g.name === selectedGenreName);
        if (foundGenre) genreKey = foundGenre.key;
    }

    try {
        metas = await getMovies(lang, genreKey, searchQuery);
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
        } catch (error) {
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
            const streamInfo = await getStreamUrl(id);
            if (streamInfo && streamInfo.url) {
                streams.push(streamInfo);
            }
        } catch (error) {
            console.error('Error in stream handler:', error);
        }
    }

    return { streams };
});

module.exports = builder.getInterface();
