const puppeteer = require('puppeteer');
// Actualización manual de tasas y noticias (Vercel deploy-force)
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');

const OUTPUT_FILE = path.join(__dirname, 'data.json');

// --- Helper: Scrape BCV Direct (Dólar y Euro) ---
async function scrapeBCV(browser, maxAttempts = 3) {
    const result = { usd: null, eur: null, fechaValor: null };

    // 1. Intentar scraping directo (ideal si no hay bloqueos de IP regional)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`💵 Scrapeando BCV directamente (Intento ${attempt}/${maxAttempts})...`);
        let page = null;
        try {
            page = await browser.newPage();

            // Optimización de velocidad: bloquear recursos innecesarios
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Navegar usando domcontentloaded ya que los datos están en el HTML inicial.
            // Timeout reducido a 20s para acelerar fallback si la IP del servidor está bloqueada.
            await page.goto('https://www.bcv.org.ve/', { waitUntil: 'domcontentloaded', timeout: 20000 });

            // Esperar a que carguen los elementos de tasas
            await page.waitForSelector('#dolar, #euro', { timeout: 10000 }).catch(() => null);

            const rates = await page.evaluate(() => {
                // Estrategia 1: Buscar por IDs específicos
                const dolarEl = document.querySelector('#dolar strong, #dolar .centrado');
                const euroEl = document.querySelector('#euro strong, #euro .centrado');

                // Capturar la Fecha Valor oficial del BCV
                const fechaValorEl = document.querySelector('.pull-right.dinpro.center span.date-display-single');
                const fechaValorAlt = !fechaValorEl
                    ? document.querySelector('span.date-display-single')
                    : null;
                const fechaValor = (fechaValorEl || fechaValorAlt)
                    ? (fechaValorEl || fechaValorAlt).innerText.trim()
                    : null;

                let dolar = null, euro = null;

                if (dolarEl) {
                    dolar = dolarEl.innerText.trim();
                }
                if (euroEl) {
                    euro = euroEl.innerText.trim();
                }

                // Estrategia 2: Buscar en toda la página por patrones si falló la anterior
                if (!dolar || !euro) {
                    const allText = document.body.innerText;
                    const dolarMatch = allText.match(/D[oó]lar[^0-9]*([0-9]+[,\.][0-9]+)/i);
                    const euroMatch = allText.match(/Euro[^0-9]*([0-9]+[,\.][0-9]+)/i);

                    if (dolarMatch && !dolar) dolar = dolarMatch[1];
                    if (euroMatch && !euro) euro = euroMatch[1];
                }

                return { dolar, euro, fechaValor };
            });

            await page.close();

            if (!rates.dolar || !rates.euro) {
                throw new Error("Tasas de cambio no encontradas en el contenido de la página.");
            }

            result.usd = rates.dolar.replace('.', ','); // Normalizar formato
            result.eur = rates.euro.replace('.', ',');
            result.fechaValor = rates.fechaValor;

            console.log(`✅ BCV Dólar: ${result.usd}`);
            console.log(`✅ BCV Euro: ${result.eur}`);
            if (result.fechaValor) {
                console.log(`📅 BCV Fecha Valor: ${result.fechaValor}`);
            }

            return result;

        } catch (error) {
            console.error(`⚠️ BCV Error (Intento ${attempt}):`, error.message);
            if (page) await page.close().catch(() => { });

            if (attempt === maxAttempts) {
                console.log(`❌ BCV: Scraping directo falló tras ${maxAttempts} intentos.`);
            } else {
                // Espera de 2 segundos antes del reintento
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // 2. Fallback de emergencia si el scraping directo falló en todos los intentos (ej. bloqueo de IP de GitHub Actions)
    if (!result.usd || !result.eur) {
        console.log('⚠️ Iniciando fallback de rescate mediante DolarApi...');
        try {
            // Nota: fetch es una API global nativa en Node 18+ (usado en el entorno de GitHub Actions)
            const resUsd = await fetch('https://ve.dolarapi.com/v1/dolares/oficial').then(r => r.json());
            const resEur = await fetch('https://ve.dolarapi.com/v1/euros/oficial').then(r => r.json());

            const valUsd = resUsd ? (resUsd.promedio || resUsd.venta || resUsd.compra) : null;
            const valEur = resEur ? (resEur.promedio || resEur.venta || resEur.compra) : null;
            const rawFecha = resUsd ? (resUsd.fechaActualizacion || resUsd.fecha) : null;

            if (valUsd) {
                // Convertir y formatear con coma a 4 decimales para mantener consistencia
                const parsedUsd = parseFloat(valUsd);
                result.usd = parsedUsd.toFixed(4).replace('.', ',');
                console.log(`✅ [Fallback] BCV Dólar: ${result.usd}`);
            }

            if (valEur) {
                const parsedEur = parseFloat(valEur);
                result.eur = parsedEur.toFixed(4).replace('.', ',');
                console.log(`✅ [Fallback] BCV Euro: ${result.eur}`);
            }

            if (rawFecha) {
                const dateObj = new Date(rawFecha);
                const opciones = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                let fv = dateObj.toLocaleDateString('es-VE', opciones);
                fv = fv.charAt(0).toUpperCase() + fv.slice(1); // Capitalizar
                result.fechaValor = fv;
                console.log(`📅 [Fallback] BCV Fecha Valor: ${result.fechaValor}`);
            }
        } catch (apiError) {
            console.error('❌ Error fatal en el fallback de DolarApi:', apiError.message);
        }
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

        // URL directa a USDT/VES 
        const url = 'https://p2p.binance.com/es/trade/all-payments/USDT?fiat=VES';

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Esperar a que cargue la lista de precios
        await page.waitForSelector('.headline5.text-primaryText', { timeout: 15000 }).catch(() => null);

        const price = await page.evaluate(() => {
            // Estrategia 1: Selector más específico (hermano del símbolo de moneda)
            const specificEl = document.querySelector('.subtitle6 + .headline5.text-primaryText');
            if (specificEl && /^\d/.test(specificEl.innerText)) {
                return specificEl.innerText;
            }

            // Estrategia 2: Buscar el primer elemento que parezca un precio en la lista
            const elements = document.querySelectorAll('.headline5.text-primaryText');
            for (const el of elements) {
                const text = el.innerText.trim();
                // Regex para validar formato precio: start with bits, comma/dot, bits
                if (/^[0-9]+[.,][0-9]+$/.test(text)) {
                    return text;
                }
            }
            return null;
        });

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
    const launchOptions = {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-quic'
        ]
    };

    if (!process.env.CI) {
        launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    const browser = await puppeteer.launch(launchOptions);

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
    // Guardar la fecha valor oficial del BCV
    if (bcvRates.fechaValor) {
        finalData.rates.bcv.fechaValor = bcvRates.fechaValor;
    }

    // 2. Obtener tasa Binance P2P directamente (Web Scraping)
    const binanceRate = await scrapeBinance(browser);
    if (binanceRate) {
        // Normalizar a número, redondear a 2 decimales y volver a string con coma
        const val = parseFloat(binanceRate.replace(',', '.'));
        finalData.rates.binance.usdt = val.toFixed(2).replace('.', ',');
    } else {
        console.log('⚠️ Binance: Usando fallback (N/A)');
        finalData.rates.binance.usdt = 'N/A';
    }

    // 3. Scrape News Portals with Lazy Load Support
    const newsSources = [
        {
            name: 'Banca y Negocios',
            url: 'https://www.bancaynegocios.com/category/economia/economia-nacional/',
            fn: () => {
                const article = document.querySelector('article');
                if (!article) return null;
                const titleEl = article.querySelector('.post-title a');
                if (!titleEl) return null;
                const title = titleEl.innerText.trim();
                const link = titleEl.href;
                const spanImg = article.querySelector('#post_image');
                let image = spanImg ? spanImg.innerText.trim() : null;
                if (!image) {
                    const imgEl = article.querySelector('.post-thumbnail img');
                    if (imgEl) {
                        image = imgEl.getAttribute('data-lzysrc') || imgEl.src;
                    }
                }
                if (!image) {
                    const metaImg = document.querySelector('meta[property="og:image"]');
                    if (metaImg) image = metaImg.content;
                }
                return { title, link, image };
            }
        },
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
                // Estrategia "Universal": Buscar el primer encabezado relevante (H1/H2)
                const headlines = Array.from(document.querySelectorAll('h1, h2, h3'));
                // Filtramos titulares muy cortos (menos de 20 chars) o de navegación
                const relevantHeadline = headlines.find(h => {
                    const text = h.innerText.trim();
                    return text.length > 20 && !text.includes('Sign in') && !text.includes('Log In');
                });

                if (!relevantHeadline) return null;

                const title = relevantHeadline.innerText.trim();

                // Buscar link: primero en el propio titulo, o en ancestros o hijos
                let linkEl = relevantHeadline.closest('a') || relevantHeadline.querySelector('a');

                // Fallback: buscar link hermano o en padre
                if (!linkEl) {
                    const wrapper = relevantHeadline.closest('article') || relevantHeadline.closest('.zone__item') || relevantHeadline.parentElement;
                    if (wrapper) {
                        linkEl = wrapper.querySelector('a:not(.author):not(.category)');
                    }
                }

                let link = linkEl ? linkEl.href : document.location.href;

                // Asegurar HTTPS absoluto
                if (link && !link.startsWith('http')) {
                    link = 'https://cnnespanol.cnn.com' + (link.startsWith('/') ? '' : '/') + link;
                }

                // Imagen: Buscar en wrapper ascendente (hasta 5 niveles)
                let img = null;
                let wrapper = relevantHeadline.parentElement;
                let attempts = 0;
                while (wrapper && attempts < 5 && !img) {
                    const imgEl = wrapper.querySelector('img, amp-img');
                    if (imgEl) {
                        img = imgEl.src || imgEl.getAttribute('data-src') || imgEl.srcset?.split(' ')[0] || imgEl.getAttribute('content');
                    }
                    wrapper = wrapper.parentElement;
                    attempts++;
                }

                if (!img) {
                    const meta = document.querySelector('meta[property="og:image"]');
                    if (meta) img = meta.content;
                }

                return { title, link, image: img };
            }
        },
        {
            name: 'Noticias Venevisión',
            url: 'https://noticiasvenevision.com/',
            fn: () => {
                // Buscamos el primer enlace que parezca una noticia y tenga un título razonable
                const articles = document.querySelectorAll('a[href*="/noticias/"]');
                for (const article of articles) {
                    const title = article.innerText.trim();
                    if (title.length > 20) {
                        const imgEl = article.querySelector('img');
                        // El título a veces viene en el data-dl_data pero innerText funciona bien
                        return {
                            title: title,
                            link: article.href,
                            image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null
                        };
                    }
                }
                return null;
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
            url: 'https://laverdad.com/category/mundo/',
            fn: () => {
                // Estrategia 1: Buscar dentro de items del plugin Ultimate Post Kit
                // donde título e imagen pertenecen al mismo bloque
                const items = document.querySelectorAll('.upk-block-item, .upk-post-grid-item, .upk-slider-item');
                for (const item of items) {
                    const titleEl = item.querySelector('.upk-title a');
                    const imgEl = item.querySelector('img');
                    if (titleEl && titleEl.innerText.trim().length > 10) {
                        return {
                            title: titleEl.innerText.trim(),
                            link: titleEl.href,
                            image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || imgEl.srcset?.split(' ')[0]) : null
                        };
                    }
                }

                // Estrategia 2: Buscar article con título e imagen juntos
                const articles = document.querySelectorAll('article');
                for (const article of articles) {
                    const titleEl = article.querySelector('h2 a, h3 a, .entry-title a');
                    const imgEl = article.querySelector('img');
                    if (titleEl && titleEl.innerText.trim().length > 10) {
                        return {
                            title: titleEl.innerText.trim(),
                            link: titleEl.href,
                            image: imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || imgEl.srcset?.split(' ')[0]) : null
                        };
                    }
                }

                // Estrategia 3: Fallback al meta og:image con primer título
                const anyTitle = document.querySelector('.upk-title a, h2 a, h3 a');
                const metaImg = document.querySelector('meta[property="og:image"]');
                if (anyTitle) {
                    return {
                        title: anyTitle.innerText.trim(),
                        link: anyTitle.href,
                        image: metaImg?.content || null
                    };
                }
                return null;
            }
        },
        {
            name: 'Diario Versión Final',
            url: 'https://diarioversionfinal.com/categoria/mundo/',
            fn: () => {
                // Estrategia: Iterar sobre artículos para asegurar consistencia
                // Buscamos contenedores comunes de posts (article, .post, .td-module-container, .category-item)
                // Versión Final usa 'article' y 'div.post-item' según la página
                const articles = document.querySelectorAll('article, .post-item, .td_module_wrap, .category-item');

                for (const article of articles) {
                    const titleEl = article.querySelector('.post-title a, h2 a, h3 a, .entry-title a');
                    // Intentar sacar imagen. VF usa div.img-holder con background-image
                    const holder = article.querySelector('.img-holder, .post-thumbnail, .img-cont');

                    let img = null;
                    if (holder) {
                        const style = holder.getAttribute('style') || window.getComputedStyle(holder).backgroundImage;
                        if (style && style.includes('url')) {
                            const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                            if (match) img = match[1];
                        }
                    } else {
                        // Fallback a img tag normal
                        const imgEl = article.querySelector('img');
                        if (imgEl) img = imgEl.src || imgEl.dataset.src;
                    }

                    if (titleEl && titleEl.innerText.trim().length > 10) {
                        return {
                            title: titleEl.innerText.trim(),
                            link: titleEl.href,
                            image: img
                        };
                    }
                }
                return null;
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
