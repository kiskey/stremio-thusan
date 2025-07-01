// server.js
require('dotenv').config();
const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const getAddonInterface = require('./addon'); // Import the async function

// We create an async function to properly initialize the addon
async function startServer() {
    const port = process.env.PORT || 7000;

    // Await the addon interface, which waits for the manifest to be built
    const addonInterface = await getAddonInterface();

    const app = express();

    // Middleware to enable detailed logging if configured
    app.use((req, res, next) => {
        if (process.env.LOG_LEVEL === 'debug') {
            console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);
        }
        next();
    });

    // Now serve the fully initialized addon
    serveHTTP(addonInterface, { port });

    console.log(`Addon server running on http://localhost:${port}`);
    console.log('Install to Stremio by visiting the above URL in your browser.');
}

// Call our async startup function
startServer().catch(error => {
    console.error("Failed to start addon server:", error);
    process.exit(1);
});
