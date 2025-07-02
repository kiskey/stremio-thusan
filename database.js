// database.js
const { Pool, Client } = require('pg');

let pool = null;
const ADDON_DB_NAME = 'stremio_addons';
const SCHEMA_NAME = 'einthusan';

// Function for safe table migration
async function migrateDatabaseSchema() {
    const client = await pool.connect();
    try {
        console.log('[DB MIGRATION] Checking schema for enrichment columns...');
        // Check if tmdb_id column exists
        const checkEnrichmentCols = await client.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = '${SCHEMA_NAME}' 
            AND table_name = 'movies' 
            AND column_name = 'tmdb_id'
        `);

        if (checkEnrichmentCols.rowCount === 0) {
            console.log('[DB MIGRATION] Enrichment columns not found. Altering table...');
            await client.query(`ALTER TABLE ${SCHEMA_NAME}.movies ADD COLUMN tmdb_id INT;`);
            await client.query(`ALTER TABLE ${SCHEMA_NAME}.movies ADD COLUMN imdb_id VARCHAR(20);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON ${SCHEMA_NAME}.movies (imdb_id);`);
            console.log('[DB MIGRATION] Successfully added tmdb_id and imdb_id columns.');
        } else {
            console.log('[DB MIGRATION] Enrichment schema is up to date.');
        }

        console.log('[DB MIGRATION] Checking schema for full_scrape_completed column...');
        const checkScrapeCol = await client.query(`
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = '${SCHEMA_NAME}' AND table_name = 'scrape_progress' AND column_name = 'full_scrape_completed'
        `);
        if (checkScrapeCol.rowCount === 0) {
            console.log('[DB MIGRATION] Adding "full_scrape_completed" column to scrape_progress table...');
            await client.query(`
                ALTER TABLE ${SCHEMA_NAME}.scrape_progress 
                ADD COLUMN full_scrape_completed BOOLEAN NOT NULL DEFAULT FALSE;
            `);
            console.log('[DB MIGRATION] Scrape progress column added successfully.');
        } else {
            console.log('[DB MIGRATION] Scrape progress schema is up to date.');
        }

    } finally {
        client.release();
    }
}

async function initializeDatabase() {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) throw new Error('DATABASE_URL environment variable is not set.');

    const adminClient = new Client({ connectionString: adminUrl });
    try {
        await adminClient.connect();
        const res = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [ADDON_DB_NAME]);
        if (res.rowCount === 0) {
            await adminClient.query(`CREATE DATABASE ${ADDON_DB_NAME}`);
            console.log(`[DB] Successfully created database '${ADDON_DB_NAME}'.`);
        }
    } finally {
        await adminClient.end();
    }

    const appDbUrl = new URL(adminUrl);
    appDbUrl.pathname = `/${ADDON_DB_NAME}`;
    pool = new Pool({ connectionString: appDbUrl.toString() });

    const appClient = await pool.connect();
    try {
        await appClient.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
        await appClient.query(`
            CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.movies (
                id VARCHAR(255) PRIMARY KEY,
                lang VARCHAR(50),
                title VARCHAR(255),
                year INT,
                poster TEXT,
                description TEXT,
                movie_page_url TEXT,
                last_scraped_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        
        await appClient.query(`
            CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.scrape_progress (
                lang VARCHAR(50) PRIMARY KEY,
                last_page_scraped INT NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('[DB] Base tables are ready.');

    } finally {
        appClient.release();
    }
}

async function upsertMovie(movie) {
    const query = `
        INSERT INTO ${SCHEMA_NAME}.movies (id, lang, title, year, poster, description, movie_page_url, last_scraped_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            year = EXCLUDED.year,
            poster = EXCLUDED.poster,
            description = EXCLUDED.description,
            last_scraped_at = NOW();
    `;
    const values = [
        movie.id, movie.lang, movie.title, movie.year, movie.poster,
        movie.description, movie.movie_page_url
    ];
    await pool.query(query, values).catch(err => console.error(`[DB] Error upserting movie ${movie.title}:`, err));
}

async function getMoviesForCatalog(lang, skip, limit) {
    const query = `
        SELECT id, title AS name, poster, year FROM ${SCHEMA_NAME}.movies
        WHERE lang = $1 ORDER BY last_scraped_at DESC, title ASC LIMIT $2 OFFSET $3;
    `;
    const res = await pool.query(query, [lang, limit, skip]);
    return res.rows.map(row => ({ ...row, type: 'movie' }));
}

async function getMovieForMeta(id) {
    const query = `SELECT * FROM ${SCHEMA_NAME}.movies WHERE id = $1;`;
    const res = await pool.query(query, [id]);
    if (res.rows.length > 0) {
        const movie = res.rows[0];
        return {
            meta: {
                id: movie.imdb_id || movie.id, // Prefer IMDb ID for Stremio ecosystem
                type: 'movie',
                name: movie.title,
                poster: movie.poster,
                background: movie.poster,
                description: movie.description,
                year: movie.year,
                movie_page_url: movie.movie_page_url, // Internal use
            }
        };
    }
    return { meta: null };
}

async function getMovieByImdbId(imdbId) {
    const query = `SELECT * FROM ${SCHEMA_NAME}.movies WHERE imdb_id = $1 LIMIT 1;`;
    const res = await pool.query(query, [imdbId]);
    if (res.rows.length > 0) {
        return getMovieForMeta(res.rows[0].id);
    }
    return { meta: null };
}

async function getScrapeProgress(lang) {
    const query = `SELECT last_page_scraped, full_scrape_completed FROM ${SCHEMA_NAME}.scrape_progress WHERE lang = $1;`;
    const res = await pool.query(query, [lang]);
    if (res.rows.length > 0) {
        return { 
            lastPage: res.rows[0].last_page_scraped, 
            isCompleted: res.rows[0].full_scrape_completed 
        };
    }
    return { lastPage: 0, isCompleted: false };
}

async function updateScrapeProgress(lang, page) {
    const query = `
        INSERT INTO ${SCHEMA_NAME}.scrape_progress (lang, last_page_scraped, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (lang) DO UPDATE SET
            last_page_scraped = $2,
            updated_at = NOW();
    `;
    await pool.query(query, [lang, page]);
}

async function setFullScrapeCompleted(lang) {
    console.log(`[DB] Marking full scrape as completed for language: ${lang}`);
    const checkQuery = `INSERT INTO ${SCHEMA_NAME}.scrape_progress (lang, full_scrape_completed) VALUES ($1, TRUE) ON CONFLICT (lang) DO UPDATE SET full_scrape_completed = TRUE;`;
    await pool.query(checkQuery, [lang]);
}

async function getUnenrichedMovies(limit) {
    const query = `
        SELECT id, title, year FROM ${SCHEMA_NAME}.movies
        WHERE tmdb_id IS NULL
        ORDER BY last_scraped_at DESC
        LIMIT $1;
    `;
    const res = await pool.query(query, [limit]);
    return res.rows;
}

async function updateMovieEnrichment(id, tmdbId, imdbId) {
    const query = `
        UPDATE ${SCHEMA_NAME}.movies
        SET tmdb_id = $2, imdb_id = $3
        WHERE id = $1;
    `;
    // If TMDB gives us nulls, we still want to update to avoid re-processing
    await pool.query(query, [id, tmdbId || null, imdbId || null]);
}

module.exports = {
    initializeDatabase,
    migrateDatabaseSchema,
    upsertMovie,
    getMoviesForCatalog,
    getMovieForMeta,
    getMovieByImdbId,
    getScrapeProgress,
    updateScrapeProgress,
    setFullScrapeCompleted,
    getUnenrichedMovies,
    updateMovieEnrichment,
};
