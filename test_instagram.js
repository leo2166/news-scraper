const puppeteer = require('puppeteer');

async function testInsta() {
    console.log('🚀 Testing Instagram...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-ES']
    });

    try {
        const page = await browser.newPage();
        // Set user agent to avoid immediate blocking
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = 'https://www.instagram.com/p/DS7mc48kfNR/';
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait a bit
        await new Promise(r => setTimeout(r, 5000));

        // Try to get meta data first (often easiest)
        const meta = await page.evaluate(() => {
            return {
                title: document.querySelector('meta[property="og:title"]')?.content,
                image: document.querySelector('meta[property="og:image"]')?.content,
                description: document.querySelector('meta[property="og:description"]')?.content,
                isLoginRedirect: document.URL.includes('login')
            };
        });

        console.log('📊 Meta Data:', meta);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
}

testInsta();
