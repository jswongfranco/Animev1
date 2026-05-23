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

function parseEpisodeNumber(text) {
    if (!text) return null;
    const match = text.match(/Episodio\s+(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

function parseTimeAgo(text) {
    if (!text) return null;
    // Captura: "hace X minutos", "hace X horas", "hace un día", "hace X días"
    const match = text.match(/hace\s+(?:un|\d+)\s+(?:minuto|hora|día|semana|mes)[s]?/i);
    return match ? match[0].trim() : null;
}

function cleanTitle(text) {
    if (!text) return null;
    
    // Eliminar patrones comunes del texto "sucio"
    let cleaned = text
        // Quitar "hace X tiempo" al inicio
        .replace(/^hace\s+(?:un|\d+)\s+(?:minuto|hora|día|semana|mes)[s]?\s*\d*\s*/i, "")
        // Quitar "Episodio X" 
        .replace(/Episodio\s+\d+\s*/i, "")
        // Quitar números sueltos al inicio
        .replace(/^\d+\s+/, "")
        // Quitar "Ver NombreDelAnime X" al final
        .replace(/Ver\s+.+?\s*\d*$/, "")
        // Quitar "TV Anime • XXXX • En emisión" y todo lo que sigue
        .replace(/TV\s+Anime\s+•.*$/, "")
        // Quitar géneros (palabras juntas como AcciónAventuraFantasía)
        .replace(/(?:Acción|Aventura|Fantasía|Shounen|Comedia|Drama|Romance|Escolares){2,}/g, "")
        // Limpiar espacios extra
        .trim();
    
    // Si después de limpiar queda muy corto o vacío, intentar extraer de otra forma
    if (!cleaned || cleaned.length < 3) {
        // Buscar el patrón: después de "Episodio X" viene el título
        const titleMatch = text.match(/Episodio\s+\d+\s+(.+?)(?:\s+Ver\s+|$)/i);
        if (titleMatch) {
            cleaned = titleMatch[1].trim();
        }
    }
    
    return cleaned || null;
}

async function getLatestEpisodes() {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const episodes = [];

    // Buscar todos los artículos/cards que tengan "Episodio" en su texto
    $("article, .card, [class*='card'], [class*='item'], a").each((_, element) => {
        const el = $(element);
        const text = el.text();

        // Solo procesar si contiene "Episodio" y "hace"
        if (!text.includes("Episodio") || !text.includes("hace")) {
            return;
        }

        // Imagen
        const img = el.find("img").first();
        const image = resolveAbsoluteUrl(img.attr("src") || img.attr("data-src"));

        // Extraer número de episodio
        const episode = parseEpisodeNumber(text);
        const episodeText = episode ? `Episodio ${episode}` : null;

        // Extraer tiempo
        const timeAgo = parseTimeAgo(text);

        // Extraer y limpiar título
        const title = cleanTitle(text);

        // URL
        const link = el.is("a") ? el : el.find("a").first();
        const url = resolveAbsoluteUrl(link.attr("href"));

        // Solo agregar si tenemos los datos esenciales
        if (title && episode && timeAgo && url) {
            episodes.push({
                title,
                episode,
                episodeText,
                timeAgo,
                image,
                url,
            });
        }
    });

    // Eliminar duplicados por título + episodio
    const unique = [];
    const seen = new Set();
    for (const ep of episodes) {
        const key = `${ep.title}-${ep.episode}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(ep);
        }
    }

    // Ordenar por tiempo (más reciente primero)
    // Los que dicen "minutos" van primero, luego "horas", luego "días"
    const timeOrder = { "minuto": 1, "hora": 2, "día": 3, "semana": 4, "mes": 5 };
    unique.sort((a, b) => {
        const aUnit = a.timeAgo.match(/(minuto|hora|día|semana|mes)/i)?.[1] || "";
        const bUnit = b.timeAgo.match(/(minuto|hora|día|semana|mes)/i)?.[1] || "";
        const aNum = parseInt(a.timeAgo.match(/\d+/)?.[0] || "1");
        const bNum = parseInt(b.timeAgo.match(/\d+/)?.[0] || "1");
        
        const aOrder = (timeOrder[aUnit] || 99) * 100 + aNum;
        const bOrder = (timeOrder[bUnit] || 99) * 100 + bNum;
        
        return aOrder - bOrder;
    });

    return {
        success: true,
        data: unique,
        count: unique.length,
        source: "animeav1",
    };
}

module.exports = {
    getLatestEpisodes,
};