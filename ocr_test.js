const Tesseract = require('tesseract.js');

// URL de la imagen del post de Instagram (obtenida del log anterior)
const imageUrl = 'https://scontent.cdninstagram.com/v/t51.82787-15/610022666_17905619601336587_1417495028930994263_n.webp?stp=c216.0.648.648a_dst-jpg_e35_s640x640_tt6&_nc_cat=111&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiRkVFRC5iZXN0X2ltYWdlX3VybGdlbi5DMyJ9&_nc_ohc=bz1NWfy4QskQ7kNvwGQtRBz&_nc_oc=AdnDB3fu-vJqIAM2GQnwNbTpWIiyVMfXMHrD4FsCEFpGlGs84C8e4y3ydMy6PWv4AXA&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=rxlckGiGZI-ccqsliw1w6w&oh=00_AfqFG3SGnr0Yg6dPNShjYpG2v9-hlTH1RWDKdXpE-5XX2g&oe=695D6504';

console.log('🔍 Iniciando reconocimiento de texto en la imagen...');

Tesseract.recognize(
    imageUrl,
    'eng', // Usamos inglés porque los números y "Bs." se leen bien, "spa" es más lento y pesado
    { logger: m => console.log(m) }
).then(({ data: { text } }) => {
    console.log('✅ Texto extraído:');
    console.log('-----------------------------------');
    console.log(text);
    console.log('-----------------------------------');

    // Intentar parsear las tasas
    const binanceRegex = /Binance.*?Bs\.?\s*([\d,.]+)/i;
    const kontigoRegex = /Kontigo.*?Bs\.?\s*([\d,.]+)/i;

    const binanceMatch = text.match(binanceRegex);
    const kontigoMatch = text.match(kontigoRegex);

    console.log('📊 Resultados del análisis:');
    if (binanceMatch) console.log(`Binance: ${binanceMatch[1]}`);
    else console.log('❌ No se encontró tasa Binance');

    if (kontigoMatch) console.log(`Kontigo: ${kontigoMatch[1]}`);
    else console.log('❌ No se encontró tasa Kontigo');
});
