// ============================================================================
// Portal de Noticias · Google Workspace — generador (v2, por secciones)
// ----------------------------------------------------------------------------
// Se ejecuta cada día en GitHub Actions:
//   1. Lee data.json (estado acumulado por secciones).
//   2. Descarga fuentes:
//        · novedades  -> feeds oficiales de Google
//        · noticias   -> otras webs de tecnología (vía Google News)
//        · empresas   -> adopción/despliegues en empresas
//        · videos     -> búsqueda en YouTube (por fecha)
//   3. Agrega lo NUEVO a cada sección (sin duplicar) y poda a DAYS_TO_KEEP.
//   4. Reescribe data.json e index.html (SPA autocontenida con menú lateral).
//
// La traducción/resumen al español se hace en el NAVEGADOR con la clave de Groq
// del usuario (guardada en localStorage), no aquí. Ver el <script> de la página.
// ============================================================================

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data.json');
const OUT = join(ROOT, 'index.html');
const DAYS_TO_KEEP = 45;
const VIDEO_MAX_AGE_DAYS = 7;   // los videos no pueden ser más viejos que esto
const MAX_PER_FEED = 10;
const CAP = { novedades: 60, noticias: 60, empresas: 40, drive: 50, unidades: 40, videos: 30 };
const TEXT_SECTIONS = ['novedades', 'noticias', 'empresas', 'drive', 'unidades'];

const FEEDS = [
  { section: 'novedades', source: 'Google Workspace Updates', url: 'https://workspaceupdates.googleblog.com/feeds/posts/default?alt=rss' },
  { section: 'novedades', source: 'Google Workspace Blog',    url: 'https://blog.google/products/workspace/rss/' },
  { section: 'noticias',  source: 'Google News',              url: 'https://news.google.com/rss/search?q=%22Google%20Workspace%22%20when:14d&hl=es-419&gl=MX&ceid=MX:es' },
  { section: 'noticias',  source: 'Google News',              url: 'https://news.google.com/rss/search?q=%22Google%20Workspace%22%20(Gemini%20OR%20update%20OR%20feature)&hl=en-US&gl=US&ceid=US:en' },
  { section: 'empresas',  source: 'Google News',              url: 'https://news.google.com/rss/search?q=%22Google%20Workspace%22%20(enterprise%20OR%20empresa%20OR%20adopts%20OR%20deploys%20OR%20migration%20OR%20customer)&hl=es-419&gl=MX&ceid=MX:es' },
  { section: 'drive',     source: 'Google News',              url: 'https://news.google.com/rss/search?q=%22Google%20Drive%22%20(update%20OR%20feature%20OR%20Workspace%20OR%20almacenamiento%20OR%20Gemini)&hl=es-419&gl=MX&ceid=MX:es' },
  { section: 'drive',     source: 'Google Workspace Updates', url: 'https://workspaceupdates.googleblog.com/feeds/posts/default/-/Drive?alt=rss' },
  { section: 'unidades',  source: 'Google News',              url: 'https://news.google.com/rss/search?q=(%22Shared%20Drives%22%20OR%20%22Unidades%20compartidas%22)%20Google&hl=es-419&gl=MX&ceid=MX:es' },
  { section: 'unidades',  source: 'Google Workspace Updates', url: 'https://workspaceupdates.googleblog.com/feeds/posts/default/-/Shared%20drives?alt=rss' },
];

const YT_QUERIES = [
  'Google Workspace novedades',
  'Google Workspace update 2026',
  'Google Workspace Gemini tips',
];

const THEME = {
  novedades: { accent: '#1a73e8' },
  noticias:  { accent: '#a142f4' },
  empresas:  { accent: '#34a853' },
  drive:     { accent: '#0f9d58' },
  unidades:  { accent: '#f9ab00' },
};

// --- XML helpers (sin dependencias) -----------------------------------------
function decode(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').trim();
}
function stripTags(s = '') { return decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function blocks(xml, tag) { return xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g')) || []; }
function tag(xml, name) { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; }
function linkOf(item) { let m = item.match(/<link[^>]*href="([^"]+)"/i); if (m) return m[1]; m = item.match(/<link>([\s\S]*?)<\/link>/i); return m ? decode(m[1]) : ''; }
function imageOf(item) {
  let m = item.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i); if (m) return m[1];
  m = item.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i); if (m) return m[1];
  const html = (item.match(/<(?:content|description|summary)[^>]*>([\s\S]*?)<\/(?:content|description|summary)>/i) || [])[1] || '';
  m = decode(html).match(/<img[^>]*src="([^"]+)"/i); return m ? m[1] : '';
}
function sourceOf(item, fallback) { const m = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i); return m ? stripTags(m[1]) : fallback; }
function dateOf(item) { const raw = tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated'); const d = raw ? new Date(raw) : null; return d && !isNaN(d) ? d.toISOString().slice(0, 10) : todayMX(); }

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; workspace-news/2.0)', 'Accept-Language': 'es-419,es;q=0.9,en;q=0.8' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function fetchFeed(feed) {
  try {
    const xml = await fetchText(feed.url);
    const items = [...blocks(xml, 'item'), ...blocks(xml, 'entry')].slice(0, MAX_PER_FEED);
    return items.map(it => ({
      section: feed.section,
      title: stripTags(tag(it, 'title')),
      summary: stripTags((it.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1] || '').slice(0, 300),
      url: linkOf(it),
      image: imageOf(it),
      source: sourceOf(it, feed.source),
      date: dateOf(it),
    })).filter(n => n.title && n.url);
  } catch (e) { console.warn('feed', feed.url, e.message); return []; }
}

