// Indice dei dati dell'app (catalogo, schede, foto), pubblicati anche DA SOLI sulla pagina di download:
// l'app installata li scarica senza bisogno di installare una versione nuova.
// - rev: numero che cresce a ogni cambiamento vero dei dati (se catalogo, schede e foto sono identici resta uguale)
// - schema: la "struttura" dei dati. Se un giorno cambia in modo che le app vecchie non la sappiano leggere,
//   si aumenta qui E nell'app (SCHEMA_DATI in src/catalogo/dati.ts, SCHEMA_DATI in native/ControlloAggiornamenti.java):
//   le app vecchie allora ignorano i dati nuovi e chiedono di aggiornare l'app.
// - note: cosa è cambiato rispetto ai dati di prima (per la notifica)
// Uso: node scripts/indice-dati.mjs [catalogo-di-prima.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 1;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'www', 'data');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

const catTxt = await fs.readFile(path.join(DATA, 'catalog.json'));
const detTxt = await fs.readFile(path.join(DATA, 'details.json')).catch(() => Buffer.from(''));
const cat = JSON.parse(catTxt);
const img = [...new Set(cat.types.flatMap(t => (t.img || []).filter(x => x && !/^https?:|^data:/.test(x))))].sort();
const firma = sha(Buffer.concat([catTxt, detTxt, Buffer.from(img.join('|'))]));

let prima = null;
try {
  prima = JSON.parse(await fs.readFile(path.join(DATA, 'indice.json'), 'utf8'));
} catch {}

const stat = {
  monete: cat.types.length,
  pezzi: cat.types.reduce((a, t) => a + t.p.length, 0),
  foto: cat.types.filter(t => t.img && t.img[0]).length,
};
let note = (prima && prima.note) || '';
let rev = (prima && prima.rev) || 0;
if (!prima || prima.firma !== firma || prima.schema !== SCHEMA) {
  const d = new Date();
  rev = Math.max(rev + 1, +d.toISOString().replace(/\D/g, '').slice(0, 12)); // AAAAMMGGhhmm
  // cosa è cambiato rispetto al catalogo di prima
  let old = null;
  try {
    if (process.argv[2]) old = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  } catch {}
  const parti = [];
  if (old) {
    const ids = new Set(old.types.map(t => t.id)),
      conFoto = new Set(old.types.filter(t => t.img && t.img[0]).map(t => t.id));
    const nuove = cat.types.filter(t => !ids.has(t.id)).length;
    const foto = cat.types.filter(t => ids.has(t.id) && t.img && t.img[0] && !conFoto.has(t.id)).length;
    const pezzi = stat.pezzi - old.types.reduce((a, t) => a + t.p.length, 0);
    if (nuove > 0) parti.push(`${nuove} ${nuove === 1 ? 'moneta nuova' : 'monete nuove'}`);
    if (foto > 0) parti.push(`${foto} ${foto === 1 ? 'foto nuova' : 'foto nuove'}`);
    if (pezzi > 0) parti.push(`${pezzi} ${pezzi === 1 ? 'anno o zecca in più' : 'anni e zecche in più'}`);
  }
  note = parti.length ? parti.join(', ') : 'Informazioni e foto aggiornate';
}
const indice = {
  rev,
  schema: SCHEMA,
  firma,
  data: new Date().toISOString().slice(0, 10),
  note,
  stat,
  file: { catalogo: 'catalog.json', schede: 'details.json' },
  img,
};
await fs.writeFile(path.join(DATA, 'indice.json'), JSON.stringify(indice));
console.log(
  `Indice dei dati: rev ${rev} (${prima && prima.rev === rev ? 'invariato' : 'nuovo'}) · schema ${SCHEMA} · ${img.length} foto · ${note}`,
);
