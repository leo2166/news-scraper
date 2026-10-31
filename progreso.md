# 📋 Memoria de Progreso y Registro de Cambios (`progreso.md`)

> [!IMPORTANT]
> **REGLA DE INICIO DE SESIÓN:**
> Cada vez que se inicie una nueva sesión de trabajo en este proyecto, **este archivo debe ser leído en su totalidad** para conocer el estado actual, las decisiones de diseño adoptadas, la arquitectura y los cambios recientes.

---

## 📌 Visión General del Proyecto

Dashboard automatizado para la visualización de noticias y tasas de cambio en Venezuela:
- **Backend / Scraper:** `scraper.js` (Node.js + Puppeteer) extrae tasas del BCV (USD, EUR, Fecha Valor), Binance P2P (USDT/VES vía API y scraping fallback) y noticias destacadas de múltiples fuentes informativas.
- **Frontend:** `index.html` + `style.css` (interfaz web estática moderna con tema claro/glassmorphism, servida en GitHub Pages / Vercel).
- **Datos generados:** `data.json` y `data.js` (para consumo vía `fetch` o script local).
- **Automatización CI/CD:** `.github/workflows/scrape.yml` (GitHub Actions).
- **Aplicación Principal / Padre:** `https://tuinfo.vercel.app` (desde donde se invoca este dashboard).

---

## ⚙️ Arquitectura y Decisiones Técnicas Clave

### 1. Frecuencia de Actualizaciones
- **GitHub Actions (`scrape.yml`):**
  - Frecuencia: **Cada 1 hora** (`0 * * * *`).
  - *Razón:* Las tasas del BCV solo cambian 1 vez al día (días hábiles). Ejecutarlo más frecuente consume minutos innecesarios de GitHub Actions sin aportar datos nuevos significativos.
- **Frontend (`index.html`):**
  - Frecuencia: **Cada 20 minutos** (`setInterval(() => loadData(), 1200000)`).
  - *Eliminación del pestañazo:* Anteriormente existía un `setTimeout` con `window.location.reload()`, lo cual provocaba una recarga completa molesta para el usuario en pantalla. Se cambió a recarga silenciosa de datos (`loadData()`) sin recargar el navegador.

### 2. Enlace de Retorno ("Volver al menú principal")
- **URL destino:** `https://tuinfo.vercel.app`
- **Color:** Azul rey (`#1d4ed8`, hover `#1e40af`) con `font-weight: 600` para alta visibilidad y contraste en ambos dispositivos.
- **Comportamiento Responsive:**
  - **PC (Escritorio > 768px):** Se muestra dentro del `<header>` junto al título y la fecha de última actualización.
  - **Móvil (≤ 768px):** Para evitar que se comprima o solape con la fecha de "Última actualización", se oculta del `<header>` y se ubica como un bloque independiente **inmediatamente sobre el primer recuadro de la tasa del BCV**.

---

## 📜 Bitácora de Cambios (Changelog)

### [2026-10-31] - Ajustes de refresco, navegación responsive y memoria de trabajo
- **Solución al pestañazo / parpadeo de pantalla:**
  - Se eliminó `setTimeout(() => window.location.reload(), 300000)` de `index.html`.
  - Se implementó `setInterval(() => loadData(), 1200000)` para actualizar los datos cada 20 minutos de forma silenciosa e imperceptible.
- **Enlace "← Volver al menú principal":**
  - Añadido enlace a `https://tuinfo.vercel.app`.
  - Adaptación responsive: en móvil (`style.css` `@media (max-width: 768px)`) se posiciona sobre el primer recuadro del BCV evitando solapamiento con la fecha.
  - Tipografía definida en color azul rey (`#1d4ed8`).
- **Control de versiones:**
  - Creación de este archivo `progreso.md` para documentar la memoria histórica del proyecto.
  - Sincronización continua de `origin/main` con los commits automáticos de GitHub Actions (`git pull --rebase`).

---

## 🚀 Pautas para Futuras Sesiones
1. **Siempre hacer `git pull --rebase origin main` antes de pushear:** GitHub Actions realiza commits automatizados con las actualizaciones de `data.json` y `data.js`.
2. **Respetar la experiencia visual:** No utilizar recargas completas de ventana (`location.reload()`); todas las actualizaciones de datos en el cliente deben ser vía `loadData()`.
3. **Mantener la consistencia responsive:** Verificar siempre que los elementos no colisionen en pantallas estrechas de celular (360px - 430px de ancho).
4. **Actualizar `progreso.md`:** Al finalizar cualquier sesión o cambio relevante, agregar la entrada correspondiente en este archivo.
