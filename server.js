// server.js
require('dotenv').config();
const express = require('express');
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./addon');

const app = express();
const port = process.env.PORT || 7000;

// Middleware to enable detailed logging if configured
app.use((req, res, next) => {
    if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.url}`);
    }
    next();
});

serveHTTP(addonInterface, { port });

console.log(`Addon server running on http://localhost:${port}`);
console.log('Install to Stremio by visiting the above URL in your browser.');
