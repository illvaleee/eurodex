import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { RAW_DOWNLOAD } from '../core/costanti';
import { avvisa } from '../core/errori';
import { leggiFresco } from '../core/rete';
import { nativo } from '../nativo/plugin';
import type { CatalogoGrezzo, Schede } from './tipi';

/**
 * Dati aggiornabili senza installare una versione nuova: catalogo, schede e foto sono pubblicati anche da soli
 * (pagina di download, cartella dati/). L'app scarica solo quello che le manca, lo salva nel telefono e lo usa al
 * posto di quello dentro l'APK. Una versione nuova dell'app serve solo quando cambia la struttura dei dati (schema).
 */

/** Struttura dei dati che questa versione sa leggere (vedi scripts/indice-dati.mjs). */
export const SCHEMA_DATI = 1;
const URL_DATI = `${RAW_DOWNLOAD}dati/`;

export interface IndiceDati {
  rev: number;
  schema: number;
  data?: string;
  note?: string;
  img?: string[];
  file: { catalogo: string; schede: string };
}

interface StatoDati {
  rev: number;
  schema: number;
  img?: string[];
  data?: string;
  note?: string;
  /** File di catalogo e schede di questi dati (senza: catalogo.json e schede.json, come li scrive la parte Android). */
  cat?: string;
  sch?: string;
}

export const dati = {
  rev: 0,
  /** I dati in uso sono quelli scaricati (non quelli dentro l'APK). */
  locale: false,
  /** Indirizzo da cui la pagina legge le foto scaricate. */
  base: '',
  img: new Set<string>(),
  inCorso: false,
  /** Ci sono dati pubblicati che solo una versione nuova dell'app sa leggere. */
  serveAppNuova: false,
  note: '',
  /** File delle schede dei dati in uso. */
  fileSchede: 'schede.json',
  /** Numero dei dati dentro l'APK. */
  revApk: 0,
};

/** Foto che sono dentro l'APK (quelle del catalogo con cui l'app è stata installata). */
let fotoApk = new Set<string>();
export function impostaFotoApk(elenco: readonly string[]): void {
  fotoApk = new Set(elenco);
}

