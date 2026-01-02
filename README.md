# 📰 News & Rates Scraper Dashboard

Este proyecto es un dashboard automatizado que extrae y visualiza:
1.  **Tasas de Cambio en Venezuela:** BCV (USD/EUR), Monitor Dólar (Instagram), Binance P2P.
2.  **Titulares de Noticias:** De los principales portales informativos (Infobae, El Nacional, CNN, etc.).

## 🚀 Arquitectura

El sistema consta de dos partes:
- **`scraper.js` (Backend):** Script de Node.js + Puppeteer que navega, extrae datos, toma capturas y genera un JSON. Incluye lógica de reintentos y evasión de bloqueos.
- **`index.html` (Frontend):** Interfaz estática (Glassmorphism Light Theme) que lee los datos generados y los presenta al usuario instantáneamente.

## 🛠️ Instalación

1.  Clonar el repositorio.
2.  Instalar dependencias:
    ```bash
    npm install
    ```
3.  Instalar Tesseract (si se usa OCR):
    ```bash
    npm install tesseract.js
    ```

## ▶️ Uso

Para actualizar los datos manualmente:

```bash
node scraper.js
```

Esto generará un archivo `data.json` y `data.js` que el `index.html` consume.

## 🤖 Automatización

Se recomienda configurar un **Cron Job** (GitHub Actions o servidor dedicado) para ejecutar `node scraper.js` cada hora y desplegar el resultado estático.
