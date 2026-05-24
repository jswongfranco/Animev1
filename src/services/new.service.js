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

// ─── MÉTODO 1: Extraer del JSON de SvelteKit ───
function extractNewFromSvelteKit(html) {
    try {
        // Buscar el script que contiene window.__sveltekit_data
        const svelteMatch = html.match(/<<script[^>]*>\s*window\.__sveltekit_data\s*=\s*(\{[\s\S]*?\});?\s*<<\/script>/i);
        if (!svelteMatch) return null;

        // Convertir el JSON-like a JSON válido (keys sin comillas, etc.)
        let jsonStr = svelteMatch[1]
            .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
            .replace(/'/g, '"')
            .replace(/:\s*undefined\b/g, ':null')
            .replace(/,\s*([\]}])/g, '$1');

        const data = JSON.parse(jsonStr);
        return data.latestMedia || null;
    } catch (error) {
        console.log("[new.service] SvelteKit extraction failed:", error.message);
        return null;
    }
}

// ─── MÉTODO 2: Fallback - Scrapear HTML directamente ───
function extractNewFromArticles(html) {
    const $ = cheerio.load(html);
    const newAnime = [];

    // Buscar la sección "Recientemente Agregados"
    const sectionHeading = $("h2, h3, .section-title").filter(function () {
        const text = $(this).text().trim().toLowerCase();
        return text.includes("recientemente agregados") || text.includes("nuevos animes");
    }).first();

    // Buscar articles/cards - si no hay heading, buscar en toda la página
    const articles = sectionHeading.length 
        ? sectionHeading.parent().next().find("article, .anime-card, [class*='card'], .media-item")
        : $("article, .anime-card, [class*='card'], .media-item");

    articles.each((_, article) => {
        const $article = $(article);
        
        const titleEl = $article.find("h3, h4, .title, [class*='title'], a").first();
        const title = titleEl.text().trim();
        
        const linkEl = $article.find("a").first();
        const href = linkEl.attr("href") || "";
        const url = href.startsWith("http") ? href : href.startsWith("/") ? `${BASE_URL}${href}` : `${BASE_URL}/${href}`;
        
        const imgEl = $article.find("img").first();
        const image = imgEl.attr("src") || imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || null;
        
        const slugMatch = url.match(/\/media\/([^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        
        const idMatch = (image || "").match(/\/covers\/(\d+)\.jpg/) || (slug || "").match(/^(\d+)-/);
        const id = idMatch ? idMatch[1] : null;

        const metaText = $article.text();
        const yearMatch = metaText.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yearMatch ? yearMatch[1] : null;

        const categoryMatch = metaText.match(/(TV|OVA|ONA|Película|Movie|Especial|Special)\s*(?:Anime)?/i);
        const category = categoryMatch ? categoryMatch[1] : "TV Anime";

        if (title) {
            newAnime.push({
                title,
                slug,
                id,
                image: image ? (image.startsWith("http") ? image : `${BASE_URL}${image}`) : (id ? `https://cdn.animeav1.com/covers/${id}.jpg` : null),
                url: url || (slug ? `${BASE_URL}/media/${slug}` : null),
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

    // Intentar múltiples métodos
    let newAnime = extractNewFromSvelteKit(html);
    
    if (!newAnime || newAnime.length === 0) {
        newAnime = extractNewFromArticles(html);
    }

    const normalized = newAnime.map(item => ({
        id: item.id || null,
        title: item.title || item.name || "Sin título",
        slug: item.slug || null,
        category: item.category?.name || item.type || item.category || "TV Anime",
        year: item.year || (item.createdAt ? item.createdAt.split("-")[0] : null) || (item.startDate ? item.startDate.split("-")[0] : null),
        synopsis: item.synopsis || item.description || item.overview || null,
        image: item.image || item.cover || item.poster || item.banner || (item.id ? `https://cdn.animeav1.com/covers/${item.id}.jpg` : null),
        url: item.url || (item.slug ? `https://animeav1.com/media/${item.slug}` : null),
        createdAt: item.createdAt || item.addedAt || item.created_at || null,
        source: "animeav1"
    }));

    const validItems = normalized.filter(item => item.title && item.title !== "Sin título");

    return {
        success: true,
        data: validItems,
        count: validItems.length,
        source: "animeav1",
    };
}

module.exports = {
    getNewAnime,
};