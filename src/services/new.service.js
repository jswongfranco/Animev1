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
        // Buscar el script que contiene los datos de la página
        const scriptMatch = html.match(/<<script[^>]*>\s*try\s*\{[^}]*\}\s*catch[^}]*\}\s*<<\/script>\s*<<script[^>]*>([\s\S]*?)<<\/script>/);
        
        if (!scriptMatch) return null;

        // Buscar el objeto data que contiene latestMedia
        // El JSON de SvelteKit puede tener keys sin comillas (formato JS object)
        const dataMatch = html.match(/["']?data["']?\s*:\s*(\{[\s\S]*?\}),\s*["']?errors["']?/);
        if (!dataMatch) return null;

        // Extraer latestMedia del JSON-like
        // Buscamos el array latestMedia dentro del JSON
        const latestMediaMatch = html.match(/latestMedia\s*:\s*(\[[\s\S]*?\]),\s*(?:trending|featured|errors)/);
        if (!latestMediaMatch) return null;

        // Convertir el JSON-like a JSON válido
        let jsonStr = latestMediaMatch[1]
            // Keys sin comillas → con comillas
            .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
            // Comillas simples a dobles
            .replace(/'/g, '"')
            // Valores undefined/null
            .replace(/:\s*undefined\b/g, ':null')
            // Trailing commas
            .replace(/,\s*([\]}])/g, '$1');

        const latestMedia = JSON.parse(jsonStr);
        return latestMedia;
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
    // animeav1 usa h2 con ese texto, seguido de articles o divs con animes
    const sectionHeading = $("h2, h3, .section-title").filter(function () {
        const text = $(this).text().trim().toLowerCase();
        return text.includes("recientemente agregados") || text.includes("nuevos animes");
    }).first();

    if (!sectionHeading.length) {
        // Fallback: buscar por estructura de cards
        console.log("[new.service] Section heading not found, trying generic card structure");
    }

    // Buscar articles/cards después del heading
    const container = sectionHeading.length ? sectionHeading.next() : $("body");
    const articles = container.find("article, .anime-card, [class*='card'], .media-item").length 
        ? container.find("article, .anime-card, [class*='card'], .media-item")
        : $("article, .anime-card, [class*='card'], .media-item");

    articles.each((_, article) => {
        const $article = $(article);
        
        // Título
        const titleEl = $article.find("h3, h4, .title, [class*='title'], a").first();
        const title = titleEl.text().trim();
        
        // URL
        const linkEl = $article.find("a").first();
        const href = linkEl.attr("href") || "";
        const url = href.startsWith("http") ? href : href.startsWith("/") ? `${BASE_URL}${href}` : `${BASE_URL}/${href}`;
        
        // Imagen
        const imgEl = $article.find("img").first();
        const image = imgEl.attr("src") || imgEl.attr("data-src") || imgEl.attr("data-lazy-src") || null;
        
        // Slug desde URL
        const slugMatch = url.match(/\/media\/([^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : null;
        
        // ID desde slug o imagen
        const idMatch = (image || "").match(/\/covers\/(\d+)\.jpg/) || (slug || "").match(/^(\d+)-/);
        const id = idMatch ? idMatch[1] : null;

        // Metadata del texto
        const metaText = $article.text();
        const yearMatch = metaText.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yearMatch ? yearMatch[1] : null;

        // Categoría/Tipo
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
                synopsis: null, // No hay sinopsis en la lista compacta
                createdAt: null,
                source: "animeav1"
            });
        }
    });

    return newAnime;
}

// ─── MÉTODO 3: Extraer del JSON inline en script (formato exacto de animeav1) ───
function extractNewFromInlineJson(html) {
    try {
        // animeav1 a veces pone el data como window.__DATA__ o similar
        const inlineMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/) ||
                           html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
        
        if (!inlineMatch) return null;
        
        const data = JSON.parse(inlineMatch[1]);
        return data.latestMedia || data.newAnime || data.recentlyAdded || null;
    } catch (error) {
        return null;
    }
}

async function getNewAnime() {
    const html = await fetchHtml(BASE_URL);

    // Intentar múltiples métodos en orden de preferencia
    let newAnime = extractNewFromSvelteKit(html);
    
    if (!newAnime || newAnime.length === 0) {
        newAnime = extractNewFromInlineJson(html);
    }
    
    if (!newAnime || newAnime.length === 0) {
        newAnime = extractNewFromArticles(html);
    }

    // Normalizar al formato estándar de la API
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

    // Filtrar items sin título
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