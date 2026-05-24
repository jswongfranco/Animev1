// src/services/new.service.js
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

async function getNewAnime() {
    const html = await fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const newAnime = [];

    // Buscar la sección "Animes" - "Recientemente Agregados"
    // En el HTML está: <h2>Animes</h2> <p>Recientemente Agregados</p>
    // Después viene un div con grid de artículos
    
    // Buscar todos los h2 que contengan "Animes"
    $('h2').each((_, h2Element) => {
        const h2 = $(h2Element);
        const text = h2.text().trim();
        
        if (text === 'Animes') {
            // El siguiente p debe tener "Recientemente Agregados"
            const nextP = h2.next('p');
            if (nextP.length && nextP.text().includes('Recientemente Agregados')) {
                // El contenedor de artículos está después
                const container = h2.parent().next('div') || h2.closest('header').next('div');
                
                if (container.length) {
                    container.find('article').each((_, article) => {
                        const el = $(article);
                        
                        // Imagen (portada)
                        const img = el.find('img').first();
                        const image = resolveAbsoluteUrl(img.attr('src') || img.attr('data-src'));
                        
                        // Título (en el alt: "Portada de Tiger & Bunny")
                        const altText = img.attr('alt') || '';
                        const titleMatch = altText.match(/Portada de (.*)/);
                        const title = titleMatch ? titleMatch[1] : altText;
                        
                        // URL del anime
                        const link = el.find('a').first();
                        const url = resolveAbsoluteUrl(link.attr('href'));
                        
                        // Tipo (TV Anime, Película, OVA, Especial)
                        const typeBadge = el.find('.rounded, [class*="rounded"]').first();
                        const type = typeBadge.text().trim() || 'TV Anime';
                        
                        // Sinopsis (está en el hover/div oculto)
                        const synopsisEl = el.find('.line-clamp-6, p').first();
                        const synopsis = synopsisEl.text().trim() || null;
                        
                        if (title && url) {
                            newAnime.push({
                                title,
                                image,
                                url,
                                type,
                                synopsis,
                                source: 'animeav1'
                            });
                        }
                    });
                }
            }
        }
    });

    // Si no encontramos con el método anterior, intentar buscar por sección
    if (newAnime.length === 0) {
        // Buscar por el texto "Recientemente Agregados" en cualquier lugar
        $('p, span, h2, h3').each((_, element) => {
            const el = $(element);
            if (el.text().includes('Recientemente Agregados')) {
                // Buscar el contenedor padre que tenga los artículos
                const parent = el.closest('section, div');
                if (parent.length) {
                    parent.find('article').each((_, article) => {
                        const art = $(article);
                        
                        const img = art.find('img').first();
                        const image = resolveAbsoluteUrl(img.attr('src') || img.attr('data-src'));
                        
                        const altText = img.attr('alt') || '';
                        const titleMatch = altText.match(/Portada de (.*)/);
                        const title = titleMatch ? titleMatch[1] : altText;
                        
                        const link = art.find('a').first();
                        const url = resolveAbsoluteUrl(link.attr('href'));
                        
                        const typeBadge = art.find('.rounded, [class*="rounded"]').first();
                        const type = typeBadge.text().trim() || 'TV Anime';
                        
                        if (title && url && !newAnime.find(a => a.title === title)) {
                            newAnime.push({
                                title,
                                image,
                                url,
                                type,
                                source: 'animeav1'
                            });
                        }
                    });
                }
            }
        });
    }

    // Eliminar duplicados
    const unique = [];
    const seen = new Set();
    for (const anime of newAnime) {
        if (!seen.has(anime.title)) {
            seen.add(anime.title);
            unique.push(anime);
        }
    }

    return {
        success: true,
        data: unique,
        count: unique.length,
        source: 'animeav1',
    };
}

module.exports = {
    getNewAnime,
};