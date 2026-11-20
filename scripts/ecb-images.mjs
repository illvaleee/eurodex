// Abbina ogni moneta del catalogo a un'immagine ufficiale della Banca centrale europea
// (lati nazionali e 2 euro commemorativi) e della Commissione europea (lati comuni),
// le scarica una volta sola e le mette dentro l'app (www/data/img). Nessuna foto da Numista.
//
// Richiede le pagine BCE già scaricate da scripts/fetch-ecb.mjs.
// MATCH_ONLY=1: fa solo l'abbinamento e stampa il resoconto (niente download).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ritaglia } from './ritaglio.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = path.join(ROOT, 'scripts', 'ecb-cache', 'pages');
const RAW = path.join(ROOT, 'scripts', 'ecb-cache', 'img');
const OUT = path.join(ROOT, 'www', 'data');
const IMG = path.join(OUT, 'img');
const UA = 'CollezioneEuro/1.0 (app privata, uso personale)';
const MATCH_ONLY = process.env.MATCH_ONLY === '1';
const ECB = 'https://www.ecb.europa.eu';

const NAMES = {
  andorra: 'AD',
  austria: 'AT',
  belgium: 'BE',
  bulgaria: 'BG',
  croatia: 'HR',
  cyprus: 'CY',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  greece: 'GR',
  ireland: 'IE',
  italy: 'IT',
  latvia: 'LV',
  lithuania: 'LT',
  luxembourg: 'LU',
  malta: 'MT',
  monaco: 'MC',
  netherlands: 'NL',
  portugal: 'PT',
  sanmarino: 'SM',
  nederland: 'NL',
  slovakia: 'SK',
  slovenia: 'SI',
  spain: 'ES',
  vaticancity: 'VA',
  vatican: 'VA',
  va: 'VA',
};
const norm = s =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
function ccFromText(s) {
  const n = norm(s);
  if (NAMES[n]) return NAMES[n];
  for (const [k, v] of Object.entries(NAMES)) if (k.length > 3 && n.includes(k)) return v;
  return null;
}
function ccFromFile(src) {
  const f = src
    .split('/')
    .pop()
    .replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')
    .replace(/^(joint_)?comm_\d{4}_?/i, '');
  const parts = f.split(/[_\-\s]+/);
  for (let i = parts.length; i > 0; i--) {
    const c = ccFromText(parts.slice(0, i).join(''));
    if (c) return c;
  }
  return ccFromText(parts[0]);
}
const strip = h =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

function boxes(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .split(/<div class="box(?: [^"]*)?"[^>]*>/)
    .slice(1)
    .map(seg => {
      const imgs = [...seg.matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map(m => m[1])
        .filter(s => /\/euro\/coins\/|comm_\d{4}\//.test(s) && !/coin_bg|placeholder/i.test(s));
      const h3 = strip((seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
      const feature = strip(
        (seg.match(/Feature\s*:?\s*<\/strong>\s*:?([\s\S]*?)<\/p>/i) ||
          seg.match(/Feature\s*:([\s\S]*?)<\/p>/i) ||
          [])[1] || '',
      ).replace(/^[\s:;,.–-]+/, '');
      return { imgs, h3, feature, text: strip(seg).slice(0, 600) };
    })
    .filter(b => b.imgs.length);
}

/* ---------- lati nazionali delle monete normali ---------- */
const PAGE_DENOM = {
  '1cent': '1c',
  '2cents': '2c',
  '5cents': '5c',
  '10cents': '10c',
  '20cents': '20c',
  '50cents': '50c',
  '1euro': '1e',
  '2euro': '2e',
};
// la carta d'Europa sta sul lato comune: le serie che differiscono solo per la carta hanno lo stesso lato nazionale.
// Il ritratto invece sta sul lato nazionale: ritratti diversi = monete diverse, non si uniscono
const DESCR = /\b(1st|2nd|3rd|4th)\s+map\b|\bmap\b|\bcarta\b/gi;
const designKey = s =>
  (
    String(s || '')
      .toLowerCase()
      .match(/\b(1st|2nd|3rd|4th)\s+(type|portrait)\b/g) || []
  )
    .sort()
    .join(' ');
const baseOf = s =>
  String(s || '')
    .replace(DESCR, '')
    .replace(/[;,·\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const rulerOf = s =>
  String(s || '')
    .split('·')[0]
    .trim()
    .toLowerCase();

function seriesOf(types) {
  const sorted = [...types].sort((a, b) => a.y[0] - b.y[0] || a.y[1] - b.y[1]);
  const out = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && last.base === baseOf(t.s) && last.raw !== t.s) {
      last.types.push(t);
      last.to = Math.max(last.to, t.y[1]);
      last.raw = t.s;
    } else
      out.push({
        base: baseOf(t.s),
        raw: t.s,
        ruler: rulerOf(t.s),
        from: t.y[0],
        to: t.y[1],
        types: [t],
        vac: /vacant/i.test(t.s + ' ' + t.t),
      });
  }
  return out;
}
let FOTO_ANNI = {};
try {
  FOTO_ANNI = JSON.parse(
    await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'foto-anni.json'), 'utf8'),
  );
} catch {}
function cost(img, s) {
  const sv = /vacant/i.test(img);
  if (sv || s.vac) return sv && s.vac ? 0 : Infinity;
  const file = img.split('/').pop();
  const y = +((file.match(/(19|20)\d{2}/) || [])[0] || FOTO_ANNI[file] || 0);
  if (!y) return 1 - Math.min(s.to - s.from + 1, 40) / 50;
  // dentro gli anni della serie: si preferisce l'immagine più vicina al primo anno (la moneta come è nata;
  // es. Monaco 1 cent 2006–2025 prende la foto del 2006, non quella del 2025)
  const d = y >= s.from && y <= s.to ? 0.01 * (y - s.from) : Math.min(Math.abs(y - s.from), Math.abs(y - s.to));
  return d > 6 ? Infinity : d;
}
function align(imgs, series) {
  const n = imgs.length,
    m = series.length,
    SKIP_I = 5,
    SKIP_S = 1.2;
  const D = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity)),
    B = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  D[0][0] = 0;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (D[i][j] === Infinity) continue;
      if (i < n && j < m) {
        const c = cost(imgs[i], series[j]);
        if (D[i][j] + c < D[i + 1][j + 1]) {
          D[i + 1][j + 1] = D[i][j] + c;
          B[i + 1][j + 1] = 'm';
        }
      }
      if (i < n && D[i][j] + SKIP_I < D[i + 1][j]) {
        D[i + 1][j] = D[i][j] + SKIP_I;
        B[i + 1][j] = 'i';
      }
      if (j < m && D[i][j] + SKIP_S < D[i][j + 1]) {
        D[i][j + 1] = D[i][j] + SKIP_S;
        B[i][j + 1] = 's';
      }
    }
  const pairs = new Map();
  let i = n,
    j = m;
  while (i > 0 || j > 0) {
    const b = B[i][j];
    if (b === 'm') {
      pairs.set(j - 1, i - 1);
      i--;
      j--;
    } else if (b === 'i') i--;
    else j--;
  }
  return pairs;
}

