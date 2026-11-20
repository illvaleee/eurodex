// Scarica le pagine della Banca centrale europea con le immagini delle monete euro
// (lati nazionali di tutte le serie + 2 euro commemorativi) e le salva in scripts/ecb-cache/.
// Fase 2 (match + immagini) in scripts/ecb-images.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'scripts', 'ecb-cache', 'pages');
const UA = 'CollezioneEuro/1.0 (app privata, uso personale)';
const BASE = 'https://www.ecb.europa.eu/euro/coins';
const DENOMS = ['1cent', '2cents', '5cents', '10cents', '20cents', '50cents', '1euro', '2euro'];
const year = new Date().getFullYear();
const pages = [
  ['common', `${BASE}/common/html/index.en.html`],
  ...DENOMS.map(d => [d, `${BASE}/${d}/html/index.en.html`]),
  ['comm_index', `${BASE}/comm/html/index.en.html`],
  ...Array.from({ length: year - 2003 }, (_, i) => [`comm_${2004 + i}`, `${BASE}/comm/html/comm_${2004 + i}.en.html`]),
];
for (const [n, u] of [...pages]) pages.push([n + '.it', u.replace('.en.html', '.it.html')]);
await fs.mkdir(DIR, { recursive: true });
for (const [name, url] of pages) {
  const file = path.join(DIR, name + '.html');
  // le pagine dei tagli e dei commemorativi recenti si riscaricano sempre (escono serie e monete nuove)
  const base = name.replace(/\.it$/, '');
  const always = DENOMS.includes(base) || base === 'common' || base === `comm_${year}` || base === `comm_${year - 1}`;
  if (process.env.REFRESH !== '1' && !always) {
    try {
      await fs.access(file);
      continue;
    } catch {}
  }
  // se il sito non risponde si tiene la pagina salvata l'ultima volta
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    console.log(`${res.status} ${url}`);
    const text = res.ok ? await res.text() : '';
    // una pagina vera della BCE contiene le immagini delle monete: una pagina vuota o di errore non sostituisce quella buona
    if (res.ok && /<img/i.test(text) && text.length > 5000)
      await fs.writeFile(file, text.replace(/ECB\.clientTimeError = \d+/, 'ECB.clientTimeError = 0'));
    else if (res.ok) console.log('  pagina incompleta, tengo quella salvata');
  } catch (e) {
    console.log(`  non raggiungibile (${e.message}): tengo la pagina salvata ${url}`);
  }
  await new Promise(r => setTimeout(r, 400));
}
