const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

const OUTPUT_FILE = path.join(__dirname, 'data.json');

// --- Helper: Scrape BCV Direct (Dólar y Euro) ---
async function scrapeBCV(browser) {
    console.log('💵 Scrapeando BCV directamente...');
    const result = { usd: null, eur: null };
    let page = null;

    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto('https://www.bcv.org.ve/', { waitUntil: 'networkidle2', timeout: 60000 });

        // Esperar a que carguen los elementos de tasas
        await page.waitForSelector('#dolar, #euro, .recuadroActual', { timeout: 15000 }).catch(() => null);

        const rates = await page.evaluate(() => {
            // Estrategia 1: Buscar por IDs específicos
            const dolarEl = document.querySelector('#dolar strong, #dolar .centrado');
            const euroEl = document.querySelector('#euro strong, #euro .centrado');

            // Estrategia 2: Buscar en divs con clase recuadroActual
            let dolar = null, euro = null;

            if (dolarEl) {
                dolar = dolarEl.innerText.trim();
            }
            if (euroEl) {
                euro = euroEl.innerText.trim();
            }

            // Estrategia 3: Buscar en toda la página por patrones
            if (!dolar || !euro) {
                const allText = document.body.innerText;

                // Buscar patrón "Dólar ... XX,XXXX" o similar
                const dolarMatch = allText.match(/D[oó]lar[^0-9]*([0-9]+[,\.][0-9]+)/i);
                const euroMatch = allText.match(/Euro[^0-9]*([0-9]+[,\.][0-9]+)/i);

                if (dolarMatch && !dolar) dolar = dolarMatch[1];
                if (euroMatch && !euro) euro = euroMatch[1];
            }

            return { dolar, euro };
        });

        await page.close();

        if (rates.dolar) {
            result.usd = rates.dolar.replace('.', ','); // Normalizar formato
            console.log(`✅ BCV Dólar: ${result.usd}`);
        } else {
            console.log('⚠️ BCV Dólar no encontrado');
        }

        if (rates.euro) {
            result.eur = rates.euro.replace('.', ',');
            console.log(`✅ BCV Euro: ${result.eur}`);
        } else {
            console.log('⚠️ BCV Euro no encontrado');
        }

    } catch (error) {
        console.error('❌ BCV Error:', error.message);
        if (page) await page.close().catch(() => { });
    }

    return result;
}

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
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Espera explícita para asegurar lazy loading de imágenes y scripts
            await new Promise(r => setTimeout(r, 5000));

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
// --- Helper: Scrape Binance P2P Direct ---
async function scrapeBinance(browser) {
    console.log('🪙 Scrapeando Binance P2P (USDT/VES)...');
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // URL directa a USDT/VES (Venta - Buy for user perspective, or Sell ads from advertisers? Usually "USDT" price reference on P2P 
        // refers to the rate at which you can SELL your USDT (Advertiser sets Buy price) OR BUY USDT (Advertiser sets Sell price).
        // Standard reference is usually the "Buy USDT" tab (Advertisers selling).
        const url = 'https://p2p.binance.com/es/trade/all-payments/USDT?fiat=VES';

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Esperar a que cargue la lista de precios
        const priceSelector = '.headline5.text-primaryText';
        await page.waitForSelector(priceSelector, { timeout: 15000 }).catch(() => null);

        const price = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            return el ? el.innerText : null;
        }, priceSelector);

        await page.close();

        if (price) {
            console.log(`✅ Binance P2P: ${price}`);
            return price; // Formato esperado: "598.50" (con punto) o "598,50"
        } else {
            throw new Error("Elemento de precio no encontrado");
        }
    } catch (error) {
        console.error('❌ Binance Error:', error.message);
        return null;
    }
}

async function scrape() {
    console.log('🚀 Iniciando scraper actualizado (BCV + Binance Web)...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const finalData = {
        rates: {
            bcv: {},
            binance: {},
            kontigo: { usd: "N/A" } // Sin fuente por ahora
        },
        news: [],
        lastUpdate: new Date().toISOString()
    };

    // 1. Obtener tasas del BCV directamente
    const bcvRates = await scrapeBCV(browser);
    if (bcvRates.usd) {
        // Normalizar a número, redondear a 2 decimales y volver a string con coma
        const val = parseFloat(bcvRates.usd.replace(',', '.'));
        finalData.rates.bcv.usd = val.toFixed(2).replace('.', ',');
    }
    if (bcvRates.eur) {
        const val = parseFloat(bcvRates.eur.replace(',', '.'));
        finalData.rates.bcv.eur = val.toFixed(2).replace('.', ',');
    }

    // 2. Obtener tasa Binance P2P directamente (Web Scraping)
    const binanceRate = await scrapeBinance(browser);
    if (binanceRate) {
        // Asegurar formato con coma decimal para consistencia visual
        finalData.rates.binance.usdt = binanceRate.replace('.', ',');
    } else {
        console.log('⚠️ Binance: Usando fallback (N/A)');
        finalData.rates.binance.usdt = 'N/A';
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
            name: 'La Verdad',
            url: 'https://laverdad.com/',
            fn: () => {
                // Estrategia: Selector verificado con debug
                // La Verdad usa clases como upk-title para los títulos
                const titleEl = document.querySelector('.upk-title a.title-animation-underline, .upk-title a');

                if (!titleEl) return null;

                const link = titleEl.href;
                const title = titleEl.innerText.trim();

                // Imagen: Selector revisado post-fallo
                let img = null;

                // Estrategia directa basada en hallazgos del subagente
                // La Verdad: img dentro de article o .elementor-post
                const imgEl = document.querySelector('article img, .elementor-post img, .wpcap-post img');
                if (imgEl) {
                    img = imgEl.src || imgEl.getAttribute('data-src') || imgEl.srcset?.split(' ')[0];
                }

                return { title, link, image: img };
            }
        },
        {
            name: 'Diario Versión Final',
            url: 'https://diarioversionfinal.com/',
            fn: () => {
                const titleEl = document.querySelector('.post-title.post-url');
                if (!titleEl) return null;
                const link = titleEl.href;
                const title = titleEl.innerText.trim();

                let img = null;
                // Versión Final: background-image en .img-holder
                const holder = document.querySelector('.img-holder');
                if (holder) {
                    // Obtener estilo computado si el inline está vacío
                    const style = holder.getAttribute('style') || window.getComputedStyle(holder).backgroundImage;
                    if (style && style.includes('url')) {
                        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                        if (match) img = match[1];
                    }
                }

                // Fallback a img tag normal
                if (!img) {
                    const imgEl = document.querySelector('article img, .main-post img');
                    if (imgEl) img = imgEl.src;
                }

                return { title, link, image: img };
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
