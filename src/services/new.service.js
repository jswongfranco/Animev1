// src/services/new.service.js
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

function extractNewAnimeFromHtml(html) {
    // Buscar latestMedia en el JSON de SvelteKit
    const fullDataMatch = html.match(/data\s*:\s*\[\s*null\s*,\s*\{\s*type\s*:\s*"data"\s*,\s*data\s*:\s*\{[\s\S]*?latestMedia\s*:\s*(\[[\s\S]*?\])\s*,\s*uses\s*:\s*\{\s*\}\s*\}\s*\]/);
    
    if (fullDataMatch) {
        try {
            let jsonStr = fullDataMatch[1];
            
            // Limpiar el JSON: las keys no tienen comillas en el HTML de SvelteKit
            jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            
            // Limpiar trailing commas
            jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
            
            const latestMedia = JSON.parse(jsonStr);
            return latestMedia;
        } catch (e) {
            console.log("Error parseando latestMedia:", e.message);
        }
    }
    
    // Fallback: buscar con regex más simple
    const simpleMatch = html.match(/latestMedia\s*:\s*(\[[\s\S]{100,10000}?\])\s*,\s*uses/);
    if (simpleMatch) {
        try {
            let jsonStr = simpleMatch[1];
            jsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
            const latestMedia = JSON.parse(jsonStr);
            return latestMedia;
        } catch (e) {
            console.log("Error parseando simple latestMedia:", e.message);
        }
    }
    
    return [];
}

function extractNewFromArticles(html) {
    // Extraer de los <article> de "Recientemente Agregados"
    const newAnime = [];
    
    // Buscar la sección "Animes" - "Recientemente Agregados"
    const sectionMatch = html.match(/<<h2[^>]*>Animes<<\/h2>[\s\S]*?<<div class="grid grid-cols-2[\s\S]*?<<\/section>/);
    
    if (!sectionMatch) return [];
    
    const sectionHtml = sectionMatch[0];
    
    // Buscar cada artículo
    const articleRegex = /<article[^>]*>[\s\S]*?<\/article>/g;
    let match;
    
    while ((match = articleRegex.exec(sectionHtml)) !== null) {
        const article = match[0];
        
        // Título
        const titleMatch = article.match(/alt="Portada de ([^"]*)"/);
        const title = titleMatch ? titleMatch[1] : null;
        
        // Imagen (portada/cover)
        const imgMatch = article.match(/src="(https:\/\/cdn\.animeav1\.com\/covers\/[^"]*)"/);
        const image = imgMatch ? imgMatch[1] : null;
        
        // URL
        const urlMatch = article.match(/href="(\/media\/[^"]*)"/);
        const url = urlMatch ? resolveAbsoluteUrl(urlMatch[1]) : null;
        
        // Tipo (TV Anime, Película, OVA, Especial)
        const typeMatch = article.match(/<<div class="rounded[^>]*>(.*?)<<\/div>/);
        const type = typeMatch ? typeMatch[1].trim() : "TV Anime";
        
        if (title && url) {
            newAnime.push({
                title,
                image,
                url,
                type,
                source: "animeav1"
            });
        }
    }
    
    return newAnime;
}

async function getNewAnime() {
    const html = await fetchHtml(BASE_URL);
    
    // Intentar extraer del JSON de SvelteKit
    let newAnime = extractNewAnimeFromHtml(html);
    
    // Si falla, extraer de los artículos HTML directamente
    if (!newAnime || newAnime.length === 0) {
        newAnime = extractNewFromArticles(html);
    }

    // Normalizar
    const normalized = newAnime.map(item => ({
        id: item.id || null,
        title: item.title,
        slug: item.slug || null,
        category: item.category?.name || item.type || "TV Anime",
        year: item.year || (item.createdAt ? item.createdAt.split('-')[0] : null),
        synopsis: item.synopsis || item.description || null,
        image: item.image || (item.id ? `https://cdn.animeav1.com/covers/${item.id}.jpg` : null),
        url: item.url || (item.slug ? `https://animeav1.com/media/${item.slug}` : null),
        createdAt: item.createdAt || null,
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
    getNewAnime,
};