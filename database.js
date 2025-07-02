// database.js
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const SCHEMA_NAME = 'einthusan';

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
        console.log(`[DB] Schema '${SCHEMA_NAME}' is ready.`);

        await client.query(`
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
        console.error('[DB] Error during database initialization:', err);
        throw err;
    } finally {
        client.release();
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
