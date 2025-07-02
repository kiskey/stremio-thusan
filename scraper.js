// scraper.js
const { CheerioCrawler } = require('crawlee');
const cheerio = require('cheerio');
const { getAuthenticatedClient, decodeEinth } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

const IS_DEBUG_MODE = process.env.LOG_LEVEL === 'debug';

function log(message, level = 'info') {
    if (IS_DEBUG_MODE || level === 'error') {
        console.log(`[SCRAPER][${level.toUpperCase()}] ${message}`);
    }
}

async function scrapePage(lang, pageNum) {
    const finalUrl = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${pageNum}`;
    log(`Scraping page: ${finalUrl}`);
    const movies = [];
    let rateLimited = false;

    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        async requestHandler({ $ }) {
            if ($('title').text().includes('Rate Limited')) {
                log(`Got a rate-limit page for [${lang}].`, 'error');
                rateLimited = true;
                return;
            }
            $('#UIMovieSummary > ul > li').each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        const movieId = idMatch[1];
                        const poster = listItem.find('.block1 img').attr('src');
                        const yearText = listItem.find('.info p').first().text();
                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${movieId}`, lang, title,
                            year: yearText ? parseInt(yearText.match(/\d{4}/)?.[0], 10) : null,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                            movie_page_url: `${BASE_URL}${href}`,
                            description: listItem.find('p.synopsis').text().trim(),
                            director: listItem.find('.professionals .prof:contains("Director") p').text().trim() || null,
                            cast: listItem.find('.professionals .prof:not(:contains("Director")) p').map((i, el) => $(el).text().trim()).get(),
                        });
                    }
                }
            });
        }
    });

    await crawler.run([finalUrl]);
    return { movies, rateLimited };
}

async function fetchStream(client, moviePageUrl, quality) {
    log(`Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    
    // As per your evidence, premium URLs have a /premium/ prefix
    const isPremiumAttempt = (await client.jar.getCookies(BASE_URL)).some(c => c.key === 'session_id'); // A heuristic for being logged in
    const urlToVisit = quality === 'HD' && isPremiumAttempt ? moviePageUrl.replace('/movie/', '/premium/movie/') : moviePageUrl;
    log(`Visiting URL: ${urlToVisit}`);

    try {
        const pageResponse = await client.get(urlToVisit);
        const $ = cheerio.load(pageResponse.data);

        const videoPlayerSection = $('#UIVideoPlayer');
        const ejp = videoPlayerSection.attr('data-ejpingables');
        const csrfToken = $('html').attr('data-pageid')?.replace(/+/g, '+');

        if (!ejp || !csrfToken) {
            log(`Could not find tokens for ${quality} stream.`, 'error');
            return null;
        }

        const movieId = new URL(moviePageUrl).pathname.split('/')[3];
        const lang = new URL(moviePageUrl).searchParams.get('lang');
        const ajaxUrl = `${BASE_URL}/ajax/movie/watch/${movieId}/?lang=${lang}`;
        const postData = new URLSearchParams({
            'xEvent': 'UIVideoPlayer.PingOutcome',
            'xJson': JSON.stringify({ "EJOutcomes": ejp, "NativeHLS": false }),
            'gorilla.csrf.Token': csrfToken,
        }).toString();

        const ajaxResponse = await client.post(ajaxUrl, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': urlToVisit }
        });

        if (ajaxResponse.data?.Data?.EJLinks) {
            const decodedLnk = Buffer.from(decodeEinth(ajaxResponse.data.Data.EJLinks), 'base64').toString('utf-8');
            const streamData = JSON.parse(decodedLnk);
            if (streamData.HLSLink) {
                log(`Successfully found ${quality} stream.`);
                return { title: `Einthusan ${quality}`, url: streamData.HLSLink };
            }
        }
    } catch (error) {
        log(`Request for ${quality} stream failed: ${error.message}`, 'error');
    }
    return null;
}

async function getStreamUrls(moviePageUrl) {
    const streams = [];
    const client = await getAuthenticatedClient();

    const hdStream = await fetchStream(client, moviePageUrl, 'HD');
    if (hdStream) streams.push(hdStream);
    
    const sdStream = await fetchStream(client, moviePageUrl, 'SD');
    if (sdStream && !streams.find(s => s.url === sdStream.url)) {
        streams.push(sdStream);
    }

    return streams;
}

module.exports = { 
    scrapePage, 
    getStreamUrls,
    ID_PREFIX
};
