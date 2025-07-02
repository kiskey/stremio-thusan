// scraper.js
const { CheerioCrawler } = require('crawlee');
const { getStreamUrls } = require('./auth'); // We will move stream logic to auth to keep this clean

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';
const PROXY_URL = process.env.PROXY_URL;

async function scrapePage(pageUrl) {
    console.log(`[SCRAPER] Scraping page: ${pageUrl}`);
    const movies = [];
    let rateLimited = false;

    // We must use a real browser to get metadata, as it's often loaded by JS
    const crawler = new CheerioCrawler({
        maxConcurrency: 2,
        minRequestDelay: 500,
        maxRequestDelay: 2000,
        async requestHandler({ $, request, log }) {
            if ($('title').text().includes('Rate Limited')) {
                log.error(`Got a rate-limit page for ${request.url}.`);
                rateLimited = true;
                return;
            }

            // Scrape the list page
            $('#UIMovieSummary > ul > li').each((i, el) => {
                const listItem = $(el);
                const title = listItem.find('.block2 h3').text().trim();
                const href = listItem.find('.block1 a').attr('href');
                if (title && href) {
                    const idMatch = href.match(/\/watch\/([a-zA-Z0-9.-]+)\//);
                    if (idMatch) {
                        const movieId = idMatch[1];
                        const lang = new URLSearchParams(href.split('?')[1]).get('lang');
                        const poster = listItem.find('.block1 img').attr('src');
                        const yearText = listItem.find('.info p').first().text();
                        
                        // Extract director and cast from the list page itself
                        const professionals = [];
                        listItem.find('.professionals .prof').each((i, profEl) => {
                            const name = $(profEl).find('p').text().trim();
                            const role = $(profEl).find('label').text().trim();
                            professionals.push({ name, role });
                        });

                        const director = professionals.find(p => p.role === 'Director')?.name || null;
                        const cast = professionals.filter(p => p.role !== 'Director').map(p => p.name);

                        movies.push({
                            id: `${ID_PREFIX}:${lang}:${movieId}`,
                            lang,
                            title,
                            year: yearText ? parseInt(yearText.match(/\d{4}/)?.[0], 10) : null,
                            poster: poster && !poster.startsWith('http') ? `https:${poster}` : poster,
                            movie_page_url: `${BASE_URL}${href}`,
                            description: listItem.find('p.synopsis').text().trim(),
                            director,
                            cast,
                        });
                    }
                }
            });
        }
    });

    await crawler.run([pageUrl]);
    return { movies, rateLimited };
}

module.exports = { scrapePage, getStreamUrls };