async function leggiDato<T>(nome: string): Promise<T> {
  const r = await Filesystem.readFile({ path: `dati/${nome}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return JSON.parse(r.data as string) as T;
}

async function scriviDato(nome: string, testo: string): Promise<void> {
  await Filesystem.writeFile({
    path: `dati/${nome}`,
    data: testo,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

async function baseDati(): Promise<string> {
  try {
    const u = await Filesystem.getUri({ path: 'dati', directory: Directory.Data });
    return Capacitor.convertFileSrc(u.uri).replace(/\/?$/, '/');
  } catch {
    return '';
  }
}

function base64(b: Blob): Promise<string> {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => {
      ok(typeof r.result === 'string' ? (r.result.split(',')[1] ?? '') : '');
    };
    r.onerror = () => {
      ko(r.error ?? new Error('lettura'));
    };
    r.readAsDataURL(b);
  });
}

async function scaricaFoto(nome: string): Promise<boolean> {
  try {
    const f = await fetch(URL_DATI + nome);
    if (!f.ok) return false;
    await Filesystem.writeFile({
      path: `dati/${nome}`,
      data: await base64(await f.blob()),
      directory: Directory.Data,
      recursive: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** All'avvio: se nel telefono ci sono dati più recenti di quelli dentro l'APK, si usano quelli. */
export async function datiLocali(revApk: number): Promise<CatalogoGrezzo | null> {
  if (!nativo()) return null;
  try {
    const st = await leggiDato<StatoDati>('stato.json');
    if (st.schema > SCHEMA_DATI || !(st.rev > revApk)) return null;
    const cat = await leggiDato<CatalogoGrezzo>(st.cat ?? 'catalogo.json');
    Object.assign(dati, {
      rev: st.rev,
      locale: true,
      img: new Set(st.img ?? []),
      base: await baseDati(),
      note: st.note ?? '',
      fileSchede: st.sch ?? 'schede.json',
    });
    return cat;
  } catch {
    return null;
  }
}

export type EsitoAggiornamento =
  | { tipo: 'nuovi'; catalogo: CatalogoGrezzo; indice: IndiceDati }
  | { tipo: 'foto' }
  | { tipo: 'niente' }
  | { tipo: 'serveAppNuova' };

/** Controlla se sono stati pubblicati dati nuovi; se sì li scarica e li salva (l'uso lo decide chi chiama). */
export async function scaricaDatiNuovi(): Promise<EsitoAggiornamento> {
  if (!nativo() || dati.inCorso) return { tipo: 'niente' };
  dati.inCorso = true;
  try {
    let ix: IndiceDati;
    try {
      ix = await leggiFresco<IndiceDati>('dati/indice.json');
    } catch {
      return { tipo: 'niente' };
    }
    if (!(ix.rev > dati.rev)) {
      // stessi dati: si recuperano solo le foto che un aggiornamento precedente non era riuscito a scaricare
      if (!dati.locale || ix.rev !== dati.rev) return { tipo: 'niente' };
      const mancano = (ix.img ?? []).filter(x => !fotoApk.has(x) && !dati.img.has(x));
      for (const x of mancano) if (await scaricaFoto(x)) dati.img.add(x);
      if (!mancano.length) return { tipo: 'niente' };
      const st = await leggiDato<StatoDati>('stato.json');
      st.img = [...dati.img];
      await scriviDato('stato.json', JSON.stringify(st));
      return { tipo: 'foto' };
    }
    if (ix.schema > SCHEMA_DATI) {
      dati.serveAppNuova = true;
      return { tipo: 'serveAppNuova' };
    }
    // 1) catalogo e schede
    const [rc, rs] = await Promise.all([
      fetch(`${URL_DATI}${ix.file.catalogo}?r=${ix.rev}`),
      fetch(`${URL_DATI}${ix.file.schede}?r=${ix.rev}`),
    ]);
    if (!rc.ok || !rs.ok) return { tipo: 'niente' };
    const testoCatalogo = await rc.text();
    const testoSchede = await rs.text();
    const cat = JSON.parse(testoCatalogo) as CatalogoGrezzo;
    if (!cat.types.length) return { tipo: 'niente' };
    // 2) foto che mancano: quelle che non sono né nell'APK né già scaricate (4 alla volta)
    const nelNuovo = new Set(ix.img ?? []);
    const servono = [...nelNuovo].filter(x => !fotoApk.has(x) && !dati.img.has(x));
    const prese = new Set([...dati.img].filter(x => nelNuovo.has(x)));
    for (let i = 0; i < servono.length; i += 4) {
      const gruppo = servono.slice(i, i + 4);
      const esiti = await Promise.all(gruppo.map(scaricaFoto));
      gruppo.forEach((x, k) => {
        if (esiti[k]) prese.add(x);
      });
    }
    // 3) catalogo e schede in file nuovi (con il numero dei dati), e per ultimo lo stato che li indica: se l'app si
    //    chiude a metà, restano in uso i dati di prima, interi
    const precedente = await leggiDato<StatoDati>('stato.json').catch(() => null);
    const nomeCat = `catalogo-${String(ix.rev)}.json`;
    const nomeSch = `schede-${String(ix.rev)}.json`;
    await scriviDato(nomeCat, testoCatalogo);
    await scriviDato(nomeSch, testoSchede);
    const st: StatoDati = {
      rev: ix.rev,
      schema: ix.schema,
      img: [...prese],
      note: ix.note ?? '',
      cat: nomeCat,
      sch: nomeSch,
    };
    if (ix.data) st.data = ix.data;
    await scriviDato('stato.json', JSON.stringify(st));
    Object.assign(dati, {
      rev: ix.rev,
      locale: true,
      img: prese,
      base: dati.base || (await baseDati()),
      fileSchede: nomeSch,
    });
    azzeraSchede();
    // i file dei dati di prima non servono più
    for (const vecchio of [precedente?.cat, precedente?.sch])
      if (vecchio && vecchio !== nomeCat && vecchio !== nomeSch)
        await Filesystem.deleteFile({ path: `dati/${vecchio}`, directory: Directory.Data }).catch(() => undefined);
    return { tipo: 'nuovi', catalogo: cat, indice: ix };
  } catch (e) {
    avvisa('aggiornamento dei dati', e);
    return { tipo: 'niente' };
  } finally {
    dati.inCorso = false;
  }
}

/** Dati già scaricati in background (dal telefono, ad app chiusa) e non ancora in uso. */
export async function datiGiaScaricati(): Promise<CatalogoGrezzo | null> {
  if (!nativo() || dati.inCorso) return null;
  try {
    const st = await leggiDato<StatoDati>('stato.json');
    if (st.schema > SCHEMA_DATI || !(st.rev > dati.rev)) return null;
    const cat = await leggiDato<CatalogoGrezzo>(st.cat ?? 'catalogo.json');
    Object.assign(dati, {
      rev: st.rev,
      locale: true,
      img: new Set(st.img ?? []),
      base: dati.base || (await baseDati()),
      note: st.note ?? '',
      fileSchede: st.sch ?? 'schede.json',
    });
    azzeraSchede();
    return cat;
  } catch {
    return null;
  }
}

const UN_GIORNO = 864e5;

/**
 * Pulizia di dati/: si cancella quello che lo stato in uso non nomina (cataloghi e schede vecchi, foto non più
 * nell'elenco), oppure tutto se i dati dentro l'APK sono più nuovi. Mai i file di meno di un giorno: potrebbero essere
 * appena scaricati (anche dalla parte Android, ad app chiusa) e non ancora scritti nello stato.
 */
export async function pulisciDati(): Promise<void> {
  // letto da una funzione: può cominciare uno scaricamento mentre si pulisce
  const scaricando = (): boolean => dati.inCorso;
  if (!nativo() || scaricando()) return;
  const st = await leggiDato<StatoDati>('stato.json').catch(() => null);
  const inUso = !!st && st.schema <= SCHEMA_DATI && st.rev > dati.revApk;
  // anche i file dei dati in uso in questa sessione (la parte Android può aver scritto uno stato più nuovo, che si
  // userà solo tornando sull'app)
  const tieni = new Set<string>(['stato.json', dati.fileSchede, ...dati.img]);
  if (st && inUso) {
    tieni.add(st.cat ?? 'catalogo.json');
    tieni.add(st.sch ?? 'schede.json');
    for (const x of st.img ?? []) tieni.add(x);
  }
  for (const cartella of ['', 'img']) {
    const r = await Filesystem.readdir({
      path: cartella ? `dati/${cartella}` : 'dati',
      directory: Directory.Data,
    }).catch(() => null);
    for (const f of r?.files ?? []) {
      if (f.type === 'directory' || scaricando()) continue;
      const nome = cartella ? `${cartella}/${f.name}` : f.name;
      if (tieni.has(nome) || Date.now() - f.mtime < UN_GIORNO) continue;
      await Filesystem.deleteFile({ path: `dati/${nome}`, directory: Directory.Data }).catch(() => undefined);
    }
  }
}

// ───────── schede complete (1,9 MB): si leggono solo quando servono ─────────

export let schede: Schede | null = null;
let schedeInArrivo: Promise<Schede> | null = null;

function azzeraSchede(): void {
  schede = null;
  schedeInArrivo = null;
}

async function leggiSchedeApk(): Promise<Schede | null> {
  const r = await fetch('data/details.json');
  return r.ok ? ((await r.json()) as Schede) : null;
}

export function caricaSchede(): Promise<Schede> {
  if (schede) return Promise.resolve(schede);
  schedeInArrivo ??= (dati.locale ? leggiDato<Schede>(dati.fileSchede) : leggiSchedeApk())
    .catch(() => leggiSchedeApk())
    .then(s => (schede = s?.types ? s : { types: {} }))
    .catch(() => (schede = { types: {} }));
  return schedeInArrivo;
}

/** Indirizzo di una foto del catalogo: scaricata con un aggiornamento dei dati, oppure dentro l'APK. */
export function indirizzoFoto(nome: string): string {
  if (dati.base && dati.img.has(nome)) return dati.base + nome;
  return /^https?:|^data:/.test(nome) ? nome : `data/${nome}`;
}
