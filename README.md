# Portal de Noticias · Google Workspace

Un sitio web que se **actualiza solo cada día a las 7:00 (hora de Ciudad de México)** con todo lo
del ecosistema Google Workspace, organizado en secciones con menú lateral:

- **Novedades** — anuncios directos de las páginas oficiales de Google.
- **Noticias** — cobertura de otras webs de tecnología.
- **Videos** — videos recientes de YouTube (búsqueda automática), embebidos en la página. Solo se
  muestran videos de **máximo una semana** de antigüedad, ordenados del más nuevo al más viejo, y los
  recién agregados llevan una etiqueta **NUEVO**.
- **Google Drive** — novedades y noticias específicas de Google Drive.
- **Unidades compartidas** — novedades sobre las Unidades compartidas (Shared Drives).
- **Empresas** — organizaciones que adoptan o usan Google Workspace.
- **Favoritos** — tus artículos y videos guardados (con la estrella ⭐ de cada tarjeta). Se guardan en
  tu navegador.

Además, cada tarjeta tiene un botón para **ocultarla** (✕) si no quieres verla; puedes restaurar las
ocultas desde **Ajustes**. Todo esto (favoritos, ocultos, tema y clave de Groq) vive solo en tu
navegador.

Cada noticia trae su imagen y enlace a la fuente; los videos se ven dentro del sitio. Hay filtros
por periodo (Todo / Esta semana / Hoy), **interruptor de tema claro/oscuro** (con memoria), iconos
vectoriales incrustados (sin depender de ningún CDN) y un panel de **IA (Groq)** para traducir/resumir
al español.
Todo corre en **GitHub Actions** (gratis, siempre encendido) y se publica en **GitHub Pages**. No
depende de que tu computadora esté encendida.

## Qué hay aquí

- `index.html` — el sitio (se regenera solo; funciona tal cual desde el primer momento).
- `data.json` — el historial acumulado por secciones (el estado que se guarda cada día).
- `scripts/generate.mjs` — el generador: descarga feeds oficiales, noticias, empresas y videos, y reescribe el sitio.
- `.github/workflows/daily.yml` — la tarea diaria (cron 13:00 UTC = 07:00 CDMX).

---

## Puesta en marcha (una sola vez, ~5 minutos)

### 1. Crea el repositorio y sube estos archivos

**Desde tu terminal:**

```bash
cd carpeta-donde-descomprimiste-esto
git init
git add -A
git commit -m "Portal Google Workspace"
git branch -M main
# crea el repo público "workspace-news" en github.com y luego:
git remote add origin https://github.com/jairocarrizales/workspace-news.git
git push -u origin main
```

(O crea el repo en la web y sube el contenido con “Add file → Upload files”, respetando las
subcarpetas `scripts/` y `.github/workflows/`.)

### 2. Da permiso de escritura a las Actions

**Settings → Actions → General → Workflow permissions →** elige **“Read and write permissions”** y
guarda. (Deja que la tarea diaria haga el commit con lo nuevo.)

### 3. Activa GitHub Pages

**Settings → Pages → Source: “Deploy from a branch” → Branch: `main` / `(root)` → Save.**

Tu portal quedará en:

```
https://jairocarrizales.github.io/workspace-news/
```

### 4. Corre la tarea una vez a mano (opcional)

**Actions → “Portal Google Workspace” → Run workflow.** Así se llenan las secciones de Noticias y
Videos sin esperar a las 7am. A partir de ahí corre solo todos los días.

---

## Resúmenes en español con Groq (tu clave, en tu navegador)

1. Consigue una clave gratis en **console.groq.com** (empieza con `gsk_...`).
2. Abre tu portal, haz clic en **⚙️ Ajustes (IA · Groq)** (abajo en el menú lateral).
3. Pega la clave, activa **“Traducir/resumir al español automáticamente”** y guarda.

La clave se guarda **solo en tu navegador** (localStorage): nunca viaja a GitHub ni a este repo. La
traducción ocurre en tu equipo y se guarda en caché para no repetir trabajo. Sin clave, el sitio
funciona igual, con los titulares en su idioma original.

> Nota: como la traducción es del lado del navegador, depende de que Groq permita llamadas desde el
> navegador (CORS). Si en algún momento fallara, el sitio muestra las noticias en su idioma original
> sin romperse.

---

## Notas

- 13:00 UTC = 7:00 en Ciudad de México (UTC-6, sin horario de verano). GitHub a veces retrasa unos
  minutos las tareas programadas cuando hay mucha carga; es normal.
- Historial: últimos 45 días (`DAYS_TO_KEEP` en `scripts/generate.mjs`).
- Fuentes y búsquedas de YouTube: arreglos `FEEDS` y `YT_QUERIES` en `scripts/generate.mjs` — puedes
  agregar o quitar a tu gusto.
- La sección **Videos** usa la miniatura de YouTube y carga el reproductor al hacer clic (más rápido).
