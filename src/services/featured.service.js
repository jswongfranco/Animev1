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
    // El JSON está en el script de SvelteKit con este formato exacto:
    // data: [null, {type:"data",data:{featured:[...], latestEpisodes:[...]}}]
    
    // Buscar el bloque completo que contiene featured
    const fullDataMatch = html.match(/data\s*:\s*\[\s*null\s*,\s*\{\s*type\s*:\s*"data"\s*,\s*data\s*:\s*\{([\s\S]*?)\}\s*,\s*uses\s*:\s*\{\s*\}\s*\}\s*\]/);
    
    if (fullDataMatch) {
        const dataBlock = fullDataMatch[1];
        
        // Extraer solo el array featured
        const featuredMatch = dataBlock.match(/featured\s*:\s*(\[[\s\S]*?\]),\s*latestEpisodes/);
        
        if (featuredMatch) {
            try {
                let jsonStr = featuredMatch[1];
                
                // Limpiar el JSON: las keys no tienen comillas en el HTML de SvelteKit
                // Convertir: id:197 -> "id":197
                jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                
                // Limpiar trailing commas
                jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
                
                const featured = JSON.parse(jsonStr);
                return featured;
            } catch (e) {
                console.log("Error parseando featured:", e.message);
            }
        }
    }
    
    // Fallback: buscar con regex más simple
    const simpleMatch = html.match(/featured\s*:\s*(\[[\s\S]{100,5000}?\]),\s*latestEpisodes/);
    if (simpleMatch) {
        try {
            let jsonStr = simpleMatch[1];
            jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
            const featured = JSON.parse(jsonStr);
            return featured;
        } catch (e) {
            console.log("Error parseando simple:", e.message);
        }
    }
    
    return [];
}

function extractFeaturedFromArticles(html) {
    // Extraer directamente de los <article> del carrusel
    const featured = [];
    
    // El carrusel tiene articles con clase específica
    const carouselSection = html.match(/<<div class="dark relative col-span-full text-body">([\s\S]*?)<<section class="col-span-full/);
    
    if (!carouselSection) return [];
    
    const carouselHtml = carouselSection[1];
    
    // Buscar cada artículo
    const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/g;
    let match;
    
    while ((match = articleRegex.exec(carouselHtml)) !== null) {
        const article = match[0];
        
        // Título
        const titleMatch = article.match(/<<h1[^>]*>(.*?)<<\/h1>/);
        const title = titleMatch ? titleMatch[1].replace(/<<[^>]*>/g, '').trim() : null;
        
        // Imagen backdrop
        const backdropMatch = article.match(/src="(https:\/\/cdn\.animeav1\.com\/backdrops\/[^"]*)"/);
        const backdrop = backdropMatch ? backdropMatch[1] : null;
        
        // URL
        const urlMatch = article.match(/href="(\/media\/[^"]*)"/);
        const url = urlMatch ? resolveAbsoluteUrl(urlMatch[1]) : null;
        
        // Año
        const yearMatch = article.match(/<<span>(\d{4})<<\/span>/);
        const year = yearMatch ? yearMatch[1] : null;
        
        // Status
        const statusMatch = article.match(/En emisión|Próximamente|Finalizado/);
        const status = statusMatch ? statusMatch[0] : null;
        
        // Sinopsis
        const synopsisMatch = article.match(/<<p>(.*?)<<\/p>/);
        const synopsis = synopsisMatch ? synopsisMatch[1].replace(/<<[^>]*>/g, '').trim() : null;
        
        // Géneros
        const genres = [];
        const genreRegex = /href="\/catalogo\?genre=[^"]*"[^>]*>(.*?)<<\/a>/g;
        let genreMatch;
        while ((genreMatch = genreRegex.exec(article)) !== null) {
            genres.push(genreMatch[1]);
        }
        
        if (title) {
            featured.push({
                title,
                image: backdrop,
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
    
    // Intentar extraer del JSON de SvelteKit
    let featured = extractFeaturedFromHtml(html);
    
    // Si falla, extraer de los artículos HTML directamente
    if (!featured || featured.length === 0) {
        featured = extractFeaturedFromArticles(html);
    }

    // Normalizar
    const normalized = featured.map(item => ({
        id: item.id || null,
        title: item.title,
        slug: item.slug || null,
        category: item.category?.name || "TV Anime",
        year: item.year || (item.startDate ? item.startDate.split('-')[0] : null),
        status: item.status || (item.status === 2 ? "En emisión" : (item.status === 0 ? "Próximamente" : "Finalizado")),
        genres: Array.isArray(item.genres) ? item.genres.map(g => typeof g === 'string' ? g : (g.name || g.slug || '')).filter(Boolean) : [],
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