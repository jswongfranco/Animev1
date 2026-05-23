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

    // ESTRATEGIA: Buscar todos los <article> y verificar si tienen imagen de pandrama
    // Usando cheerio, iteramos todos los articles y verificamos manualmente
    
    const allArticles = $("article");
    
    for (let i = 0; i < allArticles.length; i++) {
        const el = $(allArticles[i]);
        
        // Obtener el HTML completo del article para debug
        const articleHtml = el.html() || "";
        
        // Verificar si contiene "pandrama.online" en cualquier parte del HTML
        const hasPandrama = articleHtml.includes("pandrama.online");
        
        // Si no tiene pandrama, skip
        if (!hasPandrama) {
            continue;
        }
        
        // Verificar que NO sea episodio reciente
        const text = el.text();
        if (text.match(/Episodio\s+\d+/)) continue;
        if (text.match(/hace\s+\d+\s+(minuto|hora|día)/)) continue;

        // Título
        const title = el.find("h1").text().trim();
        if (!title) continue;

        // Info
        const infoText = el.find("header .flex.flex-wrap.items-center.gap-2.text-sm").text();
        let type = "TV Anime";
        let year = null;
        let status = "En emisión";
        
        const typeMatch = infoText.match(/(TV Anime|OVA|Película|Serie|ONA|Special)/i);
        if (typeMatch) type = typeMatch[1];
        
        const yearMatch = infoText.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) year = yearMatch[1];
        
        if (infoText.includes("En emisión")) status = "En emisión";
        else if (infoText.includes("Finalizado")) status = "Finalizado";

        // Géneros
        const genres = [];
        el.find("a").each((_, genreEl) => {
            const href = $(genreEl).attr("href") || "";
            if (href.includes("genero=")) {
                const genreText = $(genreEl).text().trim();
                if (genreText && genreText.length > 0 && genreText.length < 30) {
                    genres.push(genreText);
                }
            }
        });

        // Sinopsis
        const synopsis = el.find(".entry p").text().trim();

        // URL - buscar link con "Ver Anime"
        let url = null;
        el.find("a").each((_, linkEl) => {
            if ($(linkEl).text().includes("Ver Anime")) {
                let href = $(linkEl).attr("href") || "";
                if (href.startsWith("../")) href = href.replace("../", "/");
                else if (href.startsWith("./")) href = href.replace("./", "/");
                url = resolveAbsoluteUrl(href);
            }
        });

        // Banner URL - extraer de pandrama
        let backdrop = null;
        const pandramaMatch = articleHtml.match(/https:\/\/cdn\.pandrama\.online\/banner\/[^"'\s]+/);
        if (pandramaMatch) {
            backdrop = pandramaMatch[0];
        }

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
    }

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