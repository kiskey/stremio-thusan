// scraper.js
const { CheerioCrawler } = require('crawlee');
const cheerio = require('cheerio');
const { getAuthenticatedClient, decodeEinth, isClientAuthenticated } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

async function scrapePage(lang, pageNum) {
    const finalUrl = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${pageNum}`;
    const movies = [];
    let rateLimited = false;

    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        async requestHandler({ $ }) {
            if ($('title').text().includes('Rate Limited')) {
                console.error(`[SCRAPER] Got a rate-limit page for [${lang}].`);
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
    console.log(`[STREAMER] Attempting to fetch ${quality} stream from: ${moviePageUrl}`);
    
    // As per your evidence, premium URLs have a /premium/ prefix
    const usePremiumUrl = quality === 'HD' && isClientAuthenticated();
    const urlToVisit = usePremiumUrl ? moviePageUrl.replace('/movie/', '/premium/movie/') : moviePageUrl;
    console.log(`[STREAMER] Visiting URL: ${urlToVisit}`);

    try {
        const pageResponse = await client.get(urlToVisit);
        const $ = cheerio.load(pageResponse.data);

        const videoPlayerSection = $('#UIVideoPlayer');
        const ejp = videoPlayerSection.attr('data-ejpingables');
        const hlsLink = videoPlayerSection.attr('data-hls-link');
        const csrfToken = $('html').attr('data-pageid')?.replace(/+/g, '+');

        // The working script shows a direct link is often available for logged-in users
        if (hlsLink) {
            console.log(`[STREAMER] Successfully found direct HLS link for ${quality}.`);
            return { title: `Einthusan ${quality}`, url: hlsLink };
        }

        // Fallback to the AJAX method if no direct link is found
        if (!ejp || !csrfToken) {
            console.error(`[STREAMER] Could not find tokens for ${quality} stream.`);
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
                console.log(`[STREAMER] Successfully found AJAX HLS link for ${quality}.`);
                return { title: `Einthusan ${quality} (AJAX)`, url: streamData.HLSLink };
            }
        }
    } catch (error) {
        console.error(`[STREAMER] Request for ${quality} stream failed: ${error.message}`);
    }
    return null;
}

async function getStreamUrls(moviePageUrl) {
    const streams = [];
    const client = getAuthenticatedClient(); // Get the single, shared client

    // Try for HD first if authenticated
    if (isClientAuthenticated()) {
        const hdStream = await fetchStream(client, moviePageUrl, 'HD');
        if (hdStream) streams.push(hdStream);
    }
    
    // Always try for SD as a fallback
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
