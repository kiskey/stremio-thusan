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
        console.log(`[DB] Connected to 'postgres' database to check for '${ADDON_DB_NAME}'.`);
        const res = await adminClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [ADDON_DB_NAME]);
        if (res.rowCount === 0) {
            console.log(`[DB] Database '${ADDON_DB_NAME}' does not exist. Creating...`);
            await adminClient.query(`CREATE DATABASE ${ADDON_DB_NAME}`);
            console.log(`[DB] Successfully created database '${ADDON_DB_NAME}'.`);
        } else {
            console.log(`[DB] Database '${ADDON_DB_NAME}' already exists.`);
        }
    } catch (err) {
        console.error('[DB] Error during database creation check:', err);
        throw err;
    } finally {
        await adminClient.end();
    }

    const appDbUrl = new URL(adminUrl);
    appDbUrl.pathname = `/${ADDON_DB_NAME}`;
    pool = new Pool({ connectionString: appDbUrl.toString() });
    console.log(`[DB] Main connection pool created for '${ADDON_DB_NAME}'.`);

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
        // The migration logic from the previous step is assumed to be here as well
        // to handle adding columns like director and cast if needed.
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
            id: movie.id,
            type: 'movie',
            name: movie.title,
            poster: movie.poster,
            background: movie.poster,
            description: movie.description,
            year: movie.year,
            // --- THE FIX IS HERE ---
            // We now include the movie_page_url so the stream handler can use it.
            movie_page_url: movie.movie_page_url,
        };
    }
    return null;
}

async function getMovieCount() {
    const res = await pool.query(`SELECT COUNT(*) FROM ${SCHEMA_NAME}.movies;`);
    return parseInt(res.rows[0].count, 10);
}

module.exports = { initializeDatabase, upsertMovie, getMoviesForCatalog, getMovieForMeta, getMovieCount };
