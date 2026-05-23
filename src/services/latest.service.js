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
    return text.trim();
}

async function getLatestEpisodes() {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const episodes = [];

    // Selectores para encontrar la sección "Recientemente Actualizado"
    const sectionSelectors = [
        "section:has(h2:contains('Recientemente Actualizado'))",
        "section:has(h3:contains('Recientemente Actualizado'))",
        "div:has(> h2:contains('Recientemente Actualizado'))",
        "div:has(> h3:contains('Recientemente Actualizado'))",
        "[class*='recent']",
        "[class*='latest']",
        "[class*='episode']",
    ];

    let section = null;
    for (const selector of sectionSelectors) {
        const found = $(selector);
        if (found.length > 0) {
            section = found.first();
            break;
        }
    }

    // Si no encontramos la sección, buscar en toda la página
    const container = section || $("body");

    // Buscar items de episodio
    const itemSelectors = [
        "article",
        ".card",
        "[class*='card']",
        "[class*='item']",
        "[class*='episode']",
        "a[href*='/ver/']",
        "a[href*='/episodio/']",
    ];

    let items = $();
    for (const selector of itemSelectors) {
        const found = container.find(selector);
        if (found.length > 0) {
            items = found;
            break;
        }
    }

    // Fallback: buscar todos los links que contengan "Episodio"
    if (items.length === 0) {
        $("a, article, .card").each((_, element) => {
            const el = $(element);
            const text = el.text();
            if (text.includes("Episodio") && text.includes("hace")) {
                items = items.add(el);
            }
        });
    }

    items.each((_, element) => {
        const el = $(element);

        // Imagen
        const img = el.find("img").first();
        const image = resolveAbsoluteUrl(img.attr("src") || img.attr("data-src"));

        // Título del anime
        const titleEl = el.find("h3, h4, h2, .title, [class*='title'], [class*='name']").first();
        let title = titleEl.text().trim();

        // Si no hay título en elementos comunes, buscar en el texto general
        if (!title) {
            const allText = el.text();
            const lines = allText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
            // El título suele ser la línea más larga o la que no contiene "Episodio" ni "hace"
            title = lines.find(line => !line.includes("Episodio") && !line.match(/hace\s+\d+/i)) || lines[0] || "";
        }

        // Badge de episodio: "Episodio 7"
        const episodeMatch = el.text().match(/Episodio\s+(\d+)/i);
        const episode = episodeMatch ? parseInt(episodeMatch[1], 10) : null;
        const episodeText = episodeMatch ? `Episodio ${episodeMatch[1]}` : null;

        // Tiempo: "hace 7 minutos", "hace 1 día"
        const timeMatch = el.text().match(/hace\s+(\d+\s+(?:minuto|hora|día|semana|mes)[s]?)/i);
        const timeAgo = timeMatch ? `hace ${timeMatch[1]}` : null;

        // URL del anime o episodio
        const link = el.is("a") ? el : el.find("a").first();
        let url = resolveAbsoluteUrl(link.attr("href"));

        // Si la URL es de un episodio, intentar obtener la URL del anime
        if (url && (url.includes("/ver/") || url.includes("/episodio/"))) {
            // La URL del episodio sirve para getEpisodeLinks
            // Pero para getAnimeInfo necesitamos la URL del anime
            // Dejamos la URL del episodio, la app puede buscar el anime por título
        }

        // Solo agregar si tenemos título
        if (title && title.length > 1) {
            // Limpiar título (quitar líneas extras)
            title = title.split("\n")[0].trim();

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

    // Eliminar duplicados por título
    const unique = [];
    const seen = new Set();
    for (const ep of episodes) {
        const key = `${ep.title}-${ep.episode}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(ep);
        }
    }

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