// Scarica dal canale ufficiale di Numista (API v3) il catalogo delle monete euro
// da circolazione (1 cent – 2 euro, compresi i 2 euro commemorativi) e lo salva
// in www/data/catalog.json + www/data/img/*.webp.
//
// - Ogni risposta dell'API viene salvata in scripts/cache: se lo script viene
//   rilanciato, quello che è già stato scaricato non consuma altre richieste.
// - NUMISTA_KEYS può contenere più chiavi separate da virgola: quando una finisce
//   la quota si passa alla successiva. Se finiscono tutte, lo script salva quello
//   che ha e si ferma; al prossimo avvio riparte da lì.
// - PROBE=1 fa solo 4 richieste e stampa la forma delle risposte (per controllo).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', 'cache');
const OUT = path.join(ROOT, 'www', 'data');
const API = process.env.NUMISTA_API || 'https://api.numista.com/v3';
let keysText = process.env.NUMISTA_KEYS || '';
try {
  if (!keysText.trim())
    keysText = (await import('node:fs'))
      .readFileSync(path.join(ROOT, 'scripts', 'numista-keys.txt'), 'utf8')
      .replace(/#.*$/gm, '');
} catch {}
const KEYS = keysText.split(/[\s,;]+/).filter(Boolean);
const LIMIT = Number(process.env.LIMIT_PER_KEY || 1950);
const PROBE = process.env.PROBE === '1';
const UA = 'CollezioneEuro/1.0 (app privata, uso personale)';

export const COUNTRIES = [
  { cc: 'AD', name: 'Andorra', flag: '🇦🇩', en: ['Andorra'], guess: 'andorre' },
  { cc: 'AT', name: 'Austria', flag: '🇦🇹', en: ['Austria'], guess: 'autriche' },
  { cc: 'BE', name: 'Belgio', flag: '🇧🇪', en: ['Belgium'], guess: 'belgique' },
  { cc: 'BG', name: 'Bulgaria', flag: '🇧🇬', en: ['Bulgaria'], guess: 'bulgarie' },
  { cc: 'CY', name: 'Cipro', flag: '🇨🇾', en: ['Cyprus'], guess: 'chypre' },
  { cc: 'HR', name: 'Croazia', flag: '🇭🇷', en: ['Croatia'], guess: 'croatie' },
  { cc: 'EE', name: 'Estonia', flag: '🇪🇪', en: ['Estonia'], guess: 'estonie' },
  { cc: 'FI', name: 'Finlandia', flag: '🇫🇮', en: ['Finland'], guess: 'finlande' },
  { cc: 'FR', name: 'Francia', flag: '🇫🇷', en: ['France'], guess: 'france' },
  { cc: 'DE', name: 'Germania', flag: '🇩🇪', en: ['Germany, Federal Republic of', 'Germany'], guess: 'allemagne' },
  { cc: 'GR', name: 'Grecia', flag: '🇬🇷', en: ['Greece'], guess: 'grece' },
  { cc: 'IE', name: 'Irlanda', flag: '🇮🇪', en: ['Ireland'], guess: 'irlande' },
  { cc: 'IT', name: 'Italia', flag: '🇮🇹', en: ['Italy'], guess: 'italie' },
  { cc: 'LV', name: 'Lettonia', flag: '🇱🇻', en: ['Latvia'], guess: 'lettonie' },
  { cc: 'LT', name: 'Lituania', flag: '🇱🇹', en: ['Lithuania'], guess: 'lituanie' },
  { cc: 'LU', name: 'Lussemburgo', flag: '🇱🇺', en: ['Luxembourg'], guess: 'luxembourg' },
  { cc: 'MT', name: 'Malta', flag: '🇲🇹', en: ['Malta'], guess: 'malte' },
  { cc: 'MC', name: 'Monaco', flag: '🇲🇨', en: ['Monaco'], guess: 'monaco' },
  { cc: 'NL', name: 'Paesi Bassi', flag: '🇳🇱', en: ['Netherlands'], guess: 'pays-bas' },
  { cc: 'PT', name: 'Portogallo', flag: '🇵🇹', en: ['Portugal'], guess: 'portugal' },
  { cc: 'SM', name: 'San Marino', flag: '🇸🇲', en: ['San Marino'], guess: 'saint-marin' },
  { cc: 'SK', name: 'Slovacchia', flag: '🇸🇰', en: ['Slovakia'], guess: 'slovaquie' },
  { cc: 'SI', name: 'Slovenia', flag: '🇸🇮', en: ['Slovenia'], guess: 'slovenie' },
  { cc: 'ES', name: 'Spagna', flag: '🇪🇸', en: ['Spain'], guess: 'espagne' },
  { cc: 'VA', name: 'Vaticano', flag: '🇻🇦', en: ['Vatican City', 'Vatican'], guess: 'vatican' },
];

const DORDER = ['1c', '2c', '5c', '10c', '20c', '50c', '1e', '2e'];
const DENOM_BY_CENTS = { 1: '1c', 2: '2c', 5: '5c', 10: '10c', 20: '20c', 50: '50c', 100: '1e', 200: '2e' };
const TITLE_OK = /^\s*(1|2|5|10|20|50)\s+euro\s*cents?\b|^\s*(1|2)\s+euros?\b/i;
// Numista segna come "non in circolazione" anche le monete di Vaticano, San Marino, Monaco, Andorra
// e quelle coniate solo per i set: per questa app vanno tenute (sono monete euro a corso legale).
// Si escludono solo prove/modelli e pezzi fuori standard (peso diverso dalla moneta normale).
const EXCLUDE_TYPE = /pattern|modello|trial|essai|prova|medal|medaglia|token|gettone|fantasy|fantasia|bullion/i;
const STD_WEIGHT = { '1c': 2.3, '2c': 3.06, '5c': 3.92, '10c': 4.1, '20c': 5.74, '50c': 7.8, '1e': 7.5, '2e': 8.5 };
const COMMEM_TYPE = /commemorativ/i;
const COLORED = /colou?ri[sz]ed|colou?red|colorat[oaie]\b/i;
const COLORED_TITLE = /colou?red|colorized|hologram|blue flag|coin ?card/i;
const PROOF = /\bproof\b|\bPP\b|fondo specchio|polierte platte|\bBE\b|belle [ée]preuve/i;

class QuotaError extends Error {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const OLD = '2026-11-01'; // data assegnata alle risposte salvate prima che si registrasse la data
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// Conteggio delle richieste per chiave nel mese in corso (Numista: 2.000 al mese per chiave).
// Resta salvato fra un avvio e l'altro, così il programma sa quanto può ancora usare.
const STATE_FILE = path.join(ROOT, 'scripts', 'numista-state.json');
let state = {};
try {
  state = JSON.parse((await import('node:fs')).readFileSync(STATE_FILE, 'utf8'));
} catch {}
if (state.month !== MONTH) {
  state.month = MONTH;
  state.used = {};
}
state.used = state.used || {};
const fp = k => crypto.createHash('sha1').update(k).digest('hex').slice(0, 8);
const used = KEYS.map(k => state.used[fp(k)] || 0);
const startUsed = used.reduce((a, b) => a + b, 0);
async function saveState() {
  KEYS.forEach((k, i) => {
    state.used[fp(k)] = used[i];
  });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 1));
}
const budget = () => KEYS.reduce((a, _, i) => a + Math.max(0, LIMIT - used[i]), 0);
let keyIdx = 0;
let netCalls = 0;
let quotaHit = false;

