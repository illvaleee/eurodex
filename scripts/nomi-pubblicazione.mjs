/**
 * Il numero nei nomi dei file del catalogo sulla pagina di download (catalog-N.json, details-N.json) e i file da tenere.
 *
 * N ha al massimo 9 cifre: dalla 1.0.81 le app accettano solo questi nomi (R20: src/catalogo/nomi-dati.ts e
 * native/ScaricaDati.java), mentre rev ne ha 12 (AAAAMMGGhhmm). N sono i minuti dal 1° gennaio 2020: cresce a ogni
 * pubblicazione e resta di 9 cifre per quasi duemila anni. Se l'indice già pubblicato ha gli stessi dati (stesso rev)
 * si riusano i suoi nomi: una seconda pubblicazione degli stessi dati non cambia niente.
 * Si tengono anche i file dell'indice di prima, per chi l'ha appena letto.
 *
 * Uso (catalogo.yml): node scripts/nomi-pubblicazione.mjs REV INDICE_PUBBLICATO  →  "N file-da-tenere..."
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INIZIO = Date.UTC(2020, 0, 1);
/** i nomi dell'indice pubblicato si tengono solo se sono di questa forma (anche quelli vecchi, a 12 cifre) */
const DA_TENERE = /^(catalog|details)-[0-9]{1,14}\.json$/;

export function nomiPubblicazione(rev, pubblicato, adesso = Date.now()) {
  const nuovo = String(Math.floor((adesso - INIZIO) / 60000));
  const file = pubblicato && typeof pubblicato === 'object' ? pubblicato.file : null;
  const f = file && typeof file === 'object' ? file : {};
  const tenere = [f.catalogo, f.schede].filter(x => typeof x === 'string' && DA_TENERE.test(x));
  const m = typeof f.catalogo === 'string' ? /^catalog-([0-9]{1,9})\.json$/.exec(f.catalogo) : null;
  const stessi = m !== null && f.schede === `details-${m[1]}.json` && String(pubblicato.rev) === String(rev);
  return { numero: stessi ? m[1] : nuovo, tenere };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let pubblicato = null;
  try {
    pubblicato = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  } catch {
    // prima pubblicazione, o indice illeggibile: numero nuovo e niente da tenere
  }
  const { numero, tenere } = nomiPubblicazione(process.argv[2], pubblicato);
  if (!/^[0-9]{1,9}$/.test(numero)) process.exit(1);
  console.log([numero, ...tenere].join(' '));
}
