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

// Función para verificar si un article pertenece al carrusel
function isCarouselArticle($, el) {
    const text = el.text();
    
    // NO es del carrusel si tiene badge de episodio o tiempo
    if (text.match(/Episodio\s+\d+/)) return false;
    if (text.match(/hace\s+\d+\s+(minuto|hora|día)/)) return false;
    
    // ES del carrusel si tiene:
    // 1. Un h1 (título grande)
    const hasH1 = el.find("h1").length > 0;
    
    // 2. Un link "Ver Anime"
    const hasVerAnime = text.includes("Ver Anime");
    
    // 3. Una imagen con src que contiene "banner" o "backdrop" o "pandrama"
    let hasBannerImage = false;
    el.find("img").each((_, img) => {
        const src = $(img).attr("src") || "";
        if (src.includes("banner") || src.includes("backdrop") || src.includes("pandrama")) {
            hasBannerImage = true;
        }
    });
    
    // 4. Tiene géneros (links con genero=)
    const hasGenres = el.find('a[href*="genero="]').length > 0;
    
    // 5. Tiene sinopsis en .entry
    const hasSynopsis = el.find(".entry").length > 0;
    
    // Debe tener h1 + Ver Anime + (banner o géneros o sinopsis)
    return hasH1 && hasVerAnime && (hasBannerImage || hasGenres || hasSynopsis);
}

async function getFeaturedAnime() {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const featured = [];

    // Buscar TODOS los articles y filtrar solo los del carrusel
    $("article").each((_, element) => {
        const el = $(element);
        
        // Verificar si es un article del carrusel
        if (!isCarouselArticle($, el)) {
            return; // Skip
        }

        // Título
        const title = el.find("h1").text().trim();

        // Info: TV Anime • 2026 • En emisión
        const infoContainer = el.find("header .flex.flex-wrap.items-center.gap-2.text-sm");
        const infoText = infoContainer.text();
        
        let type = "TV Anime";
        let year = null;
        let status = "En emisión";
        
        // Extraer tipo
        const typeMatch = infoText.match(/(TV Anime|OVA|Película|Serie|ONA|Special)/i);
        if (typeMatch) type = typeMatch[1];
        
        // Extraer año
        const yearMatch = infoText.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) year = yearMatch[1];
        
        // Extraer status
        if (infoText.includes("En emisión")) status = "En emisión";
        else if (infoText.includes("Finalizado")) status = "Finalizado";

        // Géneros - buscar todos los links con genero= dentro del article
        const genres = [];
        el.find('a[href*="genero="]').each((_, genreEl) => {
            const genreText = $(genreEl).text().trim();
            if (genreText && genreText.length > 0 && genreText.length < 30) {
                genres.push(genreText);
            }
        });

        // Sinopsis
        const synopsis = el.find(".entry p").text().trim();

        // URL del anime - el link "Ver Anime"
        const link = el.find('a').filter(function() {
            return $(this).text().includes("Ver Anime");
        }).first();
        
        let url = link.attr("href");
        
        // Limpiar la URL
        if (url) {
            if (url.startsWith("../")) {
                url = url.replace("../", "/");
            } else if (url.startsWith("./")) {
                url = url.replace("./", "/");
            }
            url = resolveAbsoluteUrl(url);
        }

        // Imagen backdrop - buscar en todas las imgs del article
        let backdrop = null;
        el.find("img").each((_, img) => {
            const src = $(img).attr("src") || "";
            const alt = $(img).attr("alt") || "";
            if ((src.includes("banner") || src.includes("backdrop") || src.includes("pandrama")) && !backdrop) {
                backdrop = src;
            }
        });

        // Solo agregar si tenemos título y URL válida
        if (title && url) {
            featured.push({
                title,
                type,
                year,
                status,
                genres,
                synopsis,
                image: null,
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