const cacheFile = q => path.join(CACHE, crypto.createHash('sha1').update(q).digest('hex').slice(0, 20) + '.json');
async function cached(q) {
  try {
    const c = JSON.parse(await fs.readFile(cacheFile(q), 'utf8'));
    c.at = c.at || OLD;
    return c;
  } catch {
    return null;
  }
}
async function hasCache(q) {
  try {
    await fs.access(cacheFile(q));
    return true;
  } catch {
    return false;
  }
}

// api(q): usa la copia salvata se c'è. Con { since: 'AAAA-MM-GG' } la riscarica se è più vecchia di quella data
// (se le richieste del mese sono finite, si tiene la copia vecchia senza errori).
// limite di tempo di sicurezza: GitHub ferma un giro dopo 6 ore; prima di arrivarci il programma smette di chiedere
// e salva tutto quello che ha (le richieste fatte non vanno perse, il giro dopo riparte da lì)
const T0 = Date.now(),
  MAX_MS = Number(process.env.MAX_MINUTI || 270) * 60000;
async function api(q, { since = null } = {}) {
  const c = await cached(q);
  if (c && (!since || c.at >= since)) return c.data;
  if (Date.now() - T0 > MAX_MS) {
    quotaHit = true;
    if (c) return c.data;
    throw new QuotaError('Tempo massimo del giro raggiunto: mi fermo e salvo');
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    while (keyIdx < KEYS.length && used[keyIdx] >= LIMIT) keyIdx++;
    if (keyIdx >= KEYS.length) {
      quotaHit = true;
      if (c) return c.data;
      throw new QuotaError('Quota esaurita su tutte le chiavi');
    }
    await sleep(120);
    let res;
    try {
      res = await fetch(API + q, { headers: { 'Numista-API-Key': KEYS[keyIdx], 'User-Agent': UA } });
    } catch (e) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    used[keyIdx]++;
    netCalls++;
    if (netCalls % 100 === 0) {
      await saveState();
      console.log(`  … ${netCalls} richieste (restano ${budget()})`);
    }
    if (res.status === 429) {
      const body = await res.text();
      console.log(`  429 sulla chiave ${keyIdx + 1}: ${body.slice(0, 160)}`);
      if (/quota|limit|month/i.test(body) || attempt >= 1) {
        used[keyIdx] = LIMIT;
      } else await sleep(5000);
      continue;
    }
    if (res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    // chiave non più valida: si passa all'altra (se tutte sono rifiutate si usano le copie salvate)
    if (res.status === 401 || res.status === 403) {
      console.log(`  ⚠️ chiave ${keyIdx + 1} rifiutata (${res.status}): ${text.slice(0, 160)}`);
      used[keyIdx] = LIMIT;
      continue;
    }
    if (!res.ok) {
      // errore su una scheda già salvata (es. scheda tolta o unita a un'altra su Numista): si tiene la copia
      // salvata e la si segna come controllata oggi, così non si riprova ogni volta
      if (c) {
        console.log(`  HTTP ${res.status} su ${q}: tengo la copia salvata`);
        await fs.writeFile(cacheFile(q), JSON.stringify({ q, at: TODAY, data: c.data }));
        return c.data;
      }
      throw Object.assign(new Error(`HTTP ${res.status} su ${q}: ${text.slice(0, 300)}`), { status: res.status });
    }
    const data = JSON.parse(text);
    await fs.writeFile(cacheFile(q), JSON.stringify({ q, at: TODAY, data }));
    return data;
  }
  if (c) return c.data;
  throw new Error('Troppi errori di rete su ' + q);
}

const show = (label, obj) => console.log(`\n=== ${label} ===\n` + JSON.stringify(obj, null, 2).slice(0, 2500));

async function mapIssuers() {
  const data = await api('/issuers?lang=en');
  const list = Array.isArray(data) ? data : data.issuers || [];
  const byCode = new Map(list.map(i => [i.code, i]));
  const byName = new Map(list.map(i => [String(i.name).toLowerCase(), i]));
  const out = {};
  for (const c of COUNTRIES) {
    let hit = byCode.get(c.guess);
    if (!hit)
      for (const n of c.en) {
        hit = byName.get(n.toLowerCase());
        if (hit) break;
      }
    out[c.cc] = hit ? hit.code : c.guess;
    console.log(
      `  ${c.cc} ${c.name.padEnd(12)} → ${out[c.cc]}${hit ? '' : '  (non trovato in /issuers, uso il codice previsto)'}`,
    );
  }
  return { out, list };
}

async function searchAll(code, since, extra = '', maxPages = 30) {
  const found = [];
  for (let page = 1; page <= maxPages; page++) {
    const q = `/types?issuer=${encodeURIComponent(code)}&category=coin&q=euro${extra}&count=50&page=${page}&lang=en`;
    let data;
    try {
      data = await api(q, { since });
    } catch (e) {
      // pagina oltre la fine: 400/404. Con un filtro in più, un 400 alla prima pagina vuol dire filtro non accettato
      if ((e.status === 400 && !(extra && page === 1)) || e.status === 404) break;
      throw e;
    }
    const types = data.types || [];
    if (page === 1 && types.length && types.every(t => t.issuer && t.issuer.code && t.issuer.code !== code))
      throw new Error(
        `il filtro per paese non funziona (chiesto "${code}", arrivato "${types[0].issuer.code}"): mi fermo per non sprecare richieste`,
      );
    found.push(...types);
    const total = data.count ?? types.length;
    if (types.length < 50 || page * 50 >= total) break;
  }
  return found.filter(t => TITLE_OK.test(t.title || '') && (t.max_year == null || t.max_year >= 1999));
}

// Ricerca leggera delle monete dell'anno e del prossimo (i commemorativi si annunciano in anticipo).
// Numista accetta il filtro "year" (anche come intervallo): si prova l'intervallo, e se non va i due anni separati.
// Se il filtro venisse ignorato (arrivano monete finite da anni) ci si ferma, per non rifare la ricerca completa.
let modoAnno = 'intervallo';
async function searchRecent(code, y) {
  const prendi = async extra => {
    const list = await searchAll(code, TODAY, extra, 3);
    if (list.some(t => t.max_year != null && t.max_year < y - 1))
      throw Object.assign(new Error('filtro per anno ignorato da Numista'), { ignorato: true });
    return list;
  };
  if (modoAnno === 'intervallo') {
    try {
      return await prendi(`&year=${y}-${y + 1}`);
    } catch (e) {
      if (e.status !== 400) throw e;
      modoAnno = 'separati';
      console.log('  intervallo di anni non accettato: cerco i due anni separati');
    }
  }
  return [...(await prendi(`&year=${y}`)), ...(await prendi(`&year=${y + 1}`))];
}

function denomOf(t) {
  const v = t?.value?.numeric_value;
  if (typeof v === 'number') return DENOM_BY_CENTS[Math.round(v * 100)] || null;
  const m = String(t.title || '').match(TITLE_OK);
  if (!m) return null;
  return m[1] ? DENOM_BY_CENTS[+m[1]] : DENOM_BY_CENTS[+m[2] * 100];
}

function typeLabel(t) {
  return [t.object_type?.name, t.type, t.category_detail, t.issuer_type].filter(Boolean).join(' ');
}

function isEuro(t) {
  const cur = t?.value?.currency;
  if (!cur) return true;
  return /euro/i.test(`${cur.name || ''} ${cur.full_name || ''}`);
}

function subtitleOf(t, commem) {
  const paren = (String(t.title || '').match(/\(([^)]+)\)/) || [])[1] || '';
  const clean = x =>
    String(x || '')
      .replace(/^\(\w{2}\)\s*/, '')
      .trim();
  if (commem) return clean(t.commemorated_topic) || paren || t.title;
  const rulers = (t.ruler || t.rulers || [])
    .map(r => r.name)
    .filter(Boolean)
    .join(', ');
  return [rulers, paren].filter(Boolean).join(' · ');
}

