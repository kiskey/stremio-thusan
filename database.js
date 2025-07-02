// database.js
const { Pool, Client } = require('pg');

// This will be our main application pool, connecting to the addon's specific database.
// It is initialized as null and will be created by initializeDatabase.
let pool = null;

const ADDON_DB_NAME = 'stremio_addons';
const SCHEMA_NAME = 'einthusan';

async function initializeDatabase() {
    const adminUrl = process.env.DATABASE_URL;
    if (!adminUrl) {
        throw new Error('DATABASE_URL environment variable is not set.');
    }

    // --- Stage 1: Ensure the addon's database exists ---
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
        console.log(`[DB] Disconnected from 'postgres' database.`);
    }

    // --- Stage 2: Connect to the addon's database and set up schema/tables ---
    const appDbUrl = new URL(adminUrl);
    appDbUrl.pathname = `/${ADDON_DB_NAME}`;
    
    pool = new Pool({ connectionString: appDbUrl.toString() });
    console.log(`[DB] Main connection pool created for '${ADDON_DB_NAME}'.`);

    const appClient = await pool.connect();
    try {
        await appClient.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
        console.log(`[DB] Schema '${SCHEMA_NAME}' is ready.`);

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
        console.log(`[DB] Table '${SCHEMA_NAME}.movies' is ready.`);
    } catch (err) {
        console.error('[DB] Error during schema/table initialization:', err);
        throw err;
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
    try {
        await pool.query(query, values);
    } catch (err) {
        console.error(`[DB] Error upserting movie ${movie.title}:`, err);
    }
}

async function getMoviesForCatalog(lang, skip, limit) {
    const query = `
        SELECT id, title AS name, poster, year FROM ${SCHEMA_NAME}.movies
        WHERE lang = $1
        ORDER BY last_scraped_at DESC, title ASC
        LIMIT $2 OFFSET $3;
    `;
    try {
        const res = await pool.query(query, [lang, limit, skip]);
        return res.rows.map(row => ({ ...row, type: 'movie' }));
    } catch (err) {
        console.error(`[DB] Error fetching catalog for ${lang}:`, err);
        return [];
    }
}

async function getMovieForMeta(id) {
    const query = `SELECT * FROM ${SCHEMA_NAME}.movies WHERE id = $1;`;
    try {
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
            };
        }
        return null;
    } catch (err) {
        console.error(`[DB] Error fetching meta for ${id}:`, err);
        return null;
    }
}

async function getMovieCount() {
    const query = `SELECT COUNT(*) FROM ${SCHEMA_NAME}.movies;`;
    try {
        const res = await pool.query(query);
        return parseInt(res.rows[0].count, 10);
    } catch (err) {
        console.error(`[DB] Error getting movie count:`, err);
        return 0;
    }
}

module.exports = {
    initializeDatabase,
    upsertMovie,
    getMoviesForCatalog,
    getMovieForMeta,
    getMovieCount,
};
