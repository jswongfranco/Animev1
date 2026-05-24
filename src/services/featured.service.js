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
    // Buscar el JSON de SvelteKit que contiene "featured"
    const featuredMatch = html.match(/"featured":\s*(\[.*?\]),\s*"latestEpisodes"/s);
    
    if (!featuredMatch) {
        // Intentar otro patrón
        const altMatch = html.match(/featured:\s*(\[.*?\]),\s*latestEpisodes/s);
        if (!altMatch) {
            return [];
        }
    }

    try {
        const jsonStr = featuredMatch[1];
        // Limpiar el JSON para que sea válido
        const cleanJson = jsonStr
            .replace(/,\s*}/g, '}')  // Eliminar trailing commas en objetos
            .replace(/,\s*]/g, ']'); // Eliminar trailing commas en arrays
        
        const featured = JSON.parse(cleanJson);
        return featured;
    } catch (error) {
        // Si falla el parseo, intentar extraer con regex más simple
        return extractFeaturedWithRegex(html);
    }
}

function extractFeaturedWithRegex(html) {
    const featured = [];
    
    // Buscar cada artículo del carrusel
    const articleRegex = /<article[^>]*>[\s\S]*?<h1[^>]*>(.*?)<<\/h1>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>Ver Anime<<\/a>/gi;
    
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
        const title = match[1].replace(/<<[^>]*>/g, '').trim();
        const image = match[2];
        const url = resolveAbsoluteUrl(match[3]);
        
        // Buscar backdrop (imagen de fondo)
        const backdropMatch = match[0].match(/src="(https:\/\/cdn\.animeav1\.com\/backdrops\/[^"]*)"/);
        const backdrop = backdropMatch ? backdropMatch[1] : null;
        
        featured.push({
            title,
            image: backdrop || image,
            url,
            source: "animeav1"
        });
    }
    
    return featured;
}

async function getFeaturedAnime() {
    const html = await fetchHtml(BASE_URL);
    let featured = extractFeaturedFromHtml(html);

    // Si no encontramos con JSON, intentar con regex
    if (!featured || featured.length === 0) {
        featured = extractFeaturedWithRegex(html);
    }

    // Normalizar los datos
    const normalized = featured.map(item => ({
        id: item.id || null,
        title: item.title,
        slug: item.slug || null,
        category: item.category?.name || "TV Anime",
        year: item.startDate ? item.startDate.split('-')[0] : null,
        status: item.status === 2 ? "En emisión" : (item.status === 0 ? "Próximamente" : "Finalizado"),
        genres: item.genres ? item.genres.map(g => g.name) : [],
        synopsis: item.synopsis || null,
        image: item.id ? `https://cdn.animeav1.com/backdrops/${item.id}.jpg` : null,
        url: item.slug ? `https://animeav1.com/media/${item.slug}` : null,
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