/**
 * Caricamento su Cloud Storage per Firebase (passo 5 dell'accesso, parte B1): l'APK con rilasci/version.json, e il
 * catalogo in dati/ (docs/progetto-accesso-su-approvazione.md, §9). Le app li leggono con l'SDK di Firebase, quindi
 * passano dalle regole di Storage; il workflow invece scrive con un gettone di Google di un'ora, che vale solo per la
 * sua cartella (rilasci/ o dati/).
 *
 * - I file si caricano uno per uno, per nome, ognuno controllato col suo MD5. Gli indici (version.json, indice.json)
 *   vanno per ultimi: la funzione avvisaNovita parte quando arriva l'indice, e a quel punto il resto c'è già
 *   (revisione di Claude 3 sul piano, punto 5).
 * - Si tolgono solo file col nome noto, presi dall'indice di prima o dai suoi metadati: non serve elencare il bucket.
 *   Si tiene sempre anche quello che indicava l'indice di prima, per chi l'ha appena letto.
 * - Mai `firebaseStorageDownloadTokens`: senza, non esiste un link che scavalchi le regole di Storage.
 *
 * Uso (apk.yml e catalogo.yml), col gettone di google-github-actions/auth in STORAGE_TOKEN:
 *   node scripts/carica-storage.mjs apk BUCKET CollezioneEuro.apk pub/version.json        (prima della pagina)
 *   node scripts/carica-storage.mjs versione BUCKET CollezioneEuro.apk pub/version.json   (dopo la pagina)
 *   node scripts/carica-storage.mjs dati BUCKET www/data
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nomiPubblicazione } from './nomi-pubblicazione.mjs';

const API = 'https://storage.googleapis.com';
// solo nelle prove dell'APK con gli emulatori (passo 5, D): l'emulatore di Storage su questo PC, mai fuori
const EMULATORE = /^(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const APK = /^CollezioneEuro-1\.0\.[0-9]{1,9}\.apk$/;
const IMG = /^img\/[0-9a-f]{1,64}\.webp$/;
const DATI = /^(catalog|details)-[0-9]{1,14}\.json$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** MD5 in base64, come lo restituisce Cloud Storage (md5Hash). */
export const md5 = dati => createHash('md5').update(dati).digest('base64');

/** Il nome dell'APK scritto in version.json: diventa il nome del file su Storage, quindi solo della forma solita. */
function nomeApk(versione) {
  if (!versione || typeof versione.apk !== 'string' || !APK.test(versione.apk)) {
    throw new Error("version.json: nome dell'APK non valido");
  }
  return versione.apk;
}

/** Prima l'APK, da solo: version.json va dopo la pagina di download (apk.yml), così nessun avviso arriva prima. */
export function pianoApk(versione) {
  const apk = nomeApk(versione);
  return {
    carica: [{ nome: `rilasci/${apk}`, sorgente: 'apk', tipo: 'application/vnd.android.package-archive' }],
    cancella: [],
  };
}

/**
 * Poi version.json. L'APK di prima resta, per chi ha appena letto il version.json vecchio; quello di due versioni fa
 * si toglie (il suo nome è nei metadati del version.json di prima, alla voce `apk_precedente`).
 */
export function pianoVersione(versione, precedente, metaPrecedente) {
  const apk = nomeApk(versione);
  const prima = typeof precedente?.apk === 'string' && APK.test(precedente.apk) ? precedente.apk : null;
  const vecchio = metaPrecedente?.apk_precedente;
  const via = typeof vecchio === 'string' && APK.test(vecchio) && vecchio !== apk && vecchio !== prima;
  return {
    carica: [
      {
        nome: 'rilasci/version.json',
        sorgente: 'version',
        tipo: 'application/json',
        cache: 'no-cache',
        metadati: prima && prima !== apk ? { apk_precedente: prima } : {},
      },
    ],
    cancella: via ? [`rilasci/${vecchio}`] : [],
  };
}

/**
 * L'indice nuovo viene dai dati scaricati (codice di terzi): gli stessi controlli di catalogo.yml, perché la nota
 * finisce nelle notifiche e i nomi delle foto diventano nomi di file.
 */
export function controllaIndice(j) {
  const nota = j?.note ?? '';
  const testoOk =
    typeof nota === 'string' && nota.length <= 300 && !nota.includes('://') && !/[\p{Cc}\p{Cf}]/u.test(nota);
  const img = j?.img ?? [];
  const ok =
    j &&
    /^[0-9]{1,14}$/.test(String(j.rev)) &&
    Number.isInteger(j.schema ?? 1) &&
    (j.schema ?? 1) > 0 &&
    (j.schema ?? 1) < 1000 &&
    testoOk &&
    Array.isArray(img) &&
    img.length <= 20000 &&
    img.every(x => typeof x === 'string' && IMG.test(x));
  if (!ok) throw new Error('indice.json: rev, schema, nota o nomi delle foto non validi');
}

