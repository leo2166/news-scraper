const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'data.json');

// --- Helper: Scrape Generic News Source (Con Reintentos) ---
async function scrapeSource(browser, name, url, extractFn, maxAttempts = 2) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`📰 Scrapeando ${name} (Intento ${attempt}/${maxAttempts})...`);
        let page = null;
        try {
            page = await browser.newPage();
            // User Agent rotativo simple o fijo robusto
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Timeout ajustado para no demorar demasiado en intentos fallidos
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const result = await page.evaluate(extractFn);
            await page.close();

            if (result && (result.title || result.image)) {
                console.log(`✅ ${name}:`, result.title ? result.title.substring(0, 30) + '...' : 'Imagen encontrada');
                return { source: name, ...result };
            } else {
                throw new Error("Contenido (título/imagen) no encontrado o nulo.");
            }
        } catch (error) {
            console.error(`⚠️ ${name} Error (Intento ${attempt}):`, error.message);
            if (page) await page.close().catch(() => { });

            // Si es el último intento, retornamos null para "dejado a un lado"
            if (attempt === maxAttempts) {
                console.log(`❌ ${name}: Omitido tras ${maxAttempts} intentos fallidos.`);
                return null;
            }

            // Espera breve antes del reintento
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    return null;
}

// --- Helper: Scrape Instagram for Rates & News ---
async function scrapeInstagram(browser) {
    console.log('📸 Scrapeando Instagram (Tasas & Noticia)...');
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = 'https://www.instagram.com/p/DS7mc48kfNR/';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for meta tags specifically
        await page.waitForSelector('meta[property="og:description"]', { timeout: 15000 }).catch(() => null);

        const data = await page.evaluate(() => {
            const descMeta = document.querySelector('meta[property="og:description"]');
            const imgMeta = document.querySelector('meta[property="og:image"]');

            const description = descMeta ? descMeta.content : '';
            const image = imgMeta ? imgMeta.content : '';

            // Parse Rates using RegEx
            const parseRate = (regex) => {
                const match = description.match(regex);
                return match ? match[1] : null;
            };

            const rates = {
                bcv_usd: parseRate(/💵\s*BCV[:\s]+Bs\.?\s*([\d,.]+)/i),
                bcv_eur: parseRate(/💶\s*Euro\s*BCV[:\s]+Bs\.?\s*([\d,.]+)/i),
                binance: parseRate(/(?:💵|Dólar)\s*Binance[:\s]+Bs\.?\s*([\d,.]+)/i), // Intento de captura automática
                kontigo: parseRate(/(?:💵|Kontigo|App)\s*(?:App)?[:\s]+Bs\.?\s*([\d,.]+)/i) // Intento de captura automática
            };

            return { rates: rates };
        });

        await page.close();
        if (data) console.log('✅ Instagram:', data.rates);
        return data;

    } catch (error) {
        console.error('❌ Instagram Error:', error.message);
        return { rates: {}, news: null };
    }
}

