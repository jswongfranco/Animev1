// src/services/new.service.js
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://animeav1.com";

async function fetchHtml(url) {
    const { data } = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9",
        },
        timeout: 15000,
    });
    return data;
}

function extractNewFromArticles(html) {
    const $ = cheerio.load(html);
    const newAnime = [];

    // Buscar TODOS los articles/cards de la página (como antes)
    const articles = $("article, .anime-card, [class*='card'], .media-item");

    articles.each((_, article) => {
        const $article = $(article);
        
        const titleEl = $article.find("h3, h4, .title, [class*='title'], a").first();
        let title = titleEl.text().trim();
        
        const linkEl = $article.find("a").first();
        const href = linkEl.attr("href") || "";
        
        // IGNORAR géneros
        if (href.includes("genre=")) return;
        
        // IGNORAR episodios (/media/slug/123)
        if (href.match(/\/media\/[^/]+\/\d+$/)) return;
        
        const url = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
        
        const imgEl = $article.find("img").first();
        let image = imgEl.attr("src") || imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || null;
        
        if (image && !image.startsWith("http")) {
            image = `${BASE_URL}${image.startsWith("/") ? "" : "/"}${image}`;
        }

        // SOLO aceptar covers de anime (no thumbnails de episodios ni backdrops de géneros)
        if (!image || !image.includes("/covers/")) return;
        
        // Extraer ID del cover
        const idMatch = image.match(/\/covers\/(\d+)\.jpg/);
        const id = idMatch ? idMatch[1] : null;
        
        if (!id) return;

        const slugMatch = url.match(/\/media\/([^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : null;

        if (!title) {
            const imgAlt = imgEl.attr("alt");
            title = imgAlt ? imgAlt.trim() : null;
        }

        const metaText = $article.text();
        const yearMatch = metaText.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yearMatch ? yearMatch[1] : null;

        const categoryMatch = metaText.match(/(TV|OVA|ONA|Película|Movie|Especial|Special)\s*(?:Anime)?/i);
        const category = categoryMatch ? categoryMatch[1] : "TV Anime";

        if (title && slug) {
            newAnime.push({
                title,
                slug,
                id,
                image,
                url,
                year,
                category,
                synopsis: null,
                createdAt: null,
                source: "animeav1"
            });
        }
    });

    return newAnime;
}

async function getNewAnime() {
    const html = await fetchHtml(BASE_URL);
    const newAnime = extractNewFromArticles(html);

    // Eliminar duplicados por slug
    const seen = new Set();
    const unique = newAnime.filter(item => {
        if (!item.slug || seen.has(item.slug)) return false;
        seen.add(item.slug);
        return true;
    });

    return {
        success: true,
        data: unique,
        count: unique.length,
        source: "animeav1",
    };
}

module.exports = {
    getNewAnime,
};