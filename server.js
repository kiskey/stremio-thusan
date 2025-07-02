// server.js
require('dotenv').config();
const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const { initializeDatabase } = require('./database');
const { startWorker } = require('./worker');

async function startApp() {
    try {
        await initializeDatabase();
        console.log('[SERVER] Database initialized successfully.');

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

        // Start the background scraping process after the server is up
        startWorker();

    } catch (error) {
        console.error('[SERVER] Failed to start application:', error);
        process.exit(1);
    }
}

startApp();
