// src/services/featured.service.js
const axios = require("axios");
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

function extractFeaturedFromHtml(html) {
    // El JSON está en un <script> de SvelteKit con formato: "featured":[{...}]
    // Buscamos el patrón exacto del HTML que me pasaste
    
    // Patrón 1: Buscar "featured" seguido de array en el script de SvelteKit
    const pattern1 = /"featured"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/;
    const match1 = html.match(pattern1);
    
    if (match1) {
        try {
            const jsonStr = match1[1];
            // Limpiar trailing commas que pueden hacer fallar el parseo
            const cleanJson = jsonStr
                .replace(/,\s*([}\]])/g, '$1');
            
            const featured = JSON.parse(cleanJson);
            return featured;
        } catch (e) {
            console.log("Error parseando featured pattern1:", e.message);
        }
    }
    
    // Patrón 2: Buscar en el objeto data de SvelteKit
    const pattern2 = /featured\s*:\s*(\[[\s\S]*?\]),\s*latestEpisodes/;
    const match2 = html.match(pattern2);
    
    if (match2) {
        try {
            const jsonStr = match2[1];
            const cleanJson = jsonStr.replace(/,\s*([}\]])/g, '$1');
            const featured = JSON.parse(cleanJson);
            return featured;
        } catch (e) {
            console.log("Error parseando featured pattern2:", e.message);
        }
    }
    
    // Patrón 3: Buscar todo el objeto data que contiene featured
    const pattern3 = /data\s*:\s*\[\s*null\s*,\s*\{[\s\S]*?featured\s*:\s*(\[[\s\S]*?\])/;
    const match3 = html.match(pattern3);
    
    if (match3) {
        try {
            const jsonStr = match3[1];
            const cleanJson = jsonStr.replace(/,\s*([}\]])/g, '$1');
            const featured = JSON.parse(cleanJson);
            return featured;
        } catch (e) {
            console.log("Error parseando featured pattern3:", e.message);
        }
    }
    
    return [];
}

function extractFeaturedFromArticles(html) {
    // Fallback: extraer de los <article> del carrusel directamente
    const featured = [];
    
    // Buscar artículos del carrusel principal
    const articleRegex = /<article[^>]*class="[^"]*relative[^"]*"[^>]*>[\s\S]*?<\/article>/gi;
    let articleMatch;
    
    while ((articleMatch = articleRegex.exec(html)) !== null) {
        const articleHtml = articleMatch[0];
        
        // Extraer título
        const titleMatch = articleHtml.match(/<<h1[^>]*>(.*?)<<\/h1>/);
        const title = titleMatch ? titleMatch[1].replace(/<<[^>]*>/g, '').trim() : null;
        
        // Extraer imagen de backdrop
        const imgMatch = articleHtml.match(/src="(https:\/\/cdn\.animeav1\.com\/backdrops\/[^"]*)"/);
        const image = imgMatch ? imgMatch[1] : null;
        
        // Extraer URL del anime
        const urlMatch = articleHtml.match(/href="(\/media\/[^"]*)"/);
        const url = urlMatch ? resolveAbsoluteUrl(urlMatch[1]) : null;
        
        // Extraer año
        const yearMatch = articleHtml.match(/<<span>(\d{4})<<\/span>/);
        const year = yearMatch ? yearMatch[1] : null;
        
        // Extraer status
        const statusMatch = articleHtml.match(/En emisión|Próximamente|Finalizado/);
        const status = statusMatch ? statusMatch[0] : null;
        
        // Extraer sinopsis
        const synopsisMatch = articleHtml.match(/<<p>(.*?)<<\/p>/);
        const synopsis = synopsisMatch ? synopsisMatch[1].replace(/<<[^>]*>/g, '').trim() : null;
        
        // Extraer géneros
        const genres = [];
        const genreRegex = /href="\/catalogo\?genre=[^"]*"[^>]*>(.*?)<<\/a>/gi;
        let genreMatch;
        while ((genreMatch = genreRegex.exec(articleHtml)) !== null) {
            genres.push(genreMatch[1]);
        }
        
        if (title && url) {
            featured.push({
                title,
                image,
                url,
                year,
                status,
                synopsis,
                genres,
                source: "animeav1"
            });
        }
    }
    
    return featured;
}

async function getFeaturedAnime() {
    const html = await fetchHtml(BASE_URL);
    
    // Intentar extraer del JSON primero
    let featured = extractFeaturedFromHtml(html);
    
    // Si no funciona, extraer de los artículos HTML
    if (!featured || featured.length === 0) {
        featured = extractFeaturedFromArticles(html);
    }

    // Normalizar los datos
    const normalized = featured.map(item => ({
        id: item.id || null,
        title: item.title,
        slug: item.slug || null,
        category: item.category?.name || (item.genres && item.genres.length > 0 ? "TV Anime" : null),
        year: item.year || (item.startDate ? item.startDate.split('-')[0] : null),
        status: item.status || (item.status === 2 ? "En emisión" : (item.status === 0 ? "Próximamente" : "Finalizado")),
        genres: item.genres ? (typeof item.genres[0] === 'string' ? item.genres : item.genres.map(g => g.name || g)) : [],
        synopsis: item.synopsis || item.description || null,
        image: item.image || (item.id ? `https://cdn.animeav1.com/backdrops/${item.id}.jpg` : null),
        url: item.url || (item.slug ? `https://animeav1.com/media/${item.slug}` : null),
        source: "animeav1"
    }));

    return {
        success: true,
        data: normalized,
        count: normalized.length,
        source: "animeav1",
    };
}

module.exports = {
    getFeaturedAnime,
};