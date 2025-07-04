// server.js
require('dotenv').config();
const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const { initializeDatabase, migrateDatabaseSchema } = require('./database');
const { startWorker } = require('./worker');
const { startTmdbWorker } = require('./tmdb_worker');
const { initializeAuth } = require('./auth');

async function startApp() {
    try {
        await initializeDatabase();
        console.log('[SERVER] Database connection pool initialized.');

        await migrateDatabaseSchema();

        await initializeAuth();

        const app = express();
        const port = process.env.PORT || 7000;

        app.use((req, res, next) => {
            if (process.env.LOG_LEVEL === 'debug') {
                console.log(`[HTTP Request] Stremio requested: ${req.method} ${req.url}`);
            }
            next();
        });

        serveHTTP(addonInterface, { port });
        console.log(`[SERVER] Addon server running on http://localhost:${port}`);

        startWorker();
        startTmdbWorker();

    } catch (error) {
        console.error('[SERVER] Failed to start application:', error);
        process.exit(1);
    }
}

startApp();
