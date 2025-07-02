// database.js
const { Pool, Client } = require('pg');

let pool = null;
const ADDON_DB_NAME = 'stremio_addons';
const SCHEMA_NAME = 'einthusan';

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
        
        // --- NEW: Create the scrape progress tracking table ---
        await appClient.query(`
            CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.scrape_progress (
                lang VARCHAR(50) PRIMARY KEY,
                last_page_scraped INT NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('[DB] All tables are ready.');

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
            id: movie.id, type: 'movie', name: movie.title, poster: movie.poster,
            background: movie.poster, description: movie.description, year: movie.year,
            movie_page_url: movie.movie_page_url,
        };
    }
    return null;
}

// --- NEW: Functions to manage scrape progress ---

async function getScrapeProgress(lang) {
    const query = `SELECT last_page_scraped FROM ${SCHEMA_NAME}.scrape_progress WHERE lang = $1;`;
    const res = await pool.query(query, [lang]);
    if (res.rows.length > 0) {
        return res.rows[0].last_page_scraped;
    }
    return 0; // Default to 0 if no record exists
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

module.exports = {
    initializeDatabase,
    upsertMovie,
    getMoviesForCatalog,
    getMovieForMeta,
    getScrapeProgress,
    updateScrapeProgress,
};