// ---- emissioni → pezzi -------------------------------------------------------------------
// Ogni emissione Numista è una riga (anno, zecca, segni, nota). Diventano lo stesso pezzo le righe
// che differiscono solo per la confezione (BU, set, coincard…): conta come la stessa moneta.
// Restano pezzi separati proof e tutto ciò che è visibilmente diverso (posizione del marchio,
// nuovo lato comune, stelle grandi, errori di conio…), anche quando Numista lo scrive solo nella nota.
const VISUAL =
  /mint ?marks?|\bmarks?\b|reverse|obverse|stars?\b|leaf|serif|error|mule|without|thick|thin|différent|logo|lion|bridge|pont|mercury|caduc|cornucopia|corne|rhinoc|raven|hunting horn|sail|flag|picture|edge|reeds|\bmap\b|signature|\bbee\b|coast|type [a-c0-9]\b|\bletters?\b|atoue|matte|\bmat\b|variant|variety|\bdie\b/i;
const AMBIG = /\b(two|both)\b|exist|see comments?|n'existe|^\d/i;
const PACK_WORDS =
  /\b(bu|unc|fdc|proof|pp|be|belle [ée]preuve|brillant universel|coin ?cards?|coincards?|folders?|sets?|mintset|in|only|version|official|the|of|with)\b/gi;
