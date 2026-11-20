// Controllo del catalogo prima di salvarlo (e quindi prima che finisca nell'app).
// Uso: node scripts/check-catalog.mjs [catalogo-precedente.json]
// 1) regole che devono valere sempre (codici unici, anni validi, foto presenti, ecc.)
// 2) se c'è il catalogo precedente: niente cali improvvisi (paesi spariti, monete o foto perse)
// Se qualcosa non va esce con errore: il workflow allora non salva il catalogo nuovo e l'app tiene quello di prima.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'www', 'data');
const cat = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
const det = JSON.parse(fs.readFileSync(path.join(DATA, 'details.json'), 'utf8'));
const prevFile = process.argv[2];
let prev = null;
try {
  if (prevFile) prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
} catch {
  console.log('Catalogo precedente non leggibile: controllo solo le regole.');
}

const errors = [],
  warns = [];
const err = m => errors.push(m),
  warn = m => warns.push(m);
const DENOMS = ['1c', '2c', '5c', '10c', '20c', '50c', '1e', '2e'];
const maxYear = new Date().getFullYear() + 1;
const imgs = new Set(fs.readdirSync(path.join(DATA, 'img')));

if (!Array.isArray(cat.countries) || cat.countries.length !== 25) err(`paesi: ${cat.countries?.length} invece di 25`);
const ccs = new Set((cat.countries || []).map(c => c.cc));
if (!Array.isArray(cat.types) || cat.types.length < 500) err(`tipi di moneta: ${cat.types?.length}`);
const ids = new Set(),
  keys = new Set();
for (const t of cat.types || []) {
  const name = `${t.cc} ${t.d} ${t.y?.join('-')} (${t.id})`;
  if (typeof t.id !== 'number' || ids.has(t.id)) err(`codice tipo doppio o non valido: ${name}`);
  ids.add(t.id);
  if (!ccs.has(t.cc)) err(`paese sconosciuto: ${name}`);
  if (!DENOMS.includes(t.d)) err(`taglio sconosciuto: ${name}`);
  if (t.c && t.d !== '2e') err(`commemorativa non da 2 euro: ${name}`);
  if (!t.t || typeof t.t !== 'string') err(`titolo mancante: ${name}`);
  if (!Array.isArray(t.p) || !t.p.length) err(`nessun pezzo: ${name}`);
  if (!Array.isArray(t.y) || !(t.y[0] >= 1999 && t.y[1] <= maxYear && t.y[0] <= t.y[1]))
    err(`anni non validi: ${name}`);
  const seen = new Set();
  for (const p of t.p || []) {
    const [k, y, label, proof, mint] = p;
    if (typeof k !== 'string' || !k.startsWith(t.id + '-') || keys.has(k))
      err(`codice pezzo doppio o non valido: ${name} ${k}`);
    keys.add(k);
    if (!Number.isInteger(y) || y < 1999 || y > maxYear) err(`anno pezzo non valido: ${name} ${k} ${y}`);
    if (t.y && (y < t.y[0] || y > t.y[1])) err(`anno pezzo fuori dagli anni della moneta: ${name} ${k} ${y}`);
    if (typeof label !== 'string') err(`etichetta non valida: ${name} ${k}`);
    if (proof !== 0 && proof !== 1) err(`proof non valido: ${name} ${k}`);
    if (mint != null && !(typeof mint === 'number' && mint >= 0)) err(`tiratura non valida: ${name} ${k}`);
    const sig = `${y}|${label}|${proof}`;
    if (seen.has(sig))
      err(`due pezzi uguali (stesso anno, stessa scritta): ${name} ${y} "${label}"${proof ? ' proof' : ''}`);
    seen.add(sig);
  }
  if (t.img != null) {
    if (!Array.isArray(t.img) || t.img.length !== 2) err(`foto in formato errato: ${name}`);
    else
      for (const f of t.img)
        if (f && !imgs.has(f.replace(/^img\//, ''))) err(`foto mancante nel pacchetto: ${name} ${f}`);
  }
  if (!t.img?.[0] && !t.pf && !t.k) warn(`senza foto: ${name}`);
  if (!det.types[t.id]) err(`scheda dettagli mancante: ${name}`);
}
for (const [a, b] of Object.entries(cat.alias || {}))
  if (!keys.has(b)) err(`alias verso un pezzo inesistente: ${a} → ${b}`);
for (const c of ccs) if (!(cat.types || []).some(t => t.cc === c)) err(`paese senza monete: ${c}`);

if (prev && Array.isArray(prev.types)) {
  const count = c => ({
    tipi: c.types.length,
    pezzi: c.types.reduce((a, t) => a + t.p.length, 0),
    foto: c.types.filter(t => t.img?.[0]).length,
    titoli: c.types.filter(t => t.ti).length,
    descrizioni: c.types.filter(t => t.di != null).length,
  });
  const a = count(prev),
    b = count(cat);
  for (const k of Object.keys(a)) if (b[k] < a[k] * 0.97) err(`calo di ${k}: da ${a[k]} a ${b[k]}`);
  for (const c of ccs) {
    const pa = prev.types.filter(t => t.cc === c).length,
      pb = cat.types.filter(t => t.cc === c).length;
    if (pb < pa * 0.9) err(`calo di monete per ${c}: da ${pa} a ${pb}`);
  }
  // pezzi che c'erano e ora non ci sono più (né direttamente né con un alias): chi li aveva segnati li perderebbe di vista
  const alias = cat.alias || {};
  const lost = prev.types.flatMap(t => t.p.map(p => p[0])).filter(k => !keys.has(k) && !keys.has(alias[k]));
  if (lost.length)
    (lost.length > 30 ? err : warn)(
      `pezzi spariti rispetto al catalogo precedente: ${lost.length} (${lost.slice(0, 10).join(', ')}${lost.length > 10 ? '…' : ''})`,
    );
  console.log('Prima:', JSON.stringify(a), '\nAdesso:', JSON.stringify(b));
}

warns.slice(0, 40).forEach(w => console.log('  avviso: ' + w));
if (warns.length > 40) console.log(`  … altri ${warns.length - 40} avvisi`);
if (errors.length) {
  console.log(`\n❌ ${errors.length} problemi nel catalogo nuovo:`);
  errors.slice(0, 60).forEach(e => console.log('  ' + e));
  process.exit(1);
}
console.log(`\n✅ Catalogo a posto: ${cat.types.length} monete, ${keys.size} pezzi.`);