async function scrape() {
    console.log('🚀 Iniciando scraper actualizado...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const finalData = {
        rates: {
            bcv: {},
            binance: {},
            kontigo: {}
        },
        news: [],
        lastUpdate: new Date().toISOString()
    };

    // 1. Get Instagram Data (todas las tasas)
    const instaData = await scrapeInstagram(browser);
    if (instaData && instaData.rates) {
        if (instaData.rates.bcv_usd) finalData.rates.bcv.usd = instaData.rates.bcv_usd;
        if (instaData.rates.bcv_eur) finalData.rates.bcv.eur = instaData.rates.bcv_eur;

        // Lógica Híbrida: Priorizar dato automático, fallback a manual si no existe
        finalData.rates.binance.usdt = instaData.rates.binance || '570,00';
        finalData.rates.kontigo.usd = instaData.rates.kontigo || '560,00';
    }

    // 3. Scrape News Portals with Lazy Load Support
    const newsSources = [
        {
            name: 'Infobae',
            url: 'https://www.infobae.com/venezuela/',
            fn: () => {
                const card = document.querySelector('a.feed-list-card-first');
                if (!card) return null;
                const title = card.querySelector('h2') ? card.querySelector('h2').innerText : 'Sin título';
                const imgEl = card.querySelector('img');
                const img = imgEl ? (imgEl.src || imgEl.dataset.src || imgEl.srcset) : null;
                return { title, link: card.href, image: img };
            }
        },
        {
            name: 'El Nacional',
            url: 'https://www.elnacional.com/',
            fn: () => {
                const featured = document.querySelector('a.featured, .article-card a, article a');
                if (!featured) return null;
                const title = featured.innerText || featured.getAttribute('title');

                let img = null;
                // Estrategia 1: Imagen directa
                const imgEl = featured.querySelector('img');
                if (imgEl) img = imgEl.src || imgEl.dataset.src || imgEl.srcset?.split(' ')[0];

                // Estrategia 2: Background image
                if (!img) {
                    const bgDiv = featured.querySelector('.background-image, .img-bg');
                    if (bgDiv) {
                        const style = window.getComputedStyle(bgDiv);
                        img = style.backgroundImage.slice(4, -1).replace(/["']/g, "");
                    }
                }

                // Estrategia 3: og:imageFallback (simulado)
                if (!img) {
                    // Si no hay imagen, intentamos buscar el primer meta og:image del documento
                    // Esto funciona en puppeteer evaluate porque estamos en la página
                    const metaImg = document.querySelector('meta[property="og:image"]');
                    if (metaImg) img = metaImg.content;
                }

                return { title, link: featured.href, image: img };
            }
        },
        {
            name: 'Noticia al Día',
            url: 'https://noticialdia.com/',
            fn: () => {
                // Estrategia 1: Noticia principal
                const article = document.querySelector('.main-article, article.featured, .featured-content');

                let title, link, img;

                if (article) {
                    const titleEl = article.querySelector('h1, h2, .title');
                    link = article.querySelector('a')?.href;
                    title = titleEl?.innerText.trim();
                    const imgEl = article.querySelector('img');
                    img = imgEl ? (imgEl.dataset.src || imgEl.src) : null;
                }

                // Estrategia 2: Si no hay destacado, buscar en lista
                if (!title) {
                    const firstPost = document.querySelector('.post-item, article');
                    if (firstPost) {
                        title = firstPost.querySelector('h2, h3')?.innerText.trim();
                        link = firstPost.querySelector('a')?.href;
                        img = firstPost.querySelector('img')?.src;
                    }
                }

                // Estrategia 3: Meta tag fallback (INFALIBLE)
                if (!img) {
                    const metaImg = document.querySelector('meta[property="og:image"]');
                    if (metaImg) img = metaImg.content;
                }

                if (title) {
                    return { title, link, image: img };
                }
                return null;
            }
        },
        {
            name: 'CNN en Español',
            url: 'https://cnnespanol.cnn.com/',
            fn: () => {
                const lead = document.querySelector('.container_lead-package');
                if (!lead) return null;
                const title = lead.querySelector('.container__title-url h2')?.innerText;
                const link = lead.querySelector('.container__title-url')?.href;
                const imgEl = lead.querySelector('img');
                return { title, link, image: imgEl ? (imgEl.src || imgEl.dataset.src) : null };
            }
        },
        {
            name: 'Caraota Digital',
            url: 'https://www.caraotadigital.net/',
            fn: () => {
                const titleEl = document.querySelector('.p-url');
                const linkEl = document.querySelector('.p-flink');
                const imgEl = linkEl ? linkEl.querySelector('img') : null;
                return { title: titleEl?.innerText, link: linkEl?.href, image: imgEl?.src };
            }
        },
        {
            name: 'Noticiero Digital',
            url: 'https://noticierodigital.com/',
            fn: () => {
                const link = document.querySelector('a.et-accent-color');
                const featured = document.querySelector('.featured-image');
                const imgEl = featured?.querySelector('img');
                return { title: link?.innerText, link: link?.href, image: imgEl?.src };
            }
        },
        {
            name: 'Caracol Noticias',
            url: 'https://noticias.caracoltv.com/',
            fn: () => {
                const titleEl = document.querySelector('.promo-title .Link, .Card-title .Link');
                const imgEl = document.querySelector('.promo-media img, .Card-media img');
                return { title: titleEl?.innerText, link: titleEl?.href, image: imgEl?.dataset.src || imgEl?.src };
            }
        },
        {
            name: 'RCN',
            url: 'https://www.noticiasrcn.com/',
            fn: () => {
                const linkImg = document.querySelector('a.img-a');
                const kicker = linkImg?.nextElementSibling;
                const titleLink = kicker?.nextElementSibling;
                const imgEl = linkImg?.querySelector('img');
                return {
                    title: titleLink?.innerText || document.querySelector('h3 a')?.innerText,
                    link: titleLink?.href || linkImg?.href,
                    image: imgEl?.src
                };
            }
        },
        {
            name: 'Punto de Corte',
            url: 'https://puntodecorte.net/',
            fn: () => {
                // Estrategia: Buscar bloques de noticias con estructura específica detectada (Plugin ULTP)
                const items = document.querySelectorAll('.ultp-block-item');

                for (const item of items) {
                    const titleEl = item.querySelector('.ultp-block-title a, .ultp-block-content a');
                    const imgEl = item.querySelector('.ultp-block-image img, img');

                    if (titleEl && titleEl.innerText.trim().length > 15) {
                        return {
                            title: titleEl.innerText.trim(),
                            link: titleEl.href,
                            image: imgEl ? (imgEl.dataset.src || imgEl.src || imgEl.srcset?.split(' ')[0]) : null
                        };
                    }
                }
                // Fallback genérico si cambian el plugin
                const generic = document.querySelector('h2 a, h3 a');
                if (generic) return { title: generic.innerText, link: generic.href, image: null };

                return null;
            }
        }
    ];

    for (const source of newsSources) {
        const item = await scrapeSource(browser, source.name, source.url, source.fn);
        if (item) finalData.news.push(item);
    }

    await browser.close();

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));
    const jsContent = `window.DASHBOARD_DATA = ${JSON.stringify(finalData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'data.js'), jsContent);

    console.log('✅ Scraper finalizado exitosamente.');
}

scrape();