/* ---------- 2 euro commemorativi ---------- */
// le "Sede vacante" del Vaticano successive al 2005 la BCE le elenca tra i commemorativi
const lateVacante = t => t.cc === 'VA' && t.d === '2e' && /vacant/i.test(`${t.t} ${t.s}`) && t.y[0] > 2005;
const VARIANT_ALL = /colou?red|hologram|blue flag|coin ?card/i;
const url = src =>
  /^https?:/.test(src) ? src : src.startsWith('/') ? ECB + src : `${ECB}/euro/coins/comm/html/${src}`;
const STOP = new Set(
  'the of and for in on to a an anniversary years year th st nd rd di del della dei degli anni anniversario la il le lo e coin euro coins series serie'.split(
    ' ',
  ),
);
const words = s =>
  new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(w => w.replace(/(ing|es|s)$/, '')),
  );
function sim(a, b) {
  const A = words(a),
    B = words(b);
  if (!A.size || !B.size) return 0;
  let k = 0;
  for (const w of A) if (B.has(w)) k++;
  return k / Math.min(A.size, B.size);
}

async function main() {
  const cat = JSON.parse(await fs.readFile(path.join(OUT, 'catalog.json'), 'utf8'));
  const files = await fs.readdir(PAGES);
  const assign = new Map(); // typeId -> url
  const report = { circ: 0, circTot: 0, com: 0, comTot: 0, missing: [] };

  // normali
  for (const [page, d] of Object.entries(PAGE_DENOM)) {
    if (!files.includes(page + '.html')) {
      console.log(`manca la pagina ${page}`);
      continue;
    }
    const html = await fs.readFile(path.join(PAGES, page + '.html'), 'utf8');
    for (const b of boxes(html)) {
      const cc = ccFromText(b.h3) || ccFromFile(b.imgs[0]);
      if (!cc) {
        console.log(`  paese non riconosciuto: ${b.h3} ${b.imgs[0]}`);
        continue;
      }
      const types = cat.types.filter(t => t.cc === cc && t.d === d && !t.c && !t.k && !lateVacante(t));
      const series = seriesOf(types);
      const pairs = align(b.imgs, series);
      series.forEach((s, j) => {
        if (pairs.has(j)) {
          s.img = b.imgs[pairs.get(j)];
          s.types.forEach(t => assign.set(t.id, ECB + s.img));
        }
      });
      // le serie senza immagine prendono quella della serie più vicina con lo stesso sovrano
      series.forEach(s => {
        if (s.img || !s.ruler) return;
        // solo se il disegno del lato nazionale è lo stesso (stesso tipo e stesso ritratto, cambia solo la carta
        // o è un'edizione speciale/errore di conio dello stesso disegno); altrimenti meglio nessuna foto che una sbagliata
        const near = series
          .filter(o => o.img && o.ruler === s.ruler && designKey(o.raw) === designKey(s.raw))
          .sort((a, b2) => Math.abs(a.from - s.from) - Math.abs(b2.from - s.from))[0];
        if (near) s.types.forEach(t => assign.set(t.id, ECB + near.img));
      });
    }
  }

  // Testi italiani dei commemorativi, riquadro per riquadro. Le pagine BCE italiane e inglesi hanno gli stessi
  // riquadri nello stesso ordine, ma a volte la pagina italiana usa il file d'immagine sbagliato (es. 2025:
  // Portogallo) o le manca qualche riquadro: per questo si allineano per sequenza, non per nome del file.
  const fixSup = h =>
    h
      .replace(/&nbsp;/g, ' ')
      .replace(/<sup>\s*(o|°|º|a)\s*<\/sup>/gi, (_, x) => (x === 'a' ? 'ª' : '°'))
      .replace(/<sup>\s*(st|nd|rd|th)\s*<\/sup>/gi, '$1');
  const fieldOf = (seg, re) =>
    strip((seg.match(re) || [])[1] || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:;,.–-]+/, '')
      .replace(/[.\s]+$/, '')
      .trim();
  function itBoxes(html) {
    return fixSup(html)
      .split(/<div class="box(?: [^"]*)?"[^>]*>/)
      .slice(1)
      .map(seg => {
        const imgs = [...seg.matchAll(/<img[^>]+src="([^"]+)"/g)]
          .map(m => m[1])
          .filter(x => /\/euro\/coins\/|comm_\d{4}\//.test(x) && !/coin_bg|placeholder/i.test(x));
        return {
          imgs,
          eff: fieldOf(seg, /Effigie\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
          des: fieldOf(seg, /Descrizione\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
          tir: fieldOf(seg, /(?:Tiratura|Volume di emissione)\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
          data: fieldOf(seg, /Data di emissione\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
        };
      })
      .filter(b => b.imgs.length);
  }
  // allineamento: prima i riquadri con la stessa immagine nello stesso ordine (sottosequenza comune più lunga),
  // poi, tra due riquadri allineati, quelli rimasti in numero uguale da entrambe le parti, uno a uno
  function alignBoxes(en, it) {
    const a = en.map(b => b.imgs[0]),
      b = it.map(x => x.imgs[0]),
      n = a.length,
      m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const pairs = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        pairs.push([i, j]);
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    const out = new Map(pairs.map(([x, y]) => [x, it[y]]));
    const anchors = [[-1, -1], ...pairs, [n, m]];
    for (let k = 0; k < anchors.length - 1; k++) {
      const [i0, j0] = anchors[k],
        [i1, j1] = anchors[k + 1];
      if (i1 - i0 === j1 - j0) for (let d = 1; d < i1 - i0; d++) out.set(i0 + d, it[j0 + d]);
    }
    return out;
  }
  // immagini BCE usate per più monete diverse nella stessa pagina (errore della pagina): la foto va solo alla moneta
  // che vi compare davvero, verificata guardando la foto (scripts/foto-verificate.json); alle altre nessuna foto
  let FOTO_VERIF = {};
  try {
    FOTO_VERIF = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'foto-verificate.json'), 'utf8'));
  } catch {}
  const itText = e => (e.it ? `${e.it.eff} ${e.it.eff} ${e.it.des}` : '');
  const numIt = async id => {
    try {
      const q = `/types/${id}?lang=it`;
      const c = JSON.parse(
        await fs.readFile(
          path.join(ROOT, 'scripts', 'cache', crypto.createHash('sha1').update(q).digest('hex').slice(0, 20) + '.json'),
          'utf8',
        ),
      ).data;
      return [c.commemorated_topic, c.commemorated_topic, c.obverse && c.obverse.description].filter(Boolean).join(' ');
    } catch {
      return '';
    }
  };
  const kwords = s =>
    new Set(
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 4)
        .map(w => w.slice(0, 7)),
    );

  // commemorativi
  const allEntries = [];
  const comEntry = new Map(); // moneta -> riquadro BCE (testi); la foto solo se sicura
  const setCom = (t, e) => {
    comEntry.set(t.id, e);
    if (e.photo) assign.set(t.id, url(e.photo));
    else assign.delete(t.id);
  };
  // versioni colorate/ologramma/coin card: la fonte ufficiale non le ha, restano fuori
  const VARIANT = /colou?red|hologram|blue flag|coin ?card|coloured/i;
  const com = cat.types.filter(t => (t.c || lateVacante(t)) && !t.k && !VARIANT.test(t.t));
  for (const f of files.filter(f => /^comm_\d{4}\.html$/.test(f))) {
    const y = +f.slice(5, 9);
    const html = fixSup(await fs.readFile(path.join(PAGES, f), 'utf8'));
    const enB = boxes(html);
    let itMap = new Map();
    try {
      itMap = alignBoxes(enB, itBoxes(await fs.readFile(path.join(PAGES, f.replace('.html', '.it.html')), 'utf8')));
    } catch {}
    const srcCount = new Map();
    enB.forEach(b => b.imgs.forEach(src => srcCount.set(src, (srcCount.get(src) || 0) + 1)));
    const photoOf = (src, feature) => {
      if ((srcCount.get(src) || 0) < 2) return src;
      const v = FOTO_VERIF[src];
      return v && feature.toLowerCase().includes(String(v).toLowerCase()) ? src : null;
    };
    const entries = [];
    for (const [bi, b] of enB.entries()) {
      const feature = b.feature || b.text;
      const base = { feature, it: itMap.get(bi) || null, key: `${y}:${bi}` };
      if (b.imgs.length === 1)
        entries.push({
          ...base,
          cc: ccFromText(b.h3) || ccFromFile(b.imgs[0]),
          src: b.imgs[0],
          photo: photoOf(b.imgs[0], feature),
        });
      else {
        const js = b.imgs.map(src => ({
          ...base,
          key: `${y}:${bi}:${src}`,
          cc: ccFromFile(src),
          src,
          photo: photoOf(src, feature),
        }));
        const unknown = js.filter(e => !e.cc);
        if (unknown.length === 1) {
          // immagine senza nome del paese in una emissione congiunta: è il paese che manca dall'elenco
          const present = new Set(js.map(e => e.cc).filter(Boolean));
          const cands = [
            ...new Set(com.filter(t => t.y[0] === y && !present.has(t.cc) && sim(t.t, feature) >= 0.3).map(t => t.cc)),
          ];
          if (cands.length === 1) unknown[0].cc = cands[0];
        }
        entries.push(...js);
      }
    }
    entries.forEach(e => allEntries.push({ ...e, y }));
    const byCc = new Map();
    for (const e of entries) {
      if (!e.cc) continue;
      if (!byCc.has(e.cc)) byCc.set(e.cc, []);
      byCc.get(e.cc).push(e);
    }
    for (const [cc, es] of byCc) {
      const ts = com.filter(t => t.cc === cc && t.y[0] === y);
      const pairs = [];
      ts.forEach(t =>
        es.forEach((e, k) => pairs.push({ t, k, s: Math.max(sim(t.t, e.feature), sim(t.s, e.feature)) })),
      );
      // più monete e più immagini: aggiungo il confronto delle parole distintive dei testi italiani
      // (pesate: le parole presenti in quasi tutte le schede dell'anno contano poco)
      if (ts.length > 1 && es.length > 1) {
        const yearTexts = entries.map(e => kwords(itText(e)));
        const df = new Map();
        for (const set of yearTexts) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
        const idf = w => Math.log((yearTexts.length + 1) / ((df.get(w) || 0) + 0.5));
        const nt = new Map();
        for (const t of ts) nt.set(t.id, kwords(await numIt(t.id)));
        let mx = 0;
        for (const p of pairs) {
          const A = nt.get(p.t.id),
            B = kwords(itText(es[p.k]));
          let k = 0;
          for (const w of A) if (B.has(w)) k += Math.max(0, idf(w));
          p.kw = k;
          if (k > mx) mx = k;
        }
        if (mx > 0) for (const p of pairs) p.s += (0.6 * p.kw) / mx;
      }
      if (process.env.DEBUG === `${cc}:${y}`) {
        console.log(
          'ECB',
          es.map(e => [e.src, e.feature.slice(0, 80)]),
        );
        console.log(
          'NUM',
          ts.map(t => t.t),
        );
        console.log(pairs.map(p => [p.t.t, p.k, p.s.toFixed(2)]));
      }
      pairs.sort((a, b) => b.s - a.s);
      const usedT = new Set(),
        usedE = new Set();
      for (const p of pairs) {
        if (usedT.has(p.t.id) || usedE.has(p.k)) continue;
        if (p.s < 0.15 && !(ts.length === 1 && es.length === 1)) continue;
        usedT.add(p.t.id);
        usedE.add(p.k);
        setCom(p.t, es[p.k]);
      }
      // seconda passata: se restano tante monete quante immagini, abbina comunque le più simili
      const restT = ts.filter(t => !usedT.has(t.id)),
        restIdx = es.map((_, k) => k).filter(k => !usedE.has(k));
      if (restT.length && restT.length === restIdx.length) {
        for (const p of pairs) {
          if (usedT.has(p.t.id) || usedE.has(p.k)) continue;
          usedT.add(p.t.id);
          usedE.add(p.k);
          setCom(p.t, es[p.k]);
        }
      }
    }
  }

  // anno diverso di un anno tra Numista e BCE: abbina solo se il tema è chiaramente lo stesso
  const usedKey = new Set([...comEntry.values()].map(e => e.key));
  for (const t of com) {
    if (comEntry.has(t.id)) continue;
    const best = allEntries
      .filter(e => e.cc === t.cc && Math.abs(e.y - t.y[0]) === 1 && !usedKey.has(e.key))
      .map(e => ({ e, s: Math.max(sim(t.t, e.feature), sim(t.s, e.feature)) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.5) {
      setCom(t, best.e);
      usedKey.add(best.e.key);
    }
  }
  // varianti dello stesso commemorativo (stesso paese e anno, stesso tema): stessa immagine
  for (const t of com) {
    if (comEntry.has(t.id)) continue;
    const twin =
      !VARIANT.test(t.t) &&
      com.find(
        o =>
          o !== t && comEntry.has(o.id) && o.cc === t.cc && o.y[0] === t.y[0] && (o.s === t.s || sim(o.t, t.t) >= 0.8),
      );
    if (twin) setCom(t, comEntry.get(twin.id));
  }
  for (const t of cat.types) {
    if (t.k) continue;
    if (t.c || lateVacante(t)) {
      report.comTot++;
      if (assign.has(t.id)) report.com++;
      else report.missing.push(`${t.cc} ${t.y[0]} ${t.t}${comEntry.has(t.id) ? ' (testi BCE sì, foto no)' : ''}`);
    } else {
      report.circTot++;
      if (assign.has(t.id)) report.circ++;
      else report.missing.push(`${t.cc} ${t.d} ${t.y[0]}-${t.y[1]} ${t.s}`);
    }
  }
  if (process.env.DUMP) await fs.writeFile(process.env.DUMP, JSON.stringify(Object.fromEntries(assign)));
  if (process.env.DUMP)
    await fs.writeFile(
      process.env.DUMP + '.testi.json',
      JSON.stringify(Object.fromEntries([...comEntry].map(([k, e]) => [k, e.key + ' ' + (e.it ? e.it.eff : '-')]))),
    );
  // immagini BCE che non sono finite su nessuna moneta: possibili monete mancanti dal catalogo
  {
    const usedAll = new Set([...assign.values()]);
    const usedKeys = new Set([...comEntry.values()].map(e => e.key));
    const unusedCom = allEntries.filter(e => !usedKeys.has(e.key));
    console.log(`\nImmagini BCE di commemorativi non usate: ${unusedCom.length}`);
    unusedCom.forEach(e => console.log(`  ${e.y} ${e.cc || '??'} ${e.feature.slice(0, 90)} [${e.src}]`));
    const natUnused = [];
    for (const page of Object.keys(PAGE_DENOM)) {
      if (!files.includes(page + '.html')) continue;
      const html = await fs.readFile(path.join(PAGES, page + '.html'), 'utf8');
      for (const b of boxes(html))
        for (const src of b.imgs) if (!usedAll.has(ECB + src)) natUnused.push(`${page} ${b.h3} [${src}]`);
    }
    console.log(`Immagini BCE di lati nazionali non usate: ${natUnused.length}`);
    natUnused.forEach(x => console.log('  ' + x));
  }
  console.log(`\nAbbinate: normali ${report.circ}/${report.circTot}, commemorative ${report.com}/${report.comTot}`);
  console.log('Senza immagine (prime 80):\n  ' + report.missing.slice(0, +(process.env.SHOW || 80)).join('\n  '));
  if (MATCH_ONLY) return;

  // lati comuni (Commissione europea)
  const CS = 'https://economy-finance.ec.europa.eu/sites/default/files/2017-01/';
  const commonName = {
    '1c': 'cent1',
    '2c': 'cent2',
    '5c': 'cent5',
    '10c': 'cent10',
    '20c': 'cent20',
    '50c': 'cent50',
    '1e': 'euro1',
    '2e': 'euro2',
  };
  const commissionCommon = (d, old) =>
    `${CS}common_side_${commonName[d]}${old || ['1c', '2c', '5c'].includes(d) ? '' : '-newdesign'}.png`;
  // lati comuni dalla pagina BCE (immagini più grandi di quelle della Commissione)
  const ecbCommon = {};
  try {
    const html = await fs.readFile(path.join(PAGES, 'common.html'), 'utf8');
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)]
      .map(m => m[1])
      .filter(x => /\/euro\/coins\//.test(x) && !/coin_bg|logo/i.test(x));
    console.log('Lati comuni sulla pagina BCE:', srcs.join(' | '));
    const DTOK = {
      '1c': /(^|[^0-9])1[_ -]?(cent|c\b|ct)/i,
      '2c': /(^|[^0-9])2[_ -]?(cent|c\b|ct)/i,
      '5c': /(^|[^0-9])5[_ -]?(cent|c\b|ct)/i,
      '10c': /10[_ -]?(cent|c\b|ct)|^(new)?10common/i,
      '20c': /20[_ -]?(cent|c\b|ct)/i,
      '50c': /50[_ -]?(cent|c\b|ct)/i,
      '1e': /(^|[^0-9])1[_ -]?(euro|e\b|eur)/i,
      '2e': /(^|[^0-9])2[_ -]?(euro|e\b|eur)/i,
    };
    for (const src of srcs) {
      const f = src.split('/').pop();
      const d = Object.keys(DTOK).find(k => DTOK[k].test(f));
      if (!d) continue;
      // BCE: "common_..." = disegno originale, "newcommon_..." = nuova carta (dal 2007)
      const key = `${d}|${/^new/i.test(f) ? 'new' : 'old'}`;
      (ecbCommon[key] = ecbCommon[key] || []).push(
        ECB + (src.startsWith('/') ? src : '/euro/coins/common/html/' + src),
      );
    }
    console.log('Abbinati:', JSON.stringify(ecbCommon));
  } catch (e) {
    console.log('Pagina lati comuni BCE non disponibile:', e.message);
  }
  const commonUrl = (d, old) => {
    const pick = old
      ? ecbCommon[`${d}|old`]
      : ecbCommon[`${d}|new`] || (['1c', '2c', '5c'].includes(d) ? ecbCommon[`${d}|old`] : null);
    return (pick && pick[0]) || commissionCommon(d, old);
  };

  await fs.mkdir(RAW, { recursive: true });
  await fs.mkdir(IMG, { recursive: true });
  const sharp = (await import('sharp')).default;
  const done = new Map();
  let fails = 0;
  const small = [];
  async function local(url, denom) {
    if (done.has(url)) return done.get(url);
    const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 14);
    const raw = path.join(RAW, h + path.extname(new URL(url).pathname).toLowerCase());
    const out = `img/${h}.webp`;
    try {
      try {
        await fs.access(raw);
      } catch {
        let res;
        for (let a = 0; a < 6; a++) {
          res = await fetch(url, { headers: { 'User-Agent': UA } });
          if (res.status !== 429 && res.status < 500) break;
          const wait = (+res.headers.get('retry-after') || 0) * 1000 || 8000 * (a + 1);
          console.log(`  ${res.status} da ${new URL(url).host}, riprovo tra ${Math.round(wait / 1000)} s`);
          await new Promise(r => setTimeout(r, wait));
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
        await new Promise(r => setTimeout(r, /economy-finance/.test(url) ? 2500 : 150));
      }
      const meta = await sharp(raw).metadata();
      if (meta.width < 400) small.push(`${meta.width}px ${url}`);
      // solo la moneta, con lo sfondo trasparente (l'ombra la mette l'app); se la sagoma non si trova, foto intera
      const cut = await ritaglia(raw, denom).catch(() => null);
      if (cut) await fs.writeFile(path.join(OUT, out), cut);
      else
        await sharp(raw)
          .flatten({ background: '#ffffff' })
          .resize({ width: 480, height: 480, fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 84 })
          .toFile(path.join(OUT, out));
      done.set(url, out);
      return out;
    } catch (e) {
      if (fails++ < 10) console.log(`  immagine non scaricata (${e.message}): ${url}`);
      done.set(url, null);
      return null;
    }
  }

  // foto Numista solo per riempire i vuoti della BCE: dati dell'API già salvati (nessuna richiesta in più),
  // solo foto con licenza Creative Commons o di pubblico dominio, sempre con l'autore indicato nell'app
  const NCACHE = path.join(ROOT, 'scripts', 'cache');
  const numistaFoto = async id => {
    try {
      const f = path.join(
        NCACHE,
        crypto.createHash('sha1').update(`/types/${id}?lang=it`).digest('hex').slice(0, 20) + '.json',
      );
      const o = JSON.parse(await fs.readFile(f, 'utf8')).data.obverse || {};
      const lic = o.picture_license_name || '';
      if (!o.picture || !/^(CC|Creative Commons)|pubblico dominio|public domain/i.test(lic)) return null;
      // la foto grande è protetta dal controllo anti-robot di Numista: si usa la miniatura fornita dall'API (180 px)
      return { url: o.thumbnail || o.picture, credito: [o.picture_copyright, lic].filter(Boolean).join(' · ') };
    } catch {
      return null;
    }
  };
  let withImg = 0,
    daNumista = 0;
  for (const t of cat.types) {
    if (t.k) {
      t.img = null;
      continue;
    }
    const old = t.c
      ? t.y[0] <= 2006
      : /\b1st map\b/i.test(`${t.t} ${t.s}`) || (t.y[1] <= 2006 && !/\b2nd map\b/i.test(`${t.t} ${t.s}`));
    let nat = assign.has(t.id) ? await local(assign.get(t.id), t.d) : null;
    delete t.fn;
    delete t.fc;
    if (!nat) {
      const nf = await numistaFoto(t.id);
      if (nf) {
        nat = await local(nf.url, t.d);
        if (nat) {
          t.fn = 1;
          t.fc = nf.credito;
          daNumista++;
        }
      }
    }
    const cs = await local(commonUrl(t.d, old), t.d);
    t.img = nat || cs ? [nat, cs] : null;
    delete t.big;
    delete t.cr;
    if (nat) withImg++;
  }
  console.log(`Foto del lato nazionale: ${withImg} (di cui ${daNumista} da Numista, dove la BCE non l'ha pubblicata)`);
  // regola: restano fuori solo le versioni che la fonte ufficiale non pubblica mai (colorate, ologramma).
  // Le monete la cui foto non è ancora uscita (es. 2026) restano, con la moneta disegnata e la nota "foto in arrivo".
  const before = cat.types.length;
  const dropped = cat.types.filter(t => VARIANT_ALL.test(t.t));
  cat.types = cat.types.filter(t => !VARIANT_ALL.test(t.t));
  cat.types.forEach(t => {
    if (!(t.img && t.img[0])) t.pf = 1;
    else delete t.pf;
  });
  // la BCE elenca le "Sede vacante" del 2013 e del 2025 (solo 2 euro) tra i commemorativi
  cat.types.forEach(t => {
    if (lateVacante(t)) t.c = 1;
  });
  console.log(
    `\nTolte (versioni colorate/ologramma): ${dropped.length}/${before} · in attesa di foto: ${cat.types.filter(t => t.pf).length}`,
  );
  cat.types.filter(t => t.pf).forEach(t => console.log(`  … ${t.cc} ${t.c ? 'comm.' : t.d} ${t.y[0]} ${t.s}`));
  // descrizioni ufficiali in italiano (pagine BCE .it), abbinate per immagine
  const descByUrl = new Map(),
    infoByUrl = new Map(),
    enByUrl = new Map();
  // le pagine BCE nascono in inglese (lingua di lavoro della BCE) e sono tradotte nelle altre lingue:
  // la versione inglese è la fonte primaria, quella italiana è la traduzione ufficiale
  for (const f of files.filter(f => /^comm_\d{4}\.html$/.test(f))) {
    const html = (await fs.readFile(path.join(PAGES, f), 'utf8')).replace(/<sup>\s*(st|nd|rd|th)\s*<\/sup>/gi, '$1');
    for (const b of boxes(html))
      for (const src of b.imgs) enByUrl.set(src.startsWith('/') ? ECB + src : url(src), b.feature || '');
  }
  for (const f of files.filter(f => f.endsWith('.it.html'))) {
    const html = await fs.readFile(path.join(PAGES, f), 'utf8');
    const isComm = f.startsWith('comm_');
    for (let seg of html.split(/<div class="box(?: [^"]*)?"[^>]*>/).slice(1)) {
      const imgs = [...seg.matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map(m => m[1])
        .filter(x => /\/euro\/coins\/|comm_\d{4}\//.test(x));
      if (!imgs.length) continue;
      seg = seg.replace(/&nbsp;/g, ' ').replace(/<sup>\s*(o|°|º|a)\s*<\/sup>/gi, (_, x) => (x === 'a' ? 'ª' : '°'));
      let text = '';
      if (isComm) {
        const eff = strip((seg.match(/Effigie\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i) || [])[1] || '');
        const des = strip((seg.match(/Descrizione\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i) || [])[1] || '');
        text = [eff && eff.replace(/[.\s]+$/, '') + '.', des].filter(Boolean).join(' ');
      } else {
        const box = (seg.match(/<div class="content-box">([\s\S]*?)(<a [^>]*href|$)/) || [])[1] || '';
        text = strip(box.replace(/<h3[\s\S]*?<\/h3>/, ''));
      }
      text = text.replace(/\s+/g, ' ').trim();
      const field = re =>
        strip((seg.match(re) || [])[1] || '')
          .replace(/\s+/g, ' ')
          .replace(/[.\s]+$/, '')
          .trim();
      const info = isComm
        ? {
            eff: field(/Effigie\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
            tir: field(/(?:Tiratura|Volume di emissione)\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
            data: field(/Data di emissione\s*:?\s*<\/strong>([\s\S]*?)<\/p>/i),
          }
        : {};
      for (const src of imgs) {
        const u = src.startsWith('/') ? ECB + src : url(src);
        if (info.tir || info.data || info.eff) infoByUrl.set(u, info);
        if (text.length >= 20) descByUrl.set(u, text.slice(0, 900));
      }
    }
  }
  const texts = [],
    textIdx = new Map();
  let withDesc = 0;
  for (const t of cat.types) {
    const u = assign.get(t.id),
      ce = comEntry.get(t.id);
    let d = !ce && u ? descByUrl.get(u) : null;
    let inf = !ce && u ? infoByUrl.get(u) : null;
    if (ce && ce.it) {
      inf = ce.it;
      d =
        [ce.it.eff && ce.it.eff.replace(/[.\s]+$/, '') + '.', ce.it.des]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 900) || null;
      if (d && d.length < 20) d = null;
    }
    delete t.di;
    delete t.ev;
    delete t.ed;
    delete t.ti;
    if (inf && inf.tir) t.ev = inf.tir.slice(0, 80);
    if (inf && inf.data) t.ed = inf.data.slice(0, 40);
    // titolo ufficiale italiano della BCE, tranne quando la traduzione contraddice la versione primaria
    // inglese nei numeri (es. un anniversario sbagliato): lì si tiene il titolo del catalogo
    // numeri del titolo, anche scritti a parole (centenario = 100, 5° centenario = 500, bicentenary = 200…)
    const nums = x =>
      (
        String(x || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/(\d+)\s*[°º]?\s*centenari[oa]/g, (_, n) => String(+n * 100))
          .replace(/(\d+)(?:st|nd|rd|th)?\s+centenary/g, (_, n) => String(+n * 100))
          .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+centenary/g, (_, w) =>
            String(
              100 *
                ([
                  'first',
                  'second',
                  'third',
                  'fourth',
                  'fifth',
                  'sixth',
                  'seventh',
                  'eighth',
                  'ninth',
                  'tenth',
                ].indexOf(w) +
                  1),
            ),
          )
          .replace(/(\d+)(?:st|nd|rd|th)?\s+decade/g, (_, n) => String(+n * 10))
          .replace(/\bbicentenari[oa]|\bbicentenary|\bbicentennial/g, '200')
          .replace(/\btricentenari[oa]|\btercentenary/g, '300')
          .replace(/\bbimillenari[oa]|\bbimillennium/g, '2000')
          .replace(/\bmillenari[oa]|\bmillennium/g, '1000')
          .replace(/\bcentenari[oa]|\bcentenary|\bcentennial/g, '100')
          .match(/\d+/g) || []
      )
        .map(Number)
        .filter(n => n < 1000);
    const en = ce ? ce.feature : u && enByUrl.get(u);
    // si scarta il titolo italiano solo se entrambi i titoli hanno numeri (anni esclusi) e nessuno coincide
    const numbersAgree = (a, b) => {
      const A = nums(a),
        B = nums(b);
      return !a || !A.length || !B.length || A.some(n => B.includes(n));
    };
    if (t.c && inf && inf.eff && inf.eff.length >= 3 && numbersAgree(en, inf.eff)) {
      const ti = inf.eff.replace(/^[«"“]|[»"”]$/g, '').slice(0, 200);
      t.ti = ti.charAt(0).toUpperCase() + ti.slice(1);
    }
    if (!d) continue;
    if (!textIdx.has(d)) {
      textIdx.set(d, texts.length);
      texts.push(d);
    }
    t.di = textIdx.get(d);
    withDesc++;
  }
  cat.ds = texts;
  console.log(
    `Descrizioni ufficiali: ${withDesc}/${cat.types.length} monete (${texts.length} testi) · tiratura BCE: ${cat.types.filter(t => t.ev).length} · data di emissione: ${cat.types.filter(t => t.ed).length}`,
  );

  // data di prima comparsa nel catalogo (per la sezione Novità)
  const fsPath = path.join(ROOT, 'scripts', 'first-seen.json');
  let first = null;
  try {
    first = JSON.parse(await fs.readFile(fsPath, 'utf8'));
  } catch {}
  const today = new Date().toISOString().slice(0, 10),
    baseline = !first;
  first = first || {};
  for (const t of cat.types) {
    if (!first[t.id]) first[t.id] = baseline ? 'base' : today;
    if (first[t.id] !== 'base') t.n = first[t.id];
    else delete t.n;
  }
  // anche per i singoli pezzi (es. un anno nuovo di una moneta già in catalogo)
  const pieceBase = baseline || !Object.keys(first).some(k => k[0] === 'p');
  for (const t of cat.types)
    for (const p of t.p) {
      const k = 'p' + p[0];
      if (!first[k]) first[k] = pieceBase ? 'base' : today;
      p.length = 5;
      if (first[k] !== 'base') p[5] = first[k];
    }
  await fs.writeFile(fsPath, JSON.stringify(first));

  cat.photos = 'Immagini: Banca centrale europea (lati nazionali e commemorativi), Commissione europea (lati comuni)';
  cat.stats = {
    ...(cat.stats || {}),
    tipi: cat.types.length,
    pezzi: cat.types.reduce((a, t) => a + t.p.length, 0),
    conFoto: withImg,
    toltiVarianti: dropped.length,
    fotoInArrivo: cat.types.filter(t => t.pf).length,
  };
  // pagine BCE dei commemorativi davvero disponibili (per i link dell'app: mai un link a una pagina che non esiste)
  cat.ecbPagine = {
    it: files
      .map(f => f.match(/^comm_(\d{4})\.it\.html$/))
      .filter(Boolean)
      .map(m => +m[1])
      .sort(),
    en: files
      .map(f => f.match(/^comm_(\d{4})\.html$/))
      .filter(Boolean)
      .map(m => +m[1])
      .sort(),
  };
  await fs.writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(cat));
  // via le immagini non più usate
  const keep = new Set(
    cat.types
      .flatMap(t => t.img || [])
      .filter(Boolean)
      .map(x => x.replace(/^img\//, '')),
  );
  for (const f of await fs.readdir(IMG)) if (!keep.has(f)) await fs.unlink(path.join(IMG, f));
  console.log(`\nImmagini sotto i 400 px: ${small.length}`);
  small.filter(x => !/comm_/.test(x)).forEach(x => console.log('  ' + x));
  console.log(`\nFatto: ${withImg}/${cat.types.length} monete con foto del lato nazionale.`);
}

main().catch(e => {
  console.error('ERRORE:', e.message);
  process.exit(1);
});
