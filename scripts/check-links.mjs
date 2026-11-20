// Apre tutti i collegamenti esterni che l'app può mostrare e segnala quelli che non portano a una pagina vera.
// Le pagine BCE si aprono davvero; per Numista (che blocca i programmi con un controllo anti-robot)
// si verifica che ogni link sia identico all'indirizzo ufficiale restituito dall'API di Numista.
import fs from 'node:fs';
import crypto from 'node:crypto';
const cat = JSON.parse(fs.readFileSync('www/data/catalog.json', 'utf8'));
// stessa logica di paginaBce() in src/viste/scheda-moneta.ts
const ECB = 'https://www.ecb.europa.eu/euro/coins/';
const SLUG = {
  '1c': '1cent',
  '2c': '2cents',
  '5c': '5cents',
  '10c': '10cents',
  '20c': '20cents',
  '50c': '50cents',
  '1e': '1euro',
  '2e': '2euro',
};
const pg = cat.ecbPagine || { it: [], en: [] };
const ecbUrl = t =>
  !t.c
    ? ECB + SLUG[t.d] + '/html/index.it.html'
    : pg.it.includes(t.y[0])
      ? `${ECB}comm/html/comm_${t.y[0]}.it.html`
      : pg.en.includes(t.y[0])
        ? `${ECB}comm/html/comm_${t.y[0]}.en.html`
        : ECB + 'comm/html/index.it.html';
const urls = [...new Set([...cat.types.map(ecbUrl), 'https://it.numista.com'])];
let bad = 0;
for (const u of urls) {
  let st = 0;
  try {
    st = (
      await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
    ).status;
  } catch (e) {
    st = 'errore ' + e.message;
  }
  const ok = st === 200 || (u.includes('numista') && st === 403); // 403 = controllo anti-robot di Numista, la pagina c'è
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'NO '} ${st}  ${u}`);
}
const cf = q => 'scripts/cache/' + crypto.createHash('sha1').update(q).digest('hex').slice(0, 20) + '.json';
let nOk = 0;
for (const t of cat.types) {
  const f = cf(`/types/${t.id}?lang=it`);
  const u = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).data.url : null;
  if (u === `https://it.numista.com/${t.id}`) nOk++;
  else {
    bad++;
    console.log(`NO  Numista ${t.id}: indirizzo ufficiale ${u}`);
  }
}
console.log(
  `\nPagine BCE controllate: ${urls.length - 1}. Link Numista uguali all'indirizzo ufficiale: ${nOk}/${cat.types.length}.`,
);
if (bad) {
  console.log(`❌ ${bad} collegamenti non funzionano`);
  process.exit(1);
}
console.log('✅ Tutti i collegamenti funzionano');