async function fetchYouTube(query) {
  try {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=CAI%253D';
    const html = await fetchText(url);
    const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});<\/script>/) || html.match(/var ytInitialData = (\{[\s\S]*?\});/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const out = [];
    JSON.stringify(data, (k, v) => {
      if (v && v.videoRenderer && v.videoRenderer.videoId) {
        const vr = v.videoRenderer;
        const when = (vr.publishedTimeText && vr.publishedTimeText.simpleText) || '';
        const age = ageDaysFromText(when);
        out.push({
          section: 'videos',
          videoId: vr.videoId,
          title: (vr.title && vr.title.runs && vr.title.runs[0].text) || '',
          channel: (vr.ownerText && vr.ownerText.runs && vr.ownerText.runs[0].text) || (vr.longBylineText && vr.longBylineText.runs && vr.longBylineText.runs[0].text) || '',
          when: when,
          url: 'https://www.youtube.com/watch?v=' + vr.videoId,
          publishedDate: age == null ? null : dateMinusDays(age),
          firstSeen: todayMX(),
        });
      }
      return v;
    });
    // Solo videos con antigüedad conocida y <= 1 semana
    return out.filter(v => v.title && v.publishedDate && daysSince(v.publishedDate) <= VIDEO_MAX_AGE_DAYS);
  } catch (e) { console.warn('yt', query, e.message); return []; }
}

// --- helpers de estado -------------------------------------------------------
function keyOf(n) { return (n.title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 90); }
function todayMX() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function cutoff() { const d = new Date(); d.setDate(d.getDate() - DAYS_TO_KEEP); return d.toISOString().slice(0, 10); }
function dateMinusDays(n) { const d = new Date(); d.setDate(d.getDate() - Math.round(n)); return d.toISOString().slice(0, 10); }
function daysSince(iso) { const d = new Date(iso + 'T00:00:00Z'); return Math.floor((Date.now() - d.getTime()) / 86400000); }
// Convierte "hace 3 días" / "3 days ago" / "hace 2 semanas" a número de días (o null)
function ageDaysFromText(t) {
  if (!t) return null;
  t = t.toLowerCase();
  const m = t.match(/(\d+)\s*(minut|hora|hour|min|día|dia|day|semana|week|mes|month|año|ano|year)/);
  if (!m) { if (/hace un|hace una|a day|an hour|a week|a month|a year/.test(t)) { /* ~1 */ } else return null; }
  const n = m ? parseInt(m[1], 10) : 1;
  const u = m ? m[2] : (/week/.test(t) ? 'week' : /month/.test(t) ? 'month' : /year/.test(t) ? 'year' : 'day');
  if (/minut|min|hora|hour/.test(u)) return 0;
  if (/semana|week/.test(u)) return n * 7;
  if (/mes|month/.test(u)) return n * 30;
  if (/año|ano|year/.test(u)) return n * 365;
  return n; // días
}

function mergeSection(existing, fresh, capN) {
  const seen = new Set(existing.map(keyOf));
  const news = [];
  for (const n of fresh) {
    const id = keyOf(n);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const t = THEME[n.section]; if (t) n.accent = t.accent;
    news.push(n);
  }
  const lim = cutoff();
  const all = [...news, ...existing].filter(x => (x.date || '9999') >= lim);
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { list: all.slice(0, capN), added: news.length, newItems: news };
}

function mergeVideos(existing, fresh) {
  const seen = new Set(existing.map(v => v.videoId));
  const added = [];
  for (const v of fresh) { if (!v.videoId || seen.has(v.videoId)) continue; seen.add(v.videoId); added.push(v); }
  let all = [...added, ...existing].filter(v => {
    let pd = v.publishedDate;
    if (!pd && v.when) { const a = ageDaysFromText(v.when); if (a != null) pd = dateMinusDays(a); }
    if (!pd) return false;
    v.publishedDate = pd;
    if (!v.firstSeen) v.firstSeen = v.date || todayMX();
    return daysSince(pd) <= VIDEO_MAX_AGE_DAYS;
  });
  const uniq = [], s2 = new Set();
  for (const v of all) { if (s2.has(v.videoId)) continue; s2.add(v.videoId); uniq.push(v); }
  uniq.sort((a, b) => (a.publishedDate < b.publishedDate ? 1 : -1));
  return { list: uniq.slice(0, CAP.videos), added: added.length, newItems: added };
}

