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

## Acceso privado con usuario y contraseña (opcional)

El portal puede quedar **protegido** para que solo tú entres, sin que la contraseña esté en el
código. Funciona cifrando el contenido: el repo guarda solo **texto cifrado** (AES-256-GCM) y tu
usuario+contraseña son la llave que lo descifra **en tu navegador**. Como GitHub Pages es público,
esta es la única forma real de protegerlo: sin las credenciales, nadie puede leer nada aunque baje
los archivos.

Para activarlo, agrega dos secrets en el repo (**Settings → Secrets and variables → Actions**):

- `PORTAL_USER` → el usuario que quieras
- `PORTAL_PASSWORD` → la contraseña que quieras

En la siguiente corrida del workflow, el sitio se genera cifrado y pedirá login. La contraseña
**no** queda escrita en el repo ni en la web: solo vive como secret (cifrado, invisible) para que el
trabajo diario pueda re-cifrar el contenido nuevo.

- Para **cambiar** la contraseña: edita los secrets y vuelve a correr el workflow.
- Para **quitar** el login: borra los dos secrets y corre el workflow (vuelve a modo público).
- En la pantalla de acceso puedes marcar "Recordarme en este dispositivo" para no escribirla cada
  vez (se guarda solo en tu navegador). El botón "Cerrar sesión" del menú la olvida.

> Nota: requiere HTTPS para el descifrado (GitHub Pages ya usa HTTPS, así que funciona). Si abres el
> `index.html` cifrado como archivo local (file://), el navegador no permite descifrar.

## Notas

- 13:00 UTC = 7:00 en Ciudad de México (UTC-6, sin horario de verano). GitHub a veces retrasa unos
  minutos las tareas programadas cuando hay mucha carga; es normal.
- Historial: últimos 45 días (`DAYS_TO_KEEP` en `scripts/generate.mjs`).
- Fuentes y búsquedas de YouTube: arreglos `FEEDS` y `YT_QUERIES` en `scripts/generate.mjs` — puedes
  agregar o quitar a tu gusto.
- La sección **Videos** usa la miniatura de YouTube y carga el reproductor al hacer clic (más rápido).
