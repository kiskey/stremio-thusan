// database.js
const { Pool, Client } = require('pg');

let pool = null;
const ADDON_DB_NAME = 'stremio_addons';
const SCHEMA_NAME = 'einthusan';

// --- MIGRATION DEFINITIONS ---
// New migrations can be added to this array in the future.
const MIGRATIONS = [
    {
        id: 1,
        name: 'add_director_and_cast',
        sql: `
            ALTER TABLE ${SCHEMA_NAME}.movies
            ADD COLUMN IF NOT EXISTS director VARCHAR(255),
            ADD COLUMN IF NOT EXISTS cast_members TEXT[];
        `
    }
];

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

        // --- AUTOMATED MIGRATION LOGIC ---
        await appClient.query(`
            CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.migrations (
                id INT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('[DB] Migration table is ready.');

        const executedResult = await appClient.query(`SELECT id FROM ${SCHEMA_NAME}.migrations`);
        const executedIds = new Set(executedResult.rows.map(r => r.id));

        for (const migration of MIGRATIONS) {
            if (!executedIds.has(migration.id)) {
                console.log(`[DB] Running pending migration: ${migration.name}...`);
                await appClient.query(migration.sql);
                await appClient.query(`INSERT INTO ${SCHEMA_NAME}.migrations (id, name) VALUES ($1, $2)`, [migration.id, migration.name]);
                console.log(`[DB] Migration ${migration.name} completed successfully.`);
            }
        }

    } finally {
        appClient.release();
    }
}

async function upsertMovie(movie) {
    const query = `
        INSERT INTO ${SCHEMA_NAME}.movies (id, lang, title, year, poster, description, movie_page_url, director, cast_members, last_scraped_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            year = EXCLUDED.year,
            poster = EXCLUDED.poster,
            description = EXCLUDED.description,
            director = EXCLUDED.director,
            cast_members = EXCLUDED.cast_members,
            last_scraped_at = NOW();
    `;
    const values = [
        movie.id, movie.lang, movie.title, movie.year, movie.poster,
        movie.description, movie.movie_page_url, movie.director, movie.cast
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
            director: movie.director ? [movie.director] : [],
            cast: movie.cast_members || [],
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
