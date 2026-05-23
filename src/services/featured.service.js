// src/services/featured.service.js
const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");

const DEFAULT_DOMAIN = process.env.DEFAULT_ANIME_DOMAIN || "animeav1.com";
const BASE_URL = `https://${DEFAULT_DOMAIN}`;

const HTTP_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtml(url) {
    try {
        const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
        const response = await axios.get(url, {
            timeout,
            headers: HTTP_HEADERS,
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400,
        });
        return response.data;
    } catch (error) {
        throw new ApiError(500, "No se pudo obtener contenido desde AnimeAV1", error.message);
    }
}

function resolveAbsoluteUrl(urlCandidate, domain = DEFAULT_DOMAIN) {
    if (!urlCandidate || typeof urlCandidate !== "string") {
        return null;
    }
    try {
        const base = `https://${domain}`;
        return new URL(urlCandidate, base).toString();
    } catch (_error) {
        return null;
    }
}

async function getFeaturedAnime() {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const featured = [];

    // Buscar el carrusel - basado en el HTML real que pasaste
    // El carrusel está dentro de: <div class="dark overflow-hidden rounded-xl"><div class="flex transform-gpu gap-7">
    // Cada slide es un <article class="relative grid w-full shrink-0 items-end gap-4 text-subs">
    
    // Intentar múltiples selectores para encontrar el carrusel
    let articles = $();
    
    // Selector 1: El contenedor exacto del HTML
    const carouselWrapper = $(".dark.overflow-hidden.rounded-xl");
    if (carouselWrapper.length > 0) {
        const flexContainer = carouselWrapper.find("> .flex.transform-gpu.gap-7");
        if (flexContainer.length > 0) {
            articles = flexContainer.find("> article");
        }
    }
    
    // Selector 2: Si no funcionó, buscar articles que tengan backdrop/banner
    if (articles.length === 0) {
        $("article").each((_, element) => {
            const el = $(element);
            // Un article del carrusel tiene: h1, backdrop img, y link "Ver Anime"
            if (el.find("h1").length > 0 && 
                el.find('img[src*="banner"], img[src*="backdrop"]').length > 0 &&
                el.find('a:contains("Ver Anime")').length > 0) {
                articles = articles.add(el);
            }
        });
    }
    
    // Selector 3: Buscar por la estructura específica del carrusel
    if (articles.length === 0) {
        // Buscar articles que tengan la clase específica del carrusel
        articles = $("article.relative.grid.w-full.shrink-0");
    }

    articles.each((_, element) => {
        const el = $(element);

        // Título - está en h1 dentro del header
        const title = el.find("h1").text().trim();

        // Info: TV Anime • 2026 • En emisión
        const infoContainer = el.find("header .flex.flex-wrap.items-center.gap-2.text-sm");
        const infoSpans = infoContainer.find("span");
        
        let type = "TV Anime";
        let year = null;
        let status = "En emisión";
        
        infoSpans.each((i, span) => {
            const text = $(span).text().trim();
            if (text.match(/TV Anime|OVA|Película|Serie|ONA|Special/i)) {
                type = text;
            } else if (text.match(/^\d{4}$/)) {
                year = text;
            } else if (text.includes("En emisión") || text.includes("Finalizado")) {
                status = text;
            }
        });

        // Géneros - están en links con href que contiene "genero="
        const genres = [];
        el.find("a[href*='genero=']").each((_, genreEl) => {
            genres.push($(genreEl).text().trim());
        });

        // Sinopsis - está en .entry p
        const synopsis = el.find(".entry p").text().trim();

        // URL del anime - el link "Ver Anime"
        const link = el.find('a:contains("Ver Anime")').first();
        let url = link.attr("href");
        
        // Limpiar la URL (quitar ../ y hacer absoluta)
        if (url) {
            if (url.startsWith("../")) {
                url = url.replace("../", "/");
            } else if (url.startsWith("./")) {
                url = url.replace("./", "/");
            }
            url = resolveAbsoluteUrl(url);
        }

        // Imagen backdrop (banner grande) - buscar img con src que contiene banner o backdrop
        const backdropImg = el.find('img[src*="banner"], img[src*="backdrop"], img[src*="cdn.pandrama"]').first();
        const backdrop = backdropImg.attr("src");

        // Solo agregar si tenemos título y URL válida
        if (title && url && backdrop) {
            featured.push({
                title,
                type,
                year,
                status,
                genres,
                synopsis,
                image: null, // El carrusel solo tiene backdrop, no poster
                backdrop,
                url,
            });
        }
    });

    return {
        success: true,
        data: featured,
        count: featured.length,
        source: "animeav1",
    };
}

module.exports = {
    getFeaturedAnime,
};