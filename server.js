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

        serveHTTP(addonInterface, { port });
        console.log(`[SERVER] Addon server running on http://localhost:${port}`);

        // Start the background scraping process
        startWorker();

    } catch (error) {
        console.error('[SERVER] Failed to start application:', error);
        process.exit(1);
    }
}

startApp();
