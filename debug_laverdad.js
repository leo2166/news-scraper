const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('Navegando a laverdad.com...');
    await page.goto('https://laverdad.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Debug: Dump all links with titles
    const data = await page.evaluate(() => {
        const results = [];
        const elements = document.querySelectorAll('h3 a, .entry-title a, .td-module-title a');
        elements.forEach(el => {
            if (el.innerText.trim().length > 10) {
                results.push({
                    text: el.innerText.trim(),
                    href: el.href,
                    class: el.className,
                    parentClass: el.parentElement.className
                });
            }
        });
        return results.slice(0, 5); // Return first 5
    });

    console.log('Elementos encontrados:', data);
    await browser.close();
})();
