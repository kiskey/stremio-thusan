// scraper.js
const { CheerioCrawler, log: crawleeLogger, LogLevel, Session } = require('crawlee');
const axios = require('axios');
const { getPremiumSession, decodeEinth } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

const IS_DEBUG_MODE = process.env.LOG_LEVEL === 'debug';
crawleeLogger.setLevel(LogLevel.INFO);

function log(message, level = 'info') {
    if (IS_DEBUG_MODE || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

async function getMovies(lang, genre, searchQuery, skip = 0) {
    const pageNum = Math.floor(skip / 20) + 1;
    const finalUrl = `${BASE_URL}/movie/results/?lang=${lang}&${searchQuery ? `query=${encodeURIComponent(searchQuery)}` : `find=${genre || 'Recent'}`}&page=${pageNum}`;
    log(`Visiting movie list page: ${finalUrl}`);

    const movies = [];
    
    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        async requestHandler({ $ }) {
            if ($('title').text().includes('Rate Limited')) {
                log(`Got a rate-limit page for [${lang}]. Skipping.`, 'error');
                return;
            }
            const selector = '#UIMovieSummary > ul > li';
            const movieElements = $(selector);

            movieElements.each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const poster = listItem.find('.block1 img').attr('src');
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        const movieId = idMatch[1];
                        const yearText = listItem.find('.info p').first().text();
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${movieId}`,
                            lang,
                            title,
                            year: yearText ? parseInt(yearText.match(/\d{4}/)?.[0], 10) : null,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                            movie_page_url: `${BASE_URL}${href}`,
                            description: listItem.find('p.synopsis').text().trim(),
                        });
                    }
                }
            });
        }
    });

    await crawler.run([finalUrl]);
    log(`Scraping finished for [${lang}]. Returning ${movies.length} movies.`);
    return { movies, rateLimited: false };
}

async function getStreamUrls(moviePageUrl) {
    log(`[STREAMER] Fetching streams for: ${moviePageUrl}`);
    const streams = [];
    const session = await getPremiumSession();
    
    if (session) {
        log('[STREAMER] Logged in. HD stream fetching would be implemented here.');
    } else {
        log('[STREAMER] Not logged in. SD stream fetching would be implemented here.');
    }
    
    return streams;
}

module.exports = { 
    // --- FIX: Exporting ID_PREFIX ---
    scrapePage: getMovies, 
    getStreamUrls,
    ID_PREFIX
};