/**
 * Il catalogo: le foto nuove (i nomi cambiano quando cambia la foto, quindi basta guardare l'elenco di prima), poi
 * catalogo e schede col numero nel nome, poi indice.json. Dopo l'indice si tolgono le foto che non ci sono più e i
 * file di due indici fa (i loro nomi sono nei metadati dell'indice di prima, alla voce `prima`).
 * Se Storage ha già questi dati (stesso rev, nomi validi) non si carica niente, e non parte nessuna notifica.
 */
export function pianoDati(indice, precedente, metaPrecedente, adesso = Date.now()) {
  controllaIndice(indice);
  const { numero, tenere, stessi } = nomiPubblicazione(String(indice.rev), precedente, adesso);
  if (!/^[0-9]{1,9}$/.test(numero)) throw new Error('numero dei file non valido');
  if (stessi) return { stessi: true, numero, carica: [], cancella: [], indice: null };
  const file = { catalogo: `catalog-${numero}.json`, schede: `details-${numero}.json` };
  const img = indice.img ?? [];
  const primaImg = Array.isArray(precedente?.img)
    ? precedente.img.filter(x => typeof x === 'string' && IMG.test(x))
    : [];
  const giaCaricate = new Set(primaImg);
  const restano = new Set([file.catalogo, file.schede, ...tenere]);
  const nuove = new Set(img);
  const vecchi = typeof metaPrecedente?.prima === 'string' ? metaPrecedente.prima.split(' ') : [];
  return {
    stessi: false,
    numero,
    indice: { ...indice, file },
    carica: [
      ...img.filter(x => !giaCaricate.has(x)).map(x => ({ nome: `dati/${x}`, sorgente: x, tipo: 'image/webp' })),
      { nome: `dati/${file.catalogo}`, sorgente: 'catalog.json', tipo: 'application/json' },
      { nome: `dati/${file.schede}`, sorgente: 'details.json', tipo: 'application/json' },
      {
        nome: 'dati/indice.json',
        sorgente: 'indice',
        tipo: 'application/json',
        cache: 'no-cache',
        metadati: { prima: tenere.join(' ') },
      },
    ],
    cancella: [
      ...primaImg.filter(x => !nuove.has(x)).map(x => `dati/${x}`),
      ...vecchi.filter(x => DATI.test(x) && !restano.has(x)).map(x => `dati/${x}`),
    ],
  };
}

const pausa = ms => new Promise(r => setTimeout(r, ms));

/** Una richiesta, ripetuta fino a 4 volte se la rete cade o Storage risponde 429 o 5xx (attese di 1, 2 e 4 s). */
async function richiesta(ctx, url, opzioni) {
  const aspetta = ctx.aspetta ?? pausa;
  for (let i = 1; ; i++) {
    let r;
    try {
      r = await ctx.fetch(url, { ...opzioni, headers: { Authorization: `Bearer ${ctx.token}`, ...opzioni?.headers } });
    } catch (e) {
      if (i >= 4) throw e;
      await aspetta(1000 * 2 ** (i - 1));
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && i < 4) {
      await aspetta(1000 * 2 ** (i - 1));
      continue;
    }
    return r;
  }
}

/**
 * Dove sta Cloud Storage: quello vero, oppure l'emulatore di Firebase su questo PC con STORAGE_EMULATOR_HOST, come
 * negli SDK (le prove dell'APK riempiono così lo Storage finto, con gli stessi nomi e lo stesso ordine). Un indirizzo
 * fuori dal PC non si accetta e lo script si ferma: nei workflow il gettone è vero (revisione di Claude 2).
 */
export function indirizzoApi(env) {
  const e = env.STORAGE_EMULATOR_HOST;
  if (e === undefined || e === '') return API;
  if (!EMULATORE.test(e)) throw new Error('STORAGE_EMULATOR_HOST: solo 127.0.0.1 o localhost, con la porta');
  return `http://${e}`;
}

const oggetto = (ctx, nome) =>
  `${ctx.api ?? API}/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(nome)}`;

