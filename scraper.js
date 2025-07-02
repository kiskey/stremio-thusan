// scraper.js
const { CheerioCrawler } = require('crawlee');
// We only import getStreamUrls, as it's the only function needed from auth.js
const { getStreamUrls } = require('./auth');

const BASE_URL = process.env.BASE_URL || 'https://einthusan.tv';
const ID_PREFIX = 'ein';

async function scrapePage(lang, pageNum) {
    const finalUrl = `${BASE_URL}/movie/results/?find=Recent&lang=${lang}&page=${pageNum}`;
    console.log(`[SCRAPER] Scraping page: ${finalUrl}`);
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
                            id: `${ID_PREFIX}:${lang}:${movieId}`,
                            lang, title,
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

module.exports = { 
    scrapePage, 
    getStreamUrls,
    ID_PREFIX
};
