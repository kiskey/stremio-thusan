// addon.js
const { addonBuilder } = require('stremio-addon-sdk');
const { getLanguages, getMovies, getMovieMeta, getStreamUrls, ID_PREFIX } = require('./scraper');

const genres = [
    { key: 'Recent', name: 'Recently Added' },
    { key: 'Popularity', name: 'Most Watched' },
    { key: 'StaffPick', name: 'Staff Picks' }
];

async function buildManifest() {
    // This function is async because it waits for the languages to be scraped
    const languages = await getLanguages(); 
    const catalogs = languages.map(lang => ({
        type: 'movie',
        id: `einthusan-${lang.code}`,
        name: `Einthusan ${lang.name}`,
        genres: genres.map(g => g.name),
        extra: [
            { name: "search", isRequired: false },
            { name: "genre", isRequired: false, options: genres.map(g => g.name) },
            { name: "skip", isRequired: false }
        ]
    }));

    return {
        id: 'org.einthusan.stremio',
        version: '1.4.0',
        name: 'Einthusan',
        description: 'Fast and efficient addon for South Asian movies with Premium HD support and pagination.',
        resources: ['catalog', 'stream', 'meta'],
        types: ['movie'],
        catalogs: catalogs,
        idPrefixes: [ID_PREFIX]
    };
}

// We wrap the entire addon setup in an async function
async function getAddonInterface() {
    // 1. Await the manifest so we get the object, not the promise
    const manifest = await buildManifest();

    // 2. Now, create the builder with the valid manifest
    const builder = new addonBuilder(manifest);

    // 3. Define all the handlers on the builder instance
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
                streams = await getStreamUrls(id);
            } catch (error) {
                console.error('Error in stream handler:', error);
            }
        }

        return { streams };
    });

    // 4. Return the fully built interface
    return builder.getInterface();
}

// Export the async function itself, to be called by server.js
module.exports = getAddonInterface;