/** Un file già su Storage, come JSON, con i suoi metadati; { dati: null } se non c'è o non si legge come JSON. */
export async function leggi(ctx, nome) {
  const m = await richiesta(ctx, oggetto(ctx, nome));
  if (m.status === 404) return { dati: null, metadati: {} };
  if (!m.ok) throw new Error(`lettura di ${nome}: ${m.status}`);
  const metadati = (await m.json()).metadata ?? {};
  const c = await richiesta(ctx, `${oggetto(ctx, nome)}?alt=media`);
  if (c.status === 404) return { dati: null, metadati: {} };
  if (!c.ok) throw new Error(`lettura di ${nome}: ${c.status}`);
  try {
    return { dati: JSON.parse(await c.text()), metadati };
  } catch {
    return { dati: null, metadati };
  }
}

async function carica(ctx, voce, dati) {
  const meta = { name: voce.nome, contentType: voce.tipo };
  if (voce.cache) meta.cacheControl = voce.cache;
  if (voce.metadati && Object.keys(voce.metadati).length) meta.metadata = voce.metadati;
  const confine = `eurodex-${randomUUID()}`;
  const corpo = Buffer.concat([
    Buffer.from(`--${confine}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${confine}\r\nContent-Type: ${voce.tipo}\r\n\r\n`),
    dati,
    Buffer.from(`\r\n--${confine}--\r\n`),
  ]);
  const r = await richiesta(
    ctx,
    `${ctx.api ?? API}/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=multipart`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${confine}` },
      body: corpo,
    },
  );
  if (!r.ok) throw new Error(`caricamento di ${voce.nome}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const fatto = await r.json();
  if (fatto.md5Hash !== md5(dati)) throw new Error(`caricamento di ${voce.nome}: MD5 diverso da quello del file`);
}

/** Esegue il piano: i caricamenti nell'ordine (si ferma al primo che non va), poi le cancellazioni. */
export async function esegui(piano, ctx, sorgente) {
  for (const voce of piano.carica) await carica(ctx, voce, sorgente(voce.sorgente));
  for (const nome of piano.cancella) {
    const r = await richiesta(ctx, oggetto(ctx, nome), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`cancellazione di ${nome}: ${r.status}`);
  }
}

/** Il programma: `ambiente` serve solo alle prove, per dare un Cloud Storage finto. */
export async function principale([modo, bucket, ...file], ambiente = { fetch, env: process.env }) {
  const token = ambiente.env.STORAGE_TOKEN;
  if (!token) throw new Error('manca STORAGE_TOKEN');
  if (!BUCKET.test(bucket ?? '')) throw new Error('nome del bucket non valido');
  const ctx = { bucket, token, fetch: ambiente.fetch, aspetta: ambiente.aspetta, api: indirizzoApi(ambiente.env) };
  if (modo === 'apk' || modo === 'versione') {
    const [apk, versione] = file;
    const v = JSON.parse(readFileSync(versione, 'utf8'));
    const dati = readFileSync(apk);
    if (v.size !== dati.length) throw new Error("version.json: la dimensione non è quella dell'APK");
    let piano;
    if (modo === 'apk') {
      piano = pianoApk(v);
    } else {
      // version.json annuncia l'APK: prima di caricarlo, l'APK su Storage dev'essere proprio questo
      const su = await richiesta(ctx, oggetto(ctx, `rilasci/${nomeApk(v)}`));
      if (!su.ok || (await su.json()).md5Hash !== md5(dati))
        throw new Error("su Storage manca l'APK di questo version.json");
      const prima = await leggi(ctx, 'rilasci/version.json');
      piano = pianoVersione(v, prima.dati, prima.metadati);
    }
    await esegui(piano, ctx, s => (s === 'apk' ? dati : readFileSync(versione)));
    console.log(
      `Su Storage: ${piano.carica.map(c => c.nome).join(', ')}; tolti: ${piano.cancella.join(', ') || 'nessuno'}`,
    );
  } else if (modo === 'dati') {
    const [cartella] = file;
    const indice = JSON.parse(readFileSync(join(cartella, 'indice.json'), 'utf8'));
    const prima = await leggi(ctx, 'dati/indice.json');
    const piano = pianoDati(indice, prima.dati, prima.metadati);
    if (piano.stessi) {
      console.log(`Storage ha già questi dati (rev ${indice.rev}): niente da caricare, nessuna notifica`);
      return;
    }
    await esegui(piano, ctx, s =>
      s === 'indice' ? Buffer.from(JSON.stringify(piano.indice)) : readFileSync(join(cartella, s)),
    );
    console.log(
      `Su Storage: ${piano.carica.length} file (dati ${indice.rev}, numero ${piano.numero}); tolti: ${piano.cancella.length}`,
    );
  } else {
    throw new Error('uso: carica-storage.mjs apk|versione|dati BUCKET ...');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principale(process.argv.slice(2)).catch(e => {
    console.log(`::error title=Storage::${e.message}`);
    process.exit(1);
  });
}
