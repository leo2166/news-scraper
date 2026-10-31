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
  - **Móvil (≤ 768px):** Para evitar que se comprima o solape con la fecha de "Última actualización", se oculta del `<header>` y se ubica como un bloque independiente **inmediatamente sobre el primer recuadro de la tasa del BCV** (clase `.mobile-nav` en `index.html`).

### 3. Extractor "Noticia al Día" - Estructura DOM Real
El sitio `noticialdia.com` tiene esta estructura dentro de cada `<article>`:
```html
<article>
  <div class="wppm-post-wrap">
    <div class="entry-content">  <!-- título y link aquí -->
    </div>
    <div class="post-img">      <!-- imagen aquí (contenedor separado) -->
    </div>
  </div>
</article>
```
El extractor itera artículo por artículo y extrae título desde `.entry-title a` e imagen desde `.post-img img` del **mismo** `<article>`, garantizando siempre coherencia imagen-título.

---

## 📜 Bitácora de Cambios (Changelog)

### [2026-10-31] - Sesión 1: Ajustes de refresco, navegación responsive y memoria de trabajo
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

### [2026-10-31] - Sesión 2: Fix discrepancia imagen/título en "Noticia al Día"
- **Problema detectado:** La tarjeta de "Noticia al Día" mostraba una imagen que no correspondía al artículo (ej. foto de un futbolista en una nota sobre La Chinita).
- **Causa raíz:** El sitio `noticialdia.com` separa título (en `div.entry-content`) e imagen (en `div.post-img`) dentro del mismo `<article>`. Los selectores genéricos anteriores podían mezclar datos de artículos distintos.
- **Solución aplicada en `scraper.js`:**
  - Se reescribió el extractor para iterar `article` por `article`.
  - Dentro de cada `<article>`: título desde `.entry-title a`, imagen desde `.post-img img` del **mismo** artículo.
  - Fallback 1: cualquier `img` dentro del mismo artículo.
  - Fallback 2 (último recurso): `meta[property="og:image"]` + primer título encontrado.
- **Estado:** Subido a `origin/main`. Aplica en el próximo ciclo de GitHub Actions (cada hora) o via `workflow_dispatch` manual.

---

## 🚀 Pautas para Futuras Sesiones
1. **Siempre hacer `git pull --rebase origin main` antes de pushear:** GitHub Actions realiza commits automatizados con las actualizaciones de `data.json` y `data.js`.
2. **Respetar la experiencia visual:** No utilizar recargas completas de ventana (`location.reload()`); todas las actualizaciones de datos en el cliente deben ser vía `loadData()`.
3. **Mantener la consistencia responsive:** Verificar siempre que los elementos no colisionen en pantallas estrechas de celular (360px - 430px de ancho).
4. **Actualizar `progreso.md`:** Al finalizar cualquier sesión o cambio relevante, agregar la entrada correspondiente en este archivo.
5. **Coherencia imagen-título en scrapers:** Al agregar o modificar fuentes de noticias, asegurarse de que título e imagen se extraigan del **mismo contenedor DOM** para evitar discrepancias visuales.
