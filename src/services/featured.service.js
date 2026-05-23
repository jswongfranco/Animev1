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

    // ESTRATEGIA: Buscar específicamente los articles que tienen imagen de banner de pandrama
    // El carrusel real usa: https://cdn.pandrama.online/banner/xxx.webp
    // Los otros usan: https://cdn.animeav1.com/backdrops/xxx.jpg o https://cdn.animemovil2.com/media/portadas/xxx.webp
    
    $("article").each((_, element) => {
        const el = $(element);
        
        // Buscar TODAS las imágenes dentro del article
        let hasPandramaBanner = false;
        let bannerUrl = null;
        
        el.find("img").each((_, img) => {
            const src = $(img).attr("src") || "";
            // El carrusel real usa cdn.pandrama.online/banner/
            if (src.includes("pandrama.online") && src.includes("banner")) {
                hasPandramaBanner = true;
                bannerUrl = src;
            }
        });
        
        // Si no tiene banner de pandrama, no es del carrusel principal
        if (!hasPandramaBanner) {
            return;
        }
        
        // Verificar que NO sea un episodio reciente (no debe tener "Episodio X" ni tiempo)
        const text = el.text();
        if (text.match(/Episodio\s+\d+/)) return;
        if (text.match(/hace\s+\d+\s+(minuto|hora|día)/)) return;

        // Título
        const title = el.find("h1").text().trim();

        // Info: TV Anime • 2026 • En emisión
        const infoContainer = el.find("header .flex.flex-wrap.items-center.gap-2.text-sm");
        const infoText = infoContainer.text();
        
        let type = "TV Anime";
        let year = null;
        let status = "En emisión";
        
        const typeMatch = infoText.match(/(TV Anime|OVA|Película|Serie|ONA|Special)/i);
        if (typeMatch) type = typeMatch[1];
        
        const yearMatch = infoText.match(/\b(19\d{2}|20\d{2})\b/);
        if (yearMatch) year = yearMatch[1];
        
        if (infoText.includes("En emisión")) status = "En emisión";
        else if (infoText.includes("Finalizado")) status = "Finalizado";

        // Géneros - buscar links con genero= DENTRO del header del article
        const genres = [];
        el.find("header a").each((_, genreEl) => {
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

        // URL del anime - buscar el link que dice "Ver Anime"
        let url = null;
        el.find("a").each((_, linkEl) => {
            const linkText = $(linkEl).text().trim();
            if (linkText.includes("Ver Anime")) {
                let href = $(linkEl).attr("href");
                if (href) {
                    if (href.startsWith("../")) href = href.replace("../", "/");
                    else if (href.startsWith("./")) href = href.replace("./", "/");
                    url = resolveAbsoluteUrl(href);
                }
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
                backdrop: bannerUrl,
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