async function main() {
  let data = {};
  try { data = JSON.parse(await readFile(DATA, 'utf8')); } catch {}
  for (const s of [...TEXT_SECTIONS, 'videos']) if (!Array.isArray(data[s])) data[s] = [];

  const feedItems = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const vids = (await Promise.all(YT_QUERIES.map(fetchYouTube))).flat();

  // agrupa por sección (cada sección deduplica por su cuenta)
  const bySection = {}; TEXT_SECTIONS.forEach(s => bySection[s] = []);
  for (const it of feedItems) if (bySection[it.section]) bySection[it.section].push(it);

  const SEC_LABEL = { novedades: 'Novedades', noticias: 'Noticias', empresas: 'Empresas', drive: 'Google Drive', unidades: 'Unidades compartidas', videos: 'Videos' };
  const report = [], newTitles = [];
  let totalAdded = 0;
  for (const s of TEXT_SECTIONS) {
    const r = mergeSection(data[s], bySection[s], CAP[s]);
    data[s] = r.list; report.push(`${s}+${r.added}`); totalAdded += r.added;
    r.newItems.forEach(it => newTitles.push('[' + SEC_LABEL[s] + '] ' + it.title));
  }
  const rv = mergeVideos(data.videos, vids);
  data.videos = rv.list; report.push(`videos+${rv.added}`); totalAdded += rv.added;
  rv.newItems.forEach(v => newTitles.push('[Videos] ' + v.title));

  data.updatedISO = new Date().toISOString();

  await writeFile(DATA, JSON.stringify(data, null, 2));
  await writeFile(OUT, render(data));

  // Resumen para el correo (lo lee el workflow)
  const SITE = process.env.SITE_URL || 'https://jairocarrizales.github.io/workspace-news/';
  const body = [
    totalAdded
      ? 'Se agregaron ' + totalAdded + ' elementos nuevos a tu Portal de Google Workspace:'
      : 'Tu Portal de Google Workspace se revisó (sin elementos nuevos hoy).',
    '',
    ...newTitles.slice(0, 25).map(t => '• ' + t),
    '',
    'Ábrelo aquí: ' + SITE,
    '',
  ].join('\n');
  await writeFile(join(ROOT, '_summary.txt'), body + '\n');
  await writeFile(join(ROOT, '_new_count.txt'), String(totalAdded));

  console.log('OK ·', report.join(' '), '· nuevos:', totalAdded, '· total',
    [...TEXT_SECTIONS, 'videos'].map(s => s + ':' + data[s].length).join(' '));
}

function render(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return TEMPLATE.replace('/*__DATA__*/null', json);
}

const TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal · Google Workspace</title>
<style>
  :root{
    --blue:#1a73e8;--purple:#a142f4;--green:#34a853;--red:#ea4335;--yellow:#fbbc04;
    --ink:#1f2430;--muted:#5f6572;--line:#e6e9ef;--bg:#f4f6fb;--card:#fff;--side:#101828;--side2:#1b2536;
    --topbar:rgba(244,246,251,.9);--tagbg:rgba(255,255,255,.94);--ghost:#eef1f6;
    --chipbg:#fff;--chip-active-bg:#1f2430;--chip-active-fg:#fff;--shadow:rgba(32,33,36,.12);
  }
  html[data-theme="dark"]{
    --ink:#e7ecf3;--muted:#9aa7bd;--line:#26313f;--bg:#0e131c;--card:#171f2b;
    --topbar:rgba(14,19,28,.9);--tagbg:rgba(12,18,28,.82);--ghost:#232d3c;
    --chipbg:#171f2b;--chip-active-bg:#e7ecf3;--chip-active-fg:#0e131c;--shadow:rgba(0,0,0,.5);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:'Google Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  .app{display:flex;min-height:100vh}

  /* Sidebar */
  .side{width:248px;flex:0 0 248px;background:linear-gradient(180deg,var(--side),var(--side2));color:#e8ecf3;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .brand{display:flex;align-items:center;gap:11px;padding:20px 18px 16px}
  .brand .mk{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#1a73e8,#34a853);display:flex;align-items:center;justify-content:center;color:#fff}
  .gearbtn .bi{display:inline-flex}
  .brand b{font-size:15px;font-weight:600;letter-spacing:.2px;display:block}
  .brand small{font-size:11.5px;color:#9aa7bd}
  .nav{padding:8px 10px;display:flex;flex-direction:column;gap:3px}
  .nav a{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;color:#c4cddd;font-size:14px;font-weight:500;cursor:pointer;transition:.15s}
  .nav a .ic{font-size:17px;width:22px;text-align:center}
  .nav a .ct{margin-left:auto;font-size:11.5px;color:#8b98af;background:rgba(255,255,255,.06);padding:1px 8px;border-radius:999px;min-width:24px;text-align:center}
  .nav a:hover{background:rgba(255,255,255,.06);color:#fff}
  .nav a.active{background:rgba(255,255,255,.12);color:#fff}
  .nav a.active .ct{background:rgba(255,255,255,.2);color:#fff}
  .side .spacer{flex:1}
  .side .foot{padding:12px 14px 16px;border-top:1px solid rgba(255,255,255,.08)}
  .gearbtn{display:flex;align-items:center;gap:10px;width:100%;background:rgba(255,255,255,.06);border:0;color:#c4cddd;padding:10px 12px;border-radius:10px;font-size:13.5px;cursor:pointer;font-family:inherit}
  .gearbtn:hover{background:rgba(255,255,255,.12);color:#fff}
  .updated{font-size:11px;color:#7f8da3;margin-top:10px;padding:0 2px}

  /* Main */
  .main{flex:1;min-width:0;display:flex;flex-direction:column}
  .topbar{position:sticky;top:0;z-index:15;background:var(--topbar);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:20px 30px 16px}
  .topbar h1{font-size:22px;font-weight:600;display:flex;align-items:center;gap:10px}
  .topbar p{color:var(--muted);font-size:13.5px;margin-top:3px}
  .filters{display:flex;gap:7px;margin-top:13px;flex-wrap:wrap}
  .chip{border:1px solid var(--line);background:var(--chipbg);color:var(--muted);padding:6px 13px;border-radius:999px;font-size:12.5px;cursor:pointer;transition:.15s;font-weight:500}
  .chip:hover{border-color:#c7ccd1;color:var(--ink)}
  .chip.active{background:var(--chip-active-bg);border-color:var(--chip-active-bg);color:var(--chip-active-fg)}
  .content{padding:24px 30px 60px}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:15px;overflow:hidden;display:flex;flex-direction:column;transition:.18s}
  .card:hover{transform:translateY(-3px);box-shadow:0 12px 30px var(--shadow)}
  .banner{height:112px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
  .banner img{width:100%;height:100%;object-fit:cover}
  .banner .ic{font-size:34px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.14))}
  .banner .tag{position:absolute;top:10px;left:10px;background:var(--tagbg);color:var(--ink);font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px}
  .cardbody{padding:14px 15px 15px;display:flex;flex-direction:column;gap:7px;flex:1}
  .card h3{font-size:15.5px;font-weight:600;line-height:1.35}
  .card p{font-size:13px;color:var(--muted)}
  .metar{margin-top:auto;padding-top:8px;display:flex;align-items:center;justify-content:space-between;font-size:12px}
  .metar .src{color:var(--blue);font-weight:600}
  .metar .dt{color:#9aa2b1}
  .esbadge{align-self:flex-start;font-size:10px;font-weight:700;letter-spacing:.4px;color:var(--purple);background:#a142f416;padding:2px 7px;border-radius:999px;text-transform:uppercase}
  .actions{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:3}
  .abtn{width:28px;height:28px;border-radius:50%;background:var(--tagbg);border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted);box-shadow:0 1px 5px rgba(0,0,0,.18);transition:.15s;padding:0}
  .abtn:hover{color:var(--ink);transform:scale(1.08)}
  .abtn.fav.on{color:#f5a623}
  .abtn.fav.on svg{fill:#f5a623}
  .nuevo{font-size:10px;font-weight:800;letter-spacing:.5px;color:#fff;background:var(--green);padding:3px 9px;border-radius:999px;text-transform:uppercase;box-shadow:0 1px 5px rgba(0,0,0,.25)}
  .vhead{position:absolute;top:8px;left:8px;z-index:3}
  .vage{font-size:12px;color:#9aa2b1;margin-top:4px}
  .favsep{font-size:14px;font-weight:600;color:var(--muted);margin:26px 0 4px;padding-bottom:8px;border-bottom:1px solid var(--line)}

  /* Videos */
  .vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:20px}
  .vcard{background:var(--card);border:1px solid var(--line);border-radius:15px;overflow:hidden;transition:.18s}
  .vcard:hover{box-shadow:0 12px 30px var(--shadow)}
  .vthumb{position:relative;aspect-ratio:16/9;background:#000;cursor:pointer;overflow:hidden}
  .vthumb img{width:100%;height:100%;object-fit:cover;display:block}
  .vthumb .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
  .vthumb .play span{width:56px;height:56px;border-radius:50%;background:rgba(234,67,53,.92);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.35)}
  .vthumb .play span::after{content:"";border-left:18px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:4px}
  .vcard iframe{width:100%;aspect-ratio:16/9;border:0;display:block}
  .vmeta{padding:12px 14px 14px}
  .vmeta h3{font-size:14.5px;font-weight:600;line-height:1.35}
  .vmeta .ch{font-size:12.5px;color:var(--muted);margin-top:5px}

  .empty{text-align:center;color:var(--muted);padding:64px 16px}
  .empty .big{font-size:34px;margin-bottom:10px}

  /* Settings modal */
  .overlay{position:fixed;inset:0;background:rgba(16,24,40,.5);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
  .overlay.open{display:flex}
  .modal{background:var(--card);border-radius:16px;max-width:460px;width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  .modal h2{font-size:18px;margin-bottom:4px}
  .modal p{font-size:13px;color:var(--muted);margin-bottom:14px}
  .modal label{font-size:12.5px;font-weight:600;display:block;margin:12px 0 6px}
  .modal input[type=password],.modal input[type=text]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;font-family:inherit;background:var(--card);color:var(--ink)}
  .row{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:13.5px}
  .btns{display:flex;gap:9px;margin-top:20px}
  .btn{padding:10px 16px;border-radius:9px;border:0;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}
  .btn.primary{background:var(--blue);color:#fff}
  .btn.ghost{background:var(--ghost);color:var(--ink)}
  .hint{font-size:11.5px;color:#9aa2b1;margin-top:10px}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:60;opacity:0;transition:.3s;pointer-events:none}
  .toast.show{opacity:1}

  .mobtog{display:none}
  @media(max-width:860px){
    .app{flex-direction:column}
    .side{width:100%;height:auto;position:sticky;top:0;flex:0 0 auto;z-index:30;flex-direction:row;align-items:center;overflow:hidden}
    .brand{padding:12px 14px}
    .nav{flex-direction:row;overflow-x:auto;padding:8px;gap:4px}
    .nav a .ct{display:none}
    .side .spacer,.side .foot .updated{display:none}
    .side .foot{border:0;padding:8px}
    .content{padding:18px}
    .topbar{padding:16px 18px 12px}
  }
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand"><div class="mk" id="brandMk"></div><div><b>Portal Workspace</b><small>Noticias diarias</small></div></div>
    <nav class="nav" id="nav"></nav>
    <div class="spacer"></div>
    <div class="foot">
      <button class="gearbtn" id="themeToggle"><span class="bi"></span> <span class="bt">Tema oscuro</span></button>
      <button class="gearbtn" id="openSettings" style="margin-top:6px"><span class="bi"></span> <span>Ajustes (IA · Groq)</span></button>
      <div class="updated" id="updated"></div>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <h1 id="secTitle"></h1>
      <p id="secDesc"></p>
      <div class="filters" id="filters"></div>
    </div>
    <div class="content" id="content"></div>
  </div>
</div>

<div class="overlay" id="overlay">
  <div class="modal">
    <h2>Resúmenes en español con IA</h2>
    <p>Pega tu clave de <b>Groq</b>. Se guarda solo en <b>este navegador</b> (localStorage) y nunca se envía a GitHub ni a nadie más. Con ella, las noticias se traducen y resumen al español desde tu equipo.</p>
    <label for="gk">Clave de Groq (empieza con gsk_...)</label>
    <input id="gk" type="password" placeholder="gsk_..." autocomplete="off">
    <div class="row"><input type="checkbox" id="autotr"><label for="autotr" style="margin:0;font-weight:500">Traducir/resumir al español automáticamente</label></div>
    <div class="btns">
      <button class="btn primary" id="saveKey">Guardar</button>
      <button class="btn ghost" id="clearKey">Borrar clave</button>
      <button class="btn ghost" id="closeSettings" style="margin-left:auto">Cerrar</button>
    </div>
    <div class="hint">Consigue una clave gratis en console.groq.com. La traducción ocurre en tu navegador; si tu clave o la red fallan, las noticias se muestran en su idioma original.</div>
    <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
      <button class="btn ghost" id="restoreHidden">Restaurar tarjetas ocultas</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script id="news-data" type="application/json"></script>
<script>
(function(){
  var DATA = /*__DATA__*/null;
  var SECTIONS = [
    {key:'novedades', label:'Novedades', icon:'zap',       desc:'Anuncios directos de las páginas oficiales de Google Workspace.'},
    {key:'noticias',  label:'Noticias',  icon:'newspaper', desc:'Cobertura de otras webs de tecnología sobre Google Workspace.'},
    {key:'videos',    label:'Videos',    icon:'video',     desc:'Videos recientes de YouTube (máximo una semana de antigüedad).'},
    {key:'drive',     label:'Google Drive', icon:'harddrive', desc:'Novedades y noticias específicas de Google Drive.'},
    {key:'unidades',  label:'Unidades compartidas', icon:'users', desc:'Novedades sobre las Unidades compartidas (Shared Drives).'},
    {key:'empresas',  label:'Empresas',  icon:'briefcase', desc:'Empresas y organizaciones que adoptan o usan Google Workspace.'},
    {key:'favoritos', label:'Favoritos', icon:'star',      desc:'Tus artículos y videos guardados. Se guardan en este navegador.'}
  ];
  var SECTION_ICON={novedades:'zap',noticias:'newspaper',videos:'video',drive:'harddrive',unidades:'users',empresas:'briefcase',favoritos:'star'};
  var ICONS={
    newspaper:'<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9h4"/><line x1="18" y1="14" x2="10" y2="14"/><line x1="15" y1="18" x2="10" y2="18"/><path d="M10 6h8v4h-8z"/>',
    zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    video:'<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
    briefcase:'<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    moon:'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    sun:'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    harddrive:'<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
    users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
  };
  function ic(name,size){size=size||20;return '<svg viewBox="0 0 24 24" width="'+size+'" height="'+size+'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">'+(ICONS[name]||'')+'</svg>';}
  document.getElementById('brandMk').innerHTML=ic('newspaper',20);
  document.querySelector('#openSettings .bi').innerHTML=ic('settings',17);
  var LS = {
    get:function(k){try{return localStorage.getItem(k);}catch(e){return null;}},
    set:function(k,v){try{localStorage.setItem(k,v);}catch(e){}},
    del:function(k){try{localStorage.removeItem(k);}catch(e){}}
  };
  // ---- favoritos y ocultos (guardados en el navegador) ----
  var FAVK='wsnews_favs', HIDK='wsnews_hidden';
  function getObj(k){try{return JSON.parse(LS.get(k)||'{}');}catch(e){return {};}}
  function setObj(k,o){LS.set(k,JSON.stringify(o));}
  function favs(){return getObj(FAVK);}
  function hidden(){return getObj(HIDK);}
  function isFav(id){return !!favs()[id];}
  function isHidden(id){return !!hidden()[id];}
  function toggleFav(item){var f=favs();var id=idOf(item);if(f[id])delete f[id];else f[id]=item;setObj(FAVK,f);updateCounts();}
  function hideItem(id){var h=hidden();h[id]=1;setObj(HIDK,h);}
  function unhideAll(){setObj(HIDK,{});}
  function count(key){
    if(key==='favoritos')return Object.keys(favs()).length;
    return (DATA[key]||[]).filter(function(it){return !isHidden(idOf(it));}).length;
  }
  function updateCounts(){document.querySelectorAll('.nav a').forEach(function(a){var c=a.querySelector('.ct');if(c)c.textContent=count(a.dataset.k);});}
  function makeActions(item,mode){
    var wrap=document.createElement('div');wrap.className='actions';
    var id=idOf(item);
    var fav=document.createElement('button');fav.className='abtn fav'+((mode==='fav'||isFav(id))?' on':'');
    fav.title=(mode==='fav'?'Quitar de favoritos':'Guardar en favoritos');fav.innerHTML=ic('star',15);
    fav.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();
      toggleFav(item);
      if(mode==='fav'){drawFavs();}else{fav.classList.toggle('on');}
    });
    wrap.appendChild(fav);
    if(mode!=='fav'){
      var hb=document.createElement('button');hb.className='abtn';hb.title='Ocultar esta tarjeta';hb.innerHTML=ic('x',15);
      hb.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();hideItem(id);draw();updateCounts();});
      wrap.appendChild(hb);
    }
    return wrap;
  }
  var state={sec:'novedades',range:'all'};
  var content=document.getElementById('content');
  var nav=document.getElementById('nav');

  // ---- nav ----
  SECTIONS.forEach(function(s){
    var a=document.createElement('a');a.dataset.k=s.key;
    var n=count(s.key);
    a.innerHTML='<span class="ic">'+ic(s.icon,19)+'</span><span>'+s.label+'</span><span class="ct">'+n+'</span>';
    a.addEventListener('click',function(){go(s.key);});
    nav.appendChild(a);
  });
  var up=DATA.updatedISO?new Date(DATA.updatedISO):null;
  document.getElementById('updated').textContent = up ? ('Actualizado: '+up.toLocaleDateString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})) : '';

  function parse(d){var p=(d||'').split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
  function fmtDate(d){if(!d)return '';return parse(d).toLocaleDateString('es-MX',{day:'numeric',month:'short'});}
  function inRange(date){
    if(state.range==='all'||!date)return true;
    var diff=Math.round((new Date()-parse(date))/86400000);
    if(state.range==='today')return diff<=1;
    if(state.range==='week')return diff<7;
    return true;
  }
  function esc(s){return (s||'');}

  function go(key){
    state.sec=key;state.range='all';
    var s=SECTIONS.find(function(x){return x.key===key;});
    document.querySelectorAll('.nav a').forEach(function(a){a.classList.toggle('active',a.dataset.k===key);});
    document.getElementById('secTitle').innerHTML='<span style="display:inline-flex">'+ic(s.icon,22)+'</span> '+s.label;
    document.getElementById('secDesc').textContent=s.desc;
    var f=document.getElementById('filters');
    if(key==='videos'||key==='favoritos'){f.innerHTML='';}
    else{
      f.innerHTML='';
      [['all','Todo'],['week','Esta semana'],['today','Hoy']].forEach(function(r){
        var b=document.createElement('button');b.className='chip'+(r[0]==='all'?' active':'');b.textContent=r[1];
        b.addEventListener('click',function(){state.range=r[0];document.querySelectorAll('.filters .chip').forEach(function(c){c.classList.remove('active');});b.classList.add('active');draw();});
        f.appendChild(b);
      });
    }
    draw();
  }

  function draw(){
    var key=state.sec;
    if(key==='videos')return drawVideos();
    if(key==='favoritos')return drawFavs();
    var items=(DATA[key]||[]).filter(function(it){return inRange(it.date)&&!isHidden(idOf(it));});
    content.innerHTML='';
    if(!items.length){content.innerHTML=emptyBox('Aún no hay elementos en esta sección. Se llenará en la próxima actualización diaria.');return;}
    var g=document.createElement('div');g.className='grid';
    items.forEach(function(it){g.appendChild(newsCard(it));});
    content.appendChild(g);
    maybeTranslate(items);
  }

  function newsCard(it,mode){
    var a=document.createElement('a');a.className='card';a.href=it.url;a.target='_blank';a.rel='noopener';a.dataset.id=idOf(it);
    var banner=document.createElement('div');banner.className='banner';
    banner.style.background='linear-gradient(135deg,'+(it.accent||'#1a73e8')+'22,'+(it.accent||'#1a73e8')+'55)';
    var tg=document.createElement('span');tg.className='tag';tg.textContent=it.source||'';banner.appendChild(tg);
    banner.appendChild(makeActions(it,mode));
    function addIcon(){var s=document.createElement('span');s.className='ic';s.style.color=(it.accent||'#1a73e8');s.innerHTML=ic(SECTION_ICON[it.section]||'newspaper',38);banner.appendChild(s);}
    if(it.image){var img=document.createElement('img');img.loading='lazy';img.src=it.image;img.onerror=function(){img.remove();addIcon();};banner.appendChild(img);}else{addIcon();}
    var body=document.createElement('div');body.className='cardbody';
    var badge=document.createElement('span');badge.className='esbadge';badge.style.display='none';badge.textContent='ES · IA';
    var h3=document.createElement('h3');h3.textContent=it.title;
    var p=document.createElement('p');p.textContent=it.summary||'';
    var meta=document.createElement('div');meta.className='metar';
    var src=document.createElement('span');src.className='src';src.textContent=(it.source||'Fuente')+' ↗';
    var dt=document.createElement('span');dt.className='dt';dt.textContent=fmtDate(it.date);
    meta.appendChild(src);meta.appendChild(dt);
    body.appendChild(badge);body.appendChild(h3);body.appendChild(p);body.appendChild(meta);
    a.appendChild(banner);a.appendChild(body);
    a._h3=h3;a._p=p;a._badge=badge;
    return a;
  }

  function agoText(v){
    if(v.publishedDate){var d=Math.max(0,Math.floor((Date.now()-new Date(v.publishedDate+'T00:00:00').getTime())/86400000));
      return d===0?'publicado hoy':(d===1?'hace 1 día':'hace '+d+' días');}
    return v.when||'';
  }
  function videoCard(v,mode,isNew){
    var c=document.createElement('div');c.className='vcard';
    var th=document.createElement('div');th.className='vthumb';
    var img=document.createElement('img');img.loading='lazy';img.src='https://img.youtube.com/vi/'+v.videoId+'/hqdefault.jpg';
    var play=document.createElement('div');play.className='play';play.innerHTML='<span></span>';
    th.appendChild(img);th.appendChild(play);
    if(isNew){var nb=document.createElement('span');nb.className='vhead nuevo';nb.textContent='Nuevo';th.appendChild(nb);}
    th.appendChild(makeActions(v,mode));
    th.addEventListener('click',function(e){
      if(e.target.closest('.actions'))return;
      var f=document.createElement('iframe');
      f.src='https://www.youtube.com/embed/'+v.videoId+'?autoplay=1&rel=0';
      f.allow='accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture';
      f.allowFullscreen=true;
      c.replaceChild(f,th);
    });
    var m=document.createElement('div');m.className='vmeta';
    var h=document.createElement('h3');h.textContent=v.title;
    var ch=document.createElement('div');ch.className='ch';ch.textContent=(v.channel||'');
    var ag=document.createElement('div');ag.className='vage';ag.textContent=agoText(v);
    m.appendChild(h);m.appendChild(ch);m.appendChild(ag);
    c.appendChild(th);c.appendChild(m);
    return c;
  }
  function drawVideos(){
    var vids=(DATA.videos||[]).filter(function(v){return !isHidden(idOf(v));});
    content.innerHTML='';
    if(!vids.length){content.innerHTML=emptyBox('Los videos se cargan automáticamente en la próxima ejecución del workflow (búsqueda en YouTube, máximo una semana de antigüedad).');return;}
    var maxFirst=vids.reduce(function(a,v){return (v.firstSeen&&v.firstSeen>a)?v.firstSeen:a;},'');
    var g=document.createElement('div');g.className='vgrid';
    vids.forEach(function(v){g.appendChild(videoCard(v,null,v.firstSeen===maxFirst));});
    content.appendChild(g);
  }
  function drawFavs(){
    var f=favs();var ids=Object.keys(f);
    content.innerHTML='';
    if(!ids.length){content.innerHTML=emptyBox('Aún no tienes favoritos. Toca la estrella en cualquier artículo o video para guardarlo aquí.');return;}
    var articles=[],videos=[];
    ids.forEach(function(id){var it=f[id];if(it.videoId)videos.push(it);else articles.push(it);});
    if(articles.length){var g=document.createElement('div');g.className='grid';articles.forEach(function(it){g.appendChild(newsCard(it,'fav'));});content.appendChild(g);}
    if(videos.length){var sep=document.createElement('div');sep.className='favsep';sep.textContent='Videos guardados';content.appendChild(sep);var vg=document.createElement('div');vg.className='vgrid';videos.forEach(function(v){vg.appendChild(videoCard(v,'fav',false));});content.appendChild(vg);}
  }

  function emptyBox(msg){return '<div class="empty"><div class="big">'+ic('newspaper',40)+'</div>'+msg+'</div>';}
  function idOf(it){if(it&&it.videoId)return 'v'+it.videoId;var s=(it.url||'')+'|'+(it.title||'');var h=0;for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;}return 'i'+h;}

  // ---- Groq (traducción en el navegador) ----
  var GKEY='wsnews_groq_key', GAUTO='wsnews_groq_auto', GCACHE='wsnews_tr_';
  function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2600);}
  function getKey(){return LS.get(GKEY)||'';}
  function autoOn(){return LS.get(GAUTO)==='1';}

  function applyCached(cardEls){
    cardEls.forEach(function(a){
      var c=LS.get(GCACHE+a.dataset.id);
      if(c){try{var o=JSON.parse(c);if(o.title)a._h3.textContent=o.title;if(o.summary)a._p.textContent=o.summary;a._badge.style.display='';}catch(e){}}
    });
  }

  function maybeTranslate(items){
    var cards=[].slice.call(content.querySelectorAll('.card'));
    applyCached(cards);
    if(!autoOn()||!getKey())return;
    var pending=cards.filter(function(a){return a._badge.style.display==='none';});
    if(!pending.length)return;
    translateBatch(pending.slice(0,10));
  }

  function translateBatch(cards){
    var payload=cards.map(function(a,i){return {i:i,title:a._h3.textContent,summary:a._p.textContent};});
    var prompt='Traduce y resume al español de México. Devuelve SOLO un array JSON con objetos {"i":n,"title":"titular en español (máx 100 car.)","summary":"resumen en 1-2 frases en español"}. No inventes datos.\n\n'+JSON.stringify(payload);
    fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':'Bearer '+getKey()},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',temperature:0.2,max_tokens:1800,messages:[{role:'user',content:prompt}]})
    }).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(j){
      var txt=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'';
      var m=txt.match(/\[[\s\S]*\]/);if(!m)return;
      var arr=JSON.parse(m[0]);
      arr.forEach(function(o){var a=cards[o.i];if(!a)return;
        if(o.title)a._h3.textContent=o.title;if(o.summary)a._p.textContent=o.summary;a._badge.style.display='';
        LS.set(GCACHE+a.dataset.id,JSON.stringify({title:a._h3.textContent,summary:a._p.textContent}));
      });
    }).catch(function(e){toast('No se pudo traducir con Groq ('+e.message+').');});
  }

  // ---- settings modal ----
  var ov=document.getElementById('overlay');
  document.getElementById('openSettings').addEventListener('click',function(){
    document.getElementById('gk').value=getKey();
    document.getElementById('autotr').checked=autoOn();
    ov.classList.add('open');
  });
  document.getElementById('closeSettings').addEventListener('click',function(){ov.classList.remove('open');});
  ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('open');});
  document.getElementById('saveKey').addEventListener('click',function(){
    var k=document.getElementById('gk').value.trim();
    if(k)LS.set(GKEY,k);else LS.del(GKEY);
    LS.set(GAUTO,document.getElementById('autotr').checked?'1':'0');
    ov.classList.remove('open');
    toast(k?'Clave guardada en este navegador.':'Clave borrada.');
    draw();
  });
  document.getElementById('clearKey').addEventListener('click',function(){
    LS.del(GKEY);document.getElementById('gk').value='';toast('Clave borrada.');
  });
  document.getElementById('restoreHidden').addEventListener('click',function(){
    unhideAll();ov.classList.remove('open');updateCounts();draw();toast('Se restauraron las tarjetas ocultas.');
  });

  // ---- tema claro / oscuro ----
  var THKEY='wsnews_theme';
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme',t);
    var b=document.getElementById('themeToggle');
    b.querySelector('.bi').innerHTML=ic(t==='dark'?'sun':'moon',17);
    b.querySelector('.bt').textContent=(t==='dark'?'Tema claro':'Tema oscuro');
  }
  var savedT=LS.get(THKEY)||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');
  applyTheme(savedT);
  document.getElementById('themeToggle').addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    LS.set(THKEY,cur);applyTheme(cur);
  });

  go('novedades');
})();
</script>
</body>
</html>`;

main().catch(e => { console.error(e); process.exit(1); });
