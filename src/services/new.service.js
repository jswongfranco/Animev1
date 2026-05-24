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

    // Buscar el heading "Recientemente Agregados"
    let targetSection = null;
    
    $("h2, h3, .section-title, [class*='title']").each((_, el) => {
        const text = $(el).text().trim().toLowerCase();
        
        if (text.includes("recientemente agregados") || text.includes("nuevos animes")) {
            targetSection = $(el).closest("section, div[class*='section'], .container, [class*='anime']");
            return false;
        }
    });

    if (!targetSection || targetSection.length === 0) {
        console.log("[new.service] No se encontró la sección 'Recientemente Agregados'");
        return [];
    }

    const articles = targetSection.find("article, .anime-card, [class*='card'], .media-item, a[href*='/media/']");

    articles.each((_, article) => {
        const $article = $(article);
        
        const titleEl = $article.find("h3, h4, .title, [class*='title'], p, span").first();
        let title = titleEl.text().trim();
        
        if (!title) {
            const imgAlt = $article.find("img").attr("alt");
            title = imgAlt ? imgAlt.trim() : null;
        }

        const linkEl = $article.find("a").first();
        const href = linkEl.attr("href") || "";
        
        if (href.includes("genre=")) return;
        
        const url = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
        
        const imgEl = $article.find("img").first();
        let image = imgEl.attr("src") || imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || null;
        
        if (image && !image.startsWith("http")) {
            image = `${BASE_URL}${image.startsWith("/") ? "" : "/"}${image}`;
        }

        const slugMatch = url.match(/\/media\/([^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : null;

        const idMatch = image ? image.match(/\/covers\/(\d+)\.jpg/) : null;
        const id = idMatch ? idMatch[1] : null;

        const metaText = $article.text();
        const categoryMatch = metaText.match(/(TV\s*Anime|OVA|ONA|Película|Movie|Especial|Special)/i);
        const category = categoryMatch ? categoryMatch[1].replace(/\s+/g, " ").trim() : "TV Anime";

        const yearMatch = metaText.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yearMatch ? yearMatch[1] : null;

        if (title && slug && image) {
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