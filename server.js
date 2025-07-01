// server.js
require('dotenv').config();
const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
// Import the addonInterface directly, as it's now created synchronously
const addonInterface = require('./addon'); 

const app = express();
const port = process.env.PORT || 7000;

// Middleware to enable detailed logging if configured
app.use((req, res, next) => {
    if (process.env.LOG_LEVEL === 'debug') {
        // We now log when a request from Stremio actually comes in
        console.log(`[HTTP Request] Stremio requested: ${req.method} ${req.url}`);
    }
    next();
});

serveHTTP(addonInterface, { port });

console.log(`Addon server running on http://localhost:${port}`);
console.log('Install to Stremio by visiting the above URL in your browser.');
console.log(`HTTP addon accessible at: http://127.0.0.1:${port}/manifest.json`);
