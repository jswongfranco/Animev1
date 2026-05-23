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

    // Buscar el carrusel: .dark > .flex > article
    const carousel = $(".dark.overflow-hidden.rounded-xl > .flex.transform-gpu.gap-7");
    
    if (carousel.length === 0) {
        // Fallback: buscar cualquier article dentro de .dark
        $(".dark article").each((_, element) => {
            const el = $(element);
            // Solo tomar los que tienen backdrop (imagen grande)
            if (el.find('img[src*="banner"], img[src*="backdrop"]').length > 0) {
                carousel.push(element);
            }
        });
    }

    const articles = carousel.find("> article");

    articles.each((_, element) => {
        const el = $(element);

        // Título
        const title = el.find("h1").text().trim();

        // Info: TV Anime • 2026 • En emisión
        const infoSpans = el.find("header .flex.flex-wrap.items-center.gap-2.text-sm span");
        const type = $(infoSpans[0]).text().trim();
        const year = $(infoSpans[2]).text().trim();
        const status = el.find('span[class*="animate-pulse"]').text().trim() || "En emisión";

        // Géneros
        const genres = [];
        el.find("header a[href*='genero=']").each((_, genreEl) => {
            genres.push($(genreEl).text().trim());
        });

        // Sinopsis
        const synopsis = el.find(".entry p").text().trim();

        // URL del anime
        const link = el.find('a[href^="../"]').first();
        let url = link.attr("href");
        if (url && url.startsWith("../")) {
            url = url.replace("../", "/");
        }
        url = resolveAbsoluteUrl(url);

        // Imagen backdrop (banner grande)
        const backdropImg = el.find('img[src*="banner"], img[src*="backdrop"]').first();
        const backdrop = backdropImg.attr("src");

        // Imagen poster/portada (si existe)
        const posterImg = el.find('img[alt="' + title + '"]').not('[src*="banner"]').first();
        const poster = posterImg.attr("src") || null;

        // Solo agregar si tenemos título y URL
        if (title && url) {
            featured.push({
                title,
                type,
                year,
                status,
                genres,
                synopsis,
                image: poster,
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