function variantOf(comment) {
  const parts = String(comment || '')
    .split(/;|,(?!\d{3})|\.\s|\s-\s/)
    .map(x =>
      x
        .replace(/^\((?:fr|de|en|nl|it|es)\)\s*/i, '')
        .replace(/[()"]/g, '')
        .trim(),
    )
    .filter(Boolean);
  return parts.filter(x => VISUAL.test(x) && !AMBIG.test(x)).join('; ');
}
const variantKey = v =>
  v
    .toLowerCase()
    .replace(PACK_WORDS, ' ')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim();
const VARIANT_IT = [
  [/lion mint ?mark on the right/i, 'leone a destra'],
  [/lion mint ?mark on the left/i, 'leone a sinistra'],
  [/lion mint ?mark under/i, 'leone sotto il fiore'],
  [/cornucopia mint ?mark/i, 'cornucopia'],
  [/mint ?mark on the right/i, 'marchio a destra'],
  [/mint ?mark on the left/i, 'marchio a sinistra'],
  [/without mint ?mark/i, 'senza marchio'],
  [/new reverse/i, 'nuovo lato comune'],
  [/old reverse/i, 'vecchio lato comune'],
  [/large stars/i, 'stelle grandi'],
  [/small oak leaf/i, 'foglia piccola'],
  [/small stars/i, 'stelle piccole'],
  [/big stars/i, 'stelle grandi'],
  [/reverse proof/i, 'proof inverso'],
  [/mule|wrong reverse|old map/i, 'errore (mulo)'],
  [/monnaie de paris|paris mint ?mark|monnaie paris/i, 'marchio di Parigi'],
  [/smaller reverse/i, 'rovescio più piccolo'],
  [/smaller obverse/i, 'dritto più piccolo'],
  [/edge/i, 'bordo diverso'],
  [/small signature/i, 'firma piccola'],
  [/medium signature/i, 'firma media'],
  [/large signature/i, 'firma grande'],
  [/engraver'?s signature|no signature/i, "firma dell'incisore"],
  [/signature/i, 'firma diversa'],
  [/bee pointing left/i, 'ape a sinistra'],
  [/bee pointing right/i, 'ape a destra'],
  [/mark in star/i, 'lettera nella stella'],
  [/error/i, 'errore di conio'],
  [/thick|blurry/i, 'tratto spesso'],
  [/thin|sharp/i, 'tratto sottile'],
];
// segni di zecca e del maestro di zecca: termini della numismatica italiana
const MARK_WORDS = [
  [/corne d['’]abondance/gi, 'cornucopia'],
  [/hunting horn/gi, 'corno da caccia'],
  [/\bcaduc(eus|ée|ee)\b/gi, 'caduceo'],
  [/\bmercury\b/gi, 'caduceo'],
  [/\blion\b/gi, 'leone'],
  [/\bbridge\b|\bpont\b/gi, 'ponte'],
  [/\braven\b/gi, 'corvo'],
  [/\brhinoceros\b/gi, 'rinoceronte'],
  [/\bsail\b/gi, 'vela'],
  [/\bbelle [ée]preuve\b|\bBE\b|\bBU\b|\bproof\b/gi, ''],
  [/\bdiff[ée]rent\b/gi, ''],
  [/\bmint ?marks?\b/gi, 'segno'],
  [/\bet\b|\band\b/gi, 'e'],
  [/\bwith\b/gi, 'con'],
  [/\bwithout\b/gi, 'senza'],
  [/\btype\b/gi, 'tipo'],
  [/\bstar\b/gi, 'stella'],
  [/\bbetween letters\b/gi, 'tra le lettere'],
  [/\bcoin ?card\b/gi, ''],
];
function variantIt(v) {
  if (!v) return '';
  for (const [re, it] of VARIANT_IT) if (re.test(v)) return it;
  let x = v;
  for (const [re, it] of MARK_WORDS) x = x.replace(re, it);
  x = x
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  return x;
}
const variantLabel = v => {
  const x = variantIt(v);
  return x.length > 22 ? x.slice(0, 21) + '…' : x;
};

// nome del segno (di solito il maestro di zecca): se è lungo, iniziali dei nomi + cognome (es. "M.T. Brouwer")
const shortMark = m => {
  const t = String(m.title || m.name || '')
    .split(',')[0]
    .trim();
  if (t.length <= 16) return t;
  const w = t.split(/\s+/);
  let i = w.length - 1;
  while (i > 1 && /^(van|von|de|der|den|di|da|du|le|la)$/i.test(w[i - 1])) i--;
  const s =
    w
      .slice(0, i)
      .filter(x => /^\p{Lu}/u.test(x))
      .map(x => x[0] + '.')
      .join('') +
    ' ' +
    w.slice(i).join(' ');
  return s.length > 18 ? s.slice(0, 17) + '…' : s;
};
// varianti che l'app non distingue (scripts/varianti-unite.json): diventano un pezzo solo
let UNITE = [];
try {
  UNITE = JSON.parse(
    (await import('node:fs')).readFileSync(path.join(ROOT, 'scripts', 'varianti-unite.json'), 'utf8'),
  ).regole.map(r => ({ ...r, re: r.cerca ? new RegExp(r.cerca, 'i') : null }));
} catch {}
const regolaVale = (r, typeId, cc, year) =>
  (r.tipo == null || +r.tipo === +typeId) &&
  (r.paese == null || String(r.paese).toUpperCase() === String(cc || '').toUpperCase()) &&
  (r.anno == null || +r.anno === +year);
const unita = (typeId, cc, year, variant) =>
  !!variant && UNITE.some(r => r.cerca && regolaVale(r, typeId, cc, year) && r.re.test(variant));
// segni diversi (es. due maestri di zecca nello stesso anno) che l'app non distingue: un pezzo solo
const segniUniti = (typeId, cc, year) => UNITE.some(r => r.segni === 'unisci' && regolaVale(r, typeId, cc, year));
function groupIssues(issues, typeId = null, cc = null) {
  const groups = new Map();
  for (const is of issues) {
    const year = is.year ?? is.gregorian_year ?? is.min_year;
    // anni impossibili (dati sbagliati nel catalogo, es. anno 0): si scartano
    if (year == null || year < 1999 || year > new Date().getFullYear() + 1) continue;
    const mint = (is.mint_letter || '').trim();
    const unisciSegni = segniUniti(typeId, cc, year);
    const marks = unisciSegni
      ? ''
      : (is.marks || [])
          .map(m => m.id ?? m.title)
          .sort()
          .join('+');
    const proof = PROOF.test(is.comment || '') ? 1 : 0;
    let variant = variantOf(is.comment);
    if (unita(typeId, cc, year, variant)) variant = '';
    const k = `${year}|${mint}|${marks}|${proof}|${variantKey(variant)}`;
    const g = groups.get(k);
    const mt = typeof is.mintage === 'number' ? is.mintage : null;
    if (!g)
      groups.set(k, {
        id: is.id,
        ids: [is.id],
        year: +year,
        mint,
        marks,
        markLabel: unisciSegni ? '' : (is.marks || []).map(shortMark).filter(Boolean).join(' / '),
        proof,
        variant,
        mintage: mt,
        comments: [is.comment || ''],
        markNames: (is.marks || []).map(m => m.title).filter(Boolean),
      });
    else {
      g.ids.push(is.id);
      if (is.id < g.id) g.id = is.id;
      if (mt != null) g.mintage = (g.mintage || 0) + mt;
      g.comments.push(is.comment || '');
    }
  }
  const all = [...groups.values()];
  const bucket = new Map();
  const yb = new Map();
  // segni diversi (es. maestri di zecca) nello stesso anno/zecca: allora il nome del segno serve a distinguerli
  for (const g of all) {
    const b = `${g.year}|${g.mint}|${g.proof}`;
    if (!bucket.has(b)) bucket.set(b, new Set());
    bucket.get(b).add(g.marks);
    const y = `${g.year}|${g.proof}`;
    yb.set(y, (yb.get(y) || 0) + 1);
  }
  // il nome della variante si mostra solo se nello stesso anno c'è davvero un'alternativa da distinguere
  return all
    .map(g => {
      const many = bucket.get(`${g.year}|${g.mint}|${g.proof}`).size > 1,
        alt = yb.get(`${g.year}|${g.proof}`) > 1;
      return {
        ...g,
        key: null,
        label: [g.mint, many ? g.markLabel : '', alt ? variantLabel(g.variant) : ''].filter(Boolean).join(' '),
      };
    })
    .map((g, _, arr) => g)
    .sort((a, b) => a.year - b.year || a.proof - b.proof || a.label.localeCompare(b.label))
    .reduce((out, g, _, arr) => {
      // due pezzi dello stesso anno con la stessa etichetta: si usa la descrizione completa della variante,
      // e se non basta un numero, così ogni pezzo si distingue
      const same = arr.filter(o => o.year === g.year && o.proof === g.proof && o.label === g.label);
      if (same.length > 1) {
        const full = [g.mint, g.markLabel, variantIt(g.variant)].filter(Boolean).join(' ');
        const sameFull = same.filter(
          o => [o.mint, o.markLabel, variantIt(o.variant)].filter(Boolean).join(' ') === full,
        );
        g = { ...g, label: sameFull.length > 1 ? `${full} (${sameFull.indexOf(same.find(o => o === g)) + 1})` : full };
      }
      out.push(g);
      return out;
    }, []);
}
export function piecesOf(typeId, issues, cc = null) {
  return groupIssues(issues, typeId, cc).map(g => [`${typeId}-${g.id}`, g.year, g.label, g.proof, g.mintage]);
}

// come esce la moneta: solo nei set, anche in BU/coincard…
function packagingNote(comments) {
  const c = comments.map(x => String(x || '').toLowerCase());
  const plain = c.some(x => !x.trim() || /circulation/.test(x));
  const tags = [];
  if (c.some(x => /\bsets?\b|kms|coffret/.test(x))) tags.push('set');
  if (c.some(x => /coin ?card|folder|blister/.test(x))) tags.push('coincard');
  if (c.some(x => /starter|mini ?kit/.test(x))) tags.push('starter kit');
  if (c.some(x => /roll/.test(x))) tags.push('rotolini');
  if (!tags.length && c.some(x => /\bbu\b|brilliant|\bunc\b|fdc/.test(x))) tags.push('BU');
  if (!tags.length) return '';
  return (plain ? 'anche in ' : 'solo in ') + tags.join(', ');
}

// ---- testo delle schede ------------------------------------------------------------------
const ENT = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  lt: '<',
  gt: '>',
  apos: "'",
  rsquo: "'",
  lsquo: "'",
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  deg: '°',
  laquo: '«',
  raquo: '»',
  egrave: 'è',
  eacute: 'é',
  agrave: 'à',
  ograve: 'ò',
  ugrave: 'ù',
  igrave: 'ì',
};
function htmlText(h) {
  let t = String(h || '')
    .replace(/<a[^>]*>\s*<img[^>]*>\s*<\/a>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // via le righe che introducevano solo delle foto (ora tolte)
  t = t
    .split('\n')
    .filter((line, i, a) => !(/:\s*$/.test(line) && (i === a.length - 1 || !a[i + 1].trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t;
}
const clean = x =>
  String(x || '')
    .replace(/^\(\w{2}\)\s*/, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
function sideOf(x) {
  if (!x) return undefined;
  const o = {};
  const d = clean(x.description);
  if (d) o.d = d.slice(0, 1500);
  const l = clean(x.lettering);
  if (l) o.l = l.slice(0, 400);
  const lt = clean(x.lettering_translation);
  if (lt) o.lt = lt.slice(0, 400);
  const a = [...new Set([...(x.designers || []), ...(x.engravers || [])].map(clean).filter(Boolean))];
  if (a.length) o.a = a.join(', ');
  return Object.keys(o).length ? o : undefined;
}
const GRADES = ['g', 'vg', 'f', 'vf', 'xf', 'au', 'unc'];
function pricesOf(data) {
  const arr = Array.isArray(data) ? data : (data && (data.prices || data.price || data.estimates)) || [];
  const out = {};
  for (const x of Array.isArray(arr) ? arr : []) {
    const g = String(x.grade || x.quality || '').toLowerCase();
    const v = Number(x.price ?? x.value);
    if (GRADES.includes(g) && isFinite(v) && v > 0) out[g] = Math.round(v * 100) / 100;
  }
  return out;
}
function detailOf(t, groups, catIds, priceMap) {
  const o = {};
  const put = (k, v) => {
    if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) o[k] = v;
  };
  put('me', clean(t.composition?.text));
  put('w', t.weight);
  put('dia', t.size);
  put('th', t.thickness);
  put('sh', clean(t.shape));
  put('tec', clean(t.technique?.text));
  put('or', t.orientation);
  put('ob', sideOf(t.obverse));
  put('rv', sideOf(t.reverse));
  put('ed', sideOf(t.edge));
  put('se', clean(t.series));
  put('ct', clean(t.commemorated_topic));
  put('co', htmlText(t.comments).slice(0, 4000));
  put('tg', (t.tags || []).map(clean).filter(Boolean));
  put(
    'ru',
    (t.ruler || [])
      .map(r => clean(r.name))
      .filter(Boolean)
      .join(', '),
  );
  put('rf', (t.references || []).map(r => `${r.catalogue?.code || ''}# ${r.number}`.trim()).join(' · '));
  put('mi', (t.mints || []).map(m => clean(m.name)).filter(Boolean));
  put('ie', clean(t.issuing_entity?.name));
  put('it', clean(t.issue_terms));
  put('dm', t.demonetization?.is_demonetized ? t.demonetization.demonetization_date || 'sì' : undefined);
  put(
    'rl',
    (t.related_types || []).map(r => r.id).filter(id => catIds.has(id)),
  );
  const pi = {};
  for (const g of groups) {
    const k = `${t.id}-${g.id}`,
      e = {};
    const note = packagingNote(g.comments);
    if (note) e.c = note;
    if (g.variant) e.v = variantIt(g.variant) === g.variant ? g.variant : variantIt(g.variant) + ' (' + g.variant + ')';
    if (g.markNames.length) e.m = g.markNames.join(', ');
    const pr = priceMap.get(k);
    if (pr) {
      e.pr = pr.v;
      e.pa = pr.at;
    }
    if (Object.keys(e).length) pi[k] = e;
  }
  put('pi', Object.keys(pi).length ? pi : undefined);
  return o;
}

async function main() {
  await fs.mkdir(CACHE, { recursive: true });
  if (!KEYS.length) console.log('Attenzione: nessuna chiave in NUMISTA_KEYS, uso solo la cache.');
  console.log(
    `Chiavi: ${KEYS.length} · limite per chiave: ${LIMIT} · già usate questo mese: ${startUsed} · disponibili: ${budget()}${PROBE ? ' · MODALITÀ PROVA' : ''}`,
  );

  if (PROBE) {
    const { out } = await mapIssuers();
    const s = await api(`/types?issuer=${out.IT}&category=coin&q=euro&count=5&page=1&lang=en`);
    const first = (s.types || [])[0];
    if (first) {
      const iss = await api(`/types/${first.id}/issues?lang=en`);
      const is0 = (Array.isArray(iss) ? iss : iss.issues || [])[0];
      if (is0)
        show(
          `/prices ${first.id}/${is0.id}`,
          await api(`/types/${first.id}/issues/${is0.id}/prices?currency=EUR&lang=it`, { since: TODAY }),
        );
    }
    // controllo settimanale delle monete nuove: si vede cosa risponde Numista al filtro per anno
    const y = +TODAY.slice(0, 4);
    for (const cc of ['IT', 'DE']) {
      try {
        const l = await searchRecent(out[cc], y);
        console.log(`\nMonete ${y}-${y + 1} ${cc} (anni ${modoAnno}): ${l.length}`);
        l.forEach(t => console.log(`  ${t.id} · ${t.title} · ${t.min_year ?? ''}-${t.max_year ?? ''}`));
      } catch (e) {
        console.log(`\nMonete ${y}-${y + 1} ${cc}: ${e.message}`);
      }
    }
    console.log(`\nRichieste usate in rete: ${netCalls}`);
    await saveState();
    return;
  }

  const catalog = {
    v: 2,
    generated: TODAY,
    source: 'Numista (numista.com)',
    complete: false,
    countries: COUNTRIES.map(({ cc, name, flag }) => ({ cc, name, flag })),
    types: [],
  };
  const log = { ricerca: 0, nuove: 0, emissioniAggiornate: 0, schedeAggiornate: 0, valori: 0 };
  const curYear = +TODAY.slice(0, 4);
  // richieste tenute da parte per il controllo settimanale delle monete nuove (uno per ogni lunedì che resta nel mese):
  // senza, il giro del 1° userebbe tutto per i valori e i lunedì dopo non potrebbero più cercare niente
  const lunediRestanti = (() => {
    const d = new Date(TODAY + 'T12:00:00Z'),
      m = d.getUTCMonth();
    let n = 0;
    for (d.setUTCDate(d.getUTCDate() + 1); d.getUTCMonth() === m; d.setUTCDate(d.getUTCDate() + 1))
      if (d.getUTCDay() === 1) n++;
    return n;
  })();
  const RESERVE = lunediRestanti * 80;
  const details = {};
  const groupsById = new Map();
  const typeData = new Map();
  const excluded = [];

  try {
    // 1) ricerca: una volta al mese si rifà tutta, per trovare monete nuove e correzioni
    const searchDue = state.searchMonth !== MONTH && budget() > 250;
    console.log(`\nPaesi${searchDue ? ' (ricerca aggiornata questo mese)' : ''}:`);
    const { out: issuer } = await mapIssuers();
    const candidates = [];
    let c0 = netCalls;
    for (const c of COUNTRIES) {
      try {
        const list = await searchAll(issuer[c.cc], searchDue ? MONTH + '-01' : null);
        list.forEach(t => candidates.push({ cc: c.cc, s: t }));
        console.log(`  ${c.name}: ${list.length} tipi candidati`);
      } catch (e) {
        if (e instanceof QuotaError) quotaHit = true;
        console.log(`  ${c.name}: errore ${e.message}`);
      }
    }
    log.ricerca = netCalls - c0;
    if (searchDue && !quotaHit) state.searchMonth = MONTH;
    // 1b) nei giri settimanali (la ricerca completa del mese è già fatta) si cercano solo le monete dell'anno e del
    //     prossimo: poche richieste, e una moneta nuova arriva nell'app entro una settimana invece che a fine mese
    if (!searchDue && !quotaHit && budget() > 0) {
      c0 = netCalls;
      let inPiu = 0;
      const known = new Set(candidates.map(x => x.s.id));
      for (const c of COUNTRIES) {
        try {
          for (const s of await searchRecent(issuer[c.cc], curYear))
            if (!known.has(s.id)) {
              known.add(s.id);
              candidates.push({ cc: c.cc, s });
              inPiu++;
              console.log(`  novità ${c.name}: ${s.title} (${s.min_year ?? ''})`);
            }
        } catch (e) {
          if (e instanceof QuotaError) {
            quotaHit = true;
            break;
          }
          console.log(`  ${c.name} (novità): ${e.message}`);
          if (e.ignorato || e.status === 400) break;
        }
      }
      log.ricercaNovita = netCalls - c0;
      console.log(
        `Controllo monete nuove ${curYear}-${curYear + 1}: ${log.ricercaNovita} richieste, ${inPiu} ${inPiu === 1 ? 'tipo nuovo' : 'tipi nuovi'}`,
      );
    }
    const seen = new Set();
    const uniq = candidates.filter(x => !seen.has(x.s.id) && seen.add(x.s.id));
    console.log(`\nTipi candidati in totale: ${uniq.length}`);

    // 2) schede: quelle nuove si scaricano subito, quelle vecchie di oltre 6 mesi si rinfrescano a rotazione
    c0 = netCalls;
    for (const { cc, s } of uniq) {
      const q = `/types/${s.id}?lang=it`;
      const isNew = !(await hasCache(q));
      let t;
      // a richieste finite si salta solo la scheda nuova: tutte le altre arrivano dalle copie salvate
      try {
        t = await api(q);
      } catch (e) {
        if (e instanceof QuotaError) quotaHit = true;
        console.log(`  salto ${s.id}: ${e.message}`);
        continue;
      }
      if (isNew) log.nuove++;
      const d = denomOf(t) || denomOf(s);
      const why = !d
        ? 'taglio non riconosciuto'
        : !isEuro(t)
          ? 'non è in euro'
          : EXCLUDE_TYPE.test(typeLabel(t)) || EXCLUDE_TYPE.test(s.title || '')
            ? 'prova/modello/medaglia (' + (t.object_type?.name || t.type || '') + ')'
            : typeof t.weight === 'number' && Math.abs(t.weight - STD_WEIGHT[d]) > 0.6
              ? `peso ${t.weight} g fuori standard`
              : // lato comune colorato (es. "Oranje Geluksdubbeltje" olandese): versione colorata, fuori come le altre colorate
                COLORED.test(t.reverse?.description || '')
                ? 'versione colorata (lato comune colorato)'
                : COLORED_TITLE.test(t.title || '')
                  ? 'versione colorata/ologramma'
                  : null;
      if (why) {
        excluded.push(
          `${cc} ${t.min_year ?? ''}${t.max_year && t.max_year !== t.min_year ? '-' + t.max_year : ''} · ${t.title || s.title} — ${why}`,
        );
        continue;
      }
      const commem =
        COMMEM_TYPE.test(typeLabel(t)) ||
        (d === '2e' &&
          /\(/.test(s.title) &&
          !/map|type|portrait|carta|tipo|ritratto/i.test(s.title) &&
          t.min_year === t.max_year);
      catalog.types.push({
        id: t.id,
        cc,
        d,
        c: commem ? 1 : 0,
        t: t.title || s.title,
        s: subtitleOf(t, commem),
        y: [t.min_year ?? s.min_year, t.max_year ?? s.max_year],
        img: null,
        p: [],
      });
      typeData.set(t.id, t);
    }

    // 3) emissioni (anni, zecche, tirature): per le monete ancora in produzione o recenti ogni mese,
    //    per le altre ogni 6 mesi
    c0 = netCalls;
    const half = daysAgo(182);
    for (const entry of catalog.types) {
      const q = `/types/${entry.id}/issues?lang=en`;
      const active = entry.y[1] == null || entry.y[1] >= curYear - 1 || (!entry.c && entry.y[1] >= curYear - 2);
      let data;
      try {
        data = await api(q, { since: active ? MONTH + '-01' : null });
      } catch (e) {
        if (e instanceof QuotaError) quotaHit = true;
        console.log(`  emissioni di ${entry.id} non disponibili: ${e.message}`);
        continue;
      }
      const issues = Array.isArray(data) ? data : data.issues || [];
      const groups = groupIssues(issues, entry.id, entry.cc);
      groupsById.set(entry.id, groups);
      entry.p = groups.map(g => [`${entry.id}-${g.id}`, g.year, g.label, g.proof, g.mintage]);
      if (entry.p.length) entry.y = [Math.min(...entry.p.map(p => p[1])), Math.max(...entry.p.map(p => p[1]))];
    }
    log.emissioniAggiornate = netCalls - c0;
    catalog.complete = true;

    // 3b) monete ancora senza foto (né della BCE né di Numista con licenza libera): la loro scheda si riprende
    //     ogni mese, così appena su Numista arriva una foto utilizzabile compare anche nell'app
    c0 = netCalls;
    let prevCat = null;
    try {
      prevCat = JSON.parse(await fs.readFile(path.join(OUT, 'catalog.json'), 'utf8'));
    } catch {}
    const senzaFoto = new Set(((prevCat && prevCat.types) || []).filter(t => !(t.img && t.img[0])).map(t => t.id));
    for (const e of catalog.types) {
      if (!senzaFoto.has(e.id)) continue;
      if (budget() <= RESERVE || quotaHit) break;
      try {
        typeData.set(e.id, await api(`/types/${e.id}?lang=it`, { since: MONTH + '-01' }));
      } catch (err) {
        if (err instanceof QuotaError) {
          quotaHit = true;
          break;
        }
        console.log('  ' + err.message);
      }
    }
    log.schedeSenzaFoto = netCalls - c0;

    // 4) rinfresco a rotazione delle schede e delle emissioni più vecchie (max ~12% delle richieste del mese)
    c0 = netCalls;
    const cap = Math.floor(Math.max(0, budget() - RESERVE) * 0.12);
    const stale = [];
    for (const e of catalog.types)
      for (const q of [`/types/${e.id}?lang=it`, `/types/${e.id}/issues?lang=en`]) {
        const c = await cached(q);
        if (c && c.at < half) stale.push({ q, at: c.at, e });
      }
    stale.sort((a, b) => a.at.localeCompare(b.at));
    for (const x of stale) {
      if (netCalls - c0 >= cap || budget() <= RESERVE || quotaHit) break;
      let data;
      try {
        data = await api(x.q, { since: TODAY });
      } catch (e) {
        if (e instanceof QuotaError) break;
        console.log('  ' + e.message);
        continue;
      }
      if (x.q.includes('/issues')) {
        const groups = groupIssues(Array.isArray(data) ? data : data.issues || [], x.e.id, x.e.cc);
        groupsById.set(x.e.id, groups);
        x.e.p = groups.map(g => [`${x.e.id}-${g.id}`, g.year, g.label, g.proof, g.mintage]);
      } else typeData.set(x.e.id, data);
    }
    log.schedeAggiornate = netCalls - c0;

    // 5) valori stimati: con tutto quello che resta del mese, prima i pezzi mai stimati (dai più rari),
    //    poi quelli stimati da più tempo
    c0 = netCalls;
    if (state.pricesOff === MONTH) console.log('Valori stimati: sospesi per questo mese (risposta non riconosciuta).');
    else {
      const todo = [],
        old = [];
      for (const e of catalog.types)
        for (const g of groupsById.get(e.id) || []) {
          const q = `/types/${e.id}/issues/${g.id}/prices?currency=EUR&lang=it`;
          const c = await cached(q);
          // priorità: prima le monete normali (quasi sempre hanno una stima), poi i proof commemorativi,
          // per ultimi i proof dei set (Numista li stima raramente); dentro ogni gruppo dalle più rare
          const rank = g.proof ? (e.c ? 1 : 2) : 0;
          const empty = c && !(c.data && Array.isArray(c.data.prices) && c.data.prices.length);
          if (!c) todo.push({ q, rank, m: g.mintage ?? Infinity });
          else if (c.at < daysAgo(empty ? 365 : 120)) old.push({ q, at: c.at });
        }
      todo.sort((a, b) => a.rank - b.rank || a.m - b.m);
      old.sort((a, b) => a.at.localeCompare(b.at));
      const queue = [...todo, ...old];
      console.log(
        `\nValori stimati: ${todo.length} pezzi mai stimati, ${old.length} da aggiornare · richieste disponibili: ${budget()}`,
      );
      let checked = false;
      for (const x of queue) {
        if (budget() <= RESERVE || quotaHit) break;
        let data;
        try {
          data = await api(x.q, { since: TODAY });
        } catch (e) {
          if (e instanceof QuotaError) break;
          // nessun valore per questo pezzo: lo segno, così non si richiede di nuovo fino al prossimo giro
          if (e.status === 404) {
            await fs.writeFile(cacheFile(x.q), JSON.stringify({ q: x.q, at: TODAY, data: { prices: [] } }));
            continue;
          }
          console.log('  ' + e.message);
          continue;
        }
        if (!checked) {
          checked = true;
          console.log('  prima risposta: ' + JSON.stringify(data).slice(0, 300));
          const ok = data && typeof data === 'object' && (Array.isArray(data.prices) || Array.isArray(data));
          if (!ok) {
            state.pricesOff = MONTH;
            console.log('  ⚠️ formato non riconosciuto: mi fermo per non sprecare richieste');
            break;
          }
        }
      }
    }
    log.valori = netCalls - c0;
  } catch (e) {
    if (!(e instanceof QuotaError)) throw e;
    quotaHit = true;
    console.log('\n⚠️  Quota finita: salvo quello che ho. Il mese prossimo riparte da qui.');
  }
  await saveState();

  // valori stimati salvati (anche quelli dei mesi passati)
  const priceMap = new Map();
  for (const e of catalog.types)
    for (const g of groupsById.get(e.id) || []) {
      const c = await cached(`/types/${e.id}/issues/${g.id}/prices?currency=EUR&lang=it`);
      if (c) {
        const v = pricesOf(c.data);
        if (Object.keys(v).length) priceMap.set(`${e.id}-${g.id}`, { v, at: c.at.slice(0, 7) });
      }
    }
  const catIds = new Set(catalog.types.map(t => t.id));
  for (const e of catalog.types) {
    const t = typeData.get(e.id);
    if (t) details[e.id] = detailOf(t, groupsById.get(e.id) || [], catIds, priceMap);
  }

  const ready = catalog.types.filter(t => t.p.length);
  catalog.types.sort(
    (a, b) =>
      a.cc.localeCompare(b.cc) ||
      a.c - b.c ||
      DORDER.indexOf(a.d) - DORDER.indexOf(b.d) ||
      a.y[0] - b.y[0] ||
      a.id - b.id,
  );
  catalog.stats = {
    tipi: catalog.types.length,
    conAnni: ready.length,
    pezzi: ready.reduce((a, t) => a + t.p.length, 0),
    conValori: priceMap.size,
  };
  // ogni pezzo riunisce una o più emissioni Numista: il codice del pezzo è quello dell'emissione più vecchia.
  // Se in futuro i raggruppamenti cambiano, le monete già segnate con un codice vecchio si ritrovano da qui
  catalog.alias = {};
  for (const e of catalog.types)
    for (const g of groupsById.get(e.id) || [])
      for (const id of g.ids) if (id !== g.id) catalog.alias[`${e.id}-${id}`] = `${e.id}-${g.id}`;
  catalog.numista = { aggiornato: TODAY, ...log };
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
  await fs.writeFile(
    path.join(ROOT, 'scripts', 'esclusi.txt'),
    'Monete scartate dal catalogo e motivo\n\n' + excluded.sort().join('\n') + '\n',
  );
  console.log(`Scartate: ${excluded.length} (elenco in scripts/esclusi.txt)`);
  await fs.writeFile(
    path.join(OUT, 'details.json'),
    JSON.stringify({ v: 1, generated: TODAY, grades: GRADES, types: details }),
  );
  console.log(
    `\nFatto. ${JSON.stringify(catalog.stats)} · ${JSON.stringify(log)} · richieste usate ora: ${netCalls} · restano questo mese: ${budget()}${quotaHit ? ' · quota del mese finita' : ''}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async e => {
    console.error('\nERRORE:', e.message);
    try {
      await saveState();
    } catch {}
    process.exit(1);
  });
}
