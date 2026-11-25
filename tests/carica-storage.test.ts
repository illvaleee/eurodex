import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  controllaIndice,
  esegui,
  leggi,
  md5,
  pianoApk,
  pianoDati,
  pianoVersione,
  principale,
} from '../scripts/carica-storage.mjs';
import type { Contesto } from '../scripts/carica-storage.mjs';
import { nomeFileDatiValido } from '../src/catalogo/nomi-dati';

// Cloud Storage finto, con le sole richieste che fa scripts/carica-storage.mjs: caricamento multipart, lettura dei
// metadati e del contenuto, cancellazione
const BUCKET = 'collezione-euro-24ecd.firebasestorage.app';

interface Oggetto {
  dati: Buffer;
  cache: string | undefined;
  metadati: Record<string, string>;
}

interface Meta {
  name: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

function risposta(status: number, corpo: unknown = {}): Response {
  const testo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(JSON.parse(testo) as unknown),
    text: () => Promise.resolve(testo),
  } as unknown as Response;
}

function multipart(corpo: Buffer, tipo: string): { meta: Meta; dati: Buffer } {
  const confine = /boundary=(.+)$/.exec(tipo)?.[1] ?? '';
  const inizio = corpo.indexOf('\r\n\r\n') + 4;
  const fineMeta = corpo.indexOf(`\r\n--${confine}\r\n`, inizio);
  const meta = JSON.parse(corpo.subarray(inizio, fineMeta).toString('utf8')) as Meta;
  const inizioDati = corpo.indexOf('\r\n\r\n', fineMeta + 2) + 4;
  return { meta, dati: corpo.subarray(inizioDati, corpo.lastIndexOf(`\r\n--${confine}--\r\n`)) };
}

function storageFinto() {
  const oggetti = new Map<string, Oggetto>();
  const registro: string[] = [];
  const guasti = new Map<string, number[]>();
  const md5Sbagliato = new Set<string>();
  const fetch = (url: string, opzioni: RequestInit = {}): Promise<Response> => {
    const intestazioni = (opzioni.headers ?? {}) as Record<string, string>;
    expect(intestazioni.Authorization).toBe('Bearer gettone');
    const u = new URL(url);
    if (u.pathname === `/upload/storage/v1/b/${BUCKET}/o`) {
      const { meta, dati } = multipart(opzioni.body as unknown as Buffer, intestazioni['Content-Type'] ?? '');
      registro.push(`carica ${meta.name}`);
      const codice = guasti.get(meta.name)?.shift();
      if (codice !== undefined) return Promise.resolve(risposta(codice, 'guasto'));
      oggetti.set(meta.name, { dati: Buffer.from(dati), cache: meta.cacheControl, metadati: meta.metadata ?? {} });
      return Promise.resolve(risposta(200, { md5Hash: md5Sbagliato.has(meta.name) ? 'sbagliato' : md5(dati) }));
    }
    const nome = decodeURIComponent(u.pathname.replace(`/storage/v1/b/${BUCKET}/o/`, ''));
    if (opzioni.method === 'DELETE') {
      registro.push(`cancella ${nome}`);
      return Promise.resolve(risposta(oggetti.delete(nome) ? 204 : 404));
    }
    const o = oggetti.get(nome);
    if (!o) return Promise.resolve(risposta(404));
    if (u.searchParams.get('alt') === 'media') return Promise.resolve(risposta(200, o.dati.toString('utf8')));
    return Promise.resolve(risposta(200, { md5Hash: md5(o.dati), metadata: o.metadati }));
  };
  const ctx: Contesto = { bucket: BUCKET, token: 'gettone', fetch, aspetta: () => Promise.resolve() };
  return { oggetti, registro, guasti, md5Sbagliato, ctx };
}

const versione = (n: number) => ({ code: n, version: `1.0.${n}`, apk: `CollezioneEuro-1.0.${n}.apk`, note: '' });
const indice = (rev: number, img: string[]) => ({ rev, schema: 1, note: 'Prova', file: {}, img });
const LUNEDI = Date.UTC(2026, 10, 30, 6, 23);
const GIORNO = 86_400_000;

describe('Storage: APK e version.json', () => {
  it("prima l'APK, poi version.json; l'APK di prima resta, quello di due versioni fa si toglie", async () => {
    const s = storageFinto();
    for (const n of [84, 85, 86]) {
      const v = versione(n);
      const sorgente = (x: string) => Buffer.from(x === 'apk' ? `apk ${n}` : JSON.stringify(v));
      await esegui(pianoApk(v), s.ctx, sorgente);
      const prima = await leggi(s.ctx, 'rilasci/version.json');
      await esegui(pianoVersione(v, prima.dati, prima.metadati), s.ctx, sorgente);
    }
    expect([...s.oggetti.keys()].sort()).toEqual([
      'rilasci/CollezioneEuro-1.0.85.apk',
      'rilasci/CollezioneEuro-1.0.86.apk',
      'rilasci/version.json',
    ]);
    const vj = s.oggetti.get('rilasci/version.json');
    expect(vj?.cache).toBe('no-cache');
    expect(vj?.metadati).toEqual({ apk_precedente: 'CollezioneEuro-1.0.85.apk' });
    expect(s.registro.at(-1)).toBe('cancella rilasci/CollezioneEuro-1.0.84.apk');
    // mai un token di download: senza, nessun link scavalca le regole di Storage
    for (const o of s.oggetti.values()) expect(Object.keys(o.metadati)).not.toContain('firebaseStorageDownloadTokens');
  });

  it("non si toglie mai l'APK nuovo né quello di prima, anche con metadati strani", () => {
    for (const apk_precedente of ['CollezioneEuro-1.0.85.apk', 'CollezioneEuro-1.0.86.apk', '../x.apk', 'altro']) {
      expect(pianoVersione(versione(86), versione(85), { apk_precedente }).cancella).toEqual([]);
    }
    expect(pianoVersione(versione(86), versione(85), { apk_precedente: 'CollezioneEuro-1.0.84.apk' }).cancella).toEqual(
      ['rilasci/CollezioneEuro-1.0.84.apk'],
    );
  });

  it('nomi strani in version.json: non si carica niente', () => {
    for (const apk of ['../CollezioneEuro-1.0.1.apk', 'altro.apk', 'CollezioneEuro-1.0.1.apk/x', '', 42]) {
      expect(() => pianoApk({ apk })).toThrow();
      expect(() => pianoVersione({ apk }, null, {})).toThrow();
    }
  });
});

describe('Storage: il catalogo', () => {
  it('la prima volta tutto, con indice.json per ultimo e nomi che le app accettano', () => {
    const p = pianoDati(indice(202611300623, ['img/aa.webp', 'img/bb.webp']), null, {}, LUNEDI);
    expect(p.stessi).toBe(false);
    expect(p.carica.map(c => c.nome)).toEqual([
      'dati/img/aa.webp',
      'dati/img/bb.webp',
      `dati/catalog-${p.numero}.json`,
      `dati/details-${p.numero}.json`,
      'dati/indice.json',
    ]);
    expect(nomeFileDatiValido(`catalog-${p.numero}.json`) && nomeFileDatiValido(`details-${p.numero}.json`)).toBe(true);
    expect(p.indice?.file).toEqual({ catalogo: `catalog-${p.numero}.json`, schede: `details-${p.numero}.json` });
    expect(p.carica.at(-1)?.cache).toBe('no-cache');
    expect(p.cancella).toEqual([]);
  });

  it('gli stessi dati già su Storage: niente da caricare, quindi nessun avviso', () => {
    const p1 = pianoDati(indice(202611300623, ['img/aa.webp']), null, {}, LUNEDI);
    const p2 = pianoDati(indice(202611300623, ['img/aa.webp']), p1.indice, { prima: '' }, LUNEDI + 3_600_000);
    expect(p2).toMatchObject({ stessi: true, carica: [], cancella: [] });
  });

  it('dati nuovi: solo le foto nuove; poi via le foto tolte e i file di due indici fa', () => {
    const p1 = pianoDati(indice(202611300623, ['img/aa.webp', 'img/bb.webp']), null, {}, LUNEDI);
    const p2 = pianoDati(
      indice(202612070623, ['img/bb.webp', 'img/cc.webp']),
      p1.indice,
      p1.carica.at(-1)?.metadati ?? {},
      LUNEDI + 7 * GIORNO,
    );
    expect(p2.carica.map(c => c.nome)).toEqual([
      'dati/img/cc.webp',
      `dati/catalog-${p2.numero}.json`,
      `dati/details-${p2.numero}.json`,
      'dati/indice.json',
    ]);
    // i file dell'indice di prima restano, per chi l'ha appena letto: si annotano per toglierli la volta dopo
    expect(p2.carica.at(-1)?.metadati).toEqual({ prima: `catalog-${p1.numero}.json details-${p1.numero}.json` });
    expect(p2.cancella).toEqual(['dati/img/aa.webp']);
    const p3 = pianoDati(
      indice(202612140623, ['img/cc.webp']),
      p2.indice,
      p2.carica.at(-1)?.metadati ?? {},
      LUNEDI + 14 * GIORNO,
    );
    expect(p3.cancella).toEqual([
      'dati/img/bb.webp',
      `dati/catalog-${p1.numero}.json`,
      `dati/details-${p1.numero}.json`,
    ]);
  });

  it("valori strani nell'indice (vengono dai dati scaricati): si ferma prima di caricare", () => {
    for (const cattivo of [
      indice(1, ['../../segreti.webp']),
      indice(1, ['img/AA.webp']),
      { ...indice(1, []), note: 'vai su https://esempio.it' },
      { ...indice(1, []), note: 'testo\u202egirato' },
      { ...indice(1, []), rev: '1; rm -rf' },
      { ...indice(1, []), schema: 1000 },
    ]) {
      expect(() => controllaIndice(cattivo)).toThrow();
      expect(() => pianoDati(cattivo, null, {}, LUNEDI)).toThrow();
    }
  });
});

describe('Storage: come si carica', () => {
  it('tutto il catalogo su Storage, e una seconda volta con gli stessi dati non carica niente', async () => {
    const s = storageFinto();
    const nuovo = indice(202611300623, ['img/aa.webp', 'img/bb.webp']);
    for (const volta of [1, 2]) {
      const prima = await leggi(s.ctx, 'dati/indice.json');
      const p = pianoDati(nuovo, prima.dati, prima.metadati, LUNEDI + volta * 60_000);
      await esegui(p, s.ctx, x => Buffer.from(x === 'indice' ? JSON.stringify(p.indice) : x));
    }
    expect(s.registro).toHaveLength(5);
    expect(s.registro.at(-1)).toBe('carica dati/indice.json');
  });

  it('si ferma al primo file che non va: allora indice.json non parte, e nessun avviso', async () => {
    const s = storageFinto();
    const p = pianoDati(indice(202611300623, ['img/aa.webp', 'img/bb.webp']), null, {}, LUNEDI);
    s.md5Sbagliato.add('dati/img/bb.webp');
    await expect(esegui(p, s.ctx, () => Buffer.from('x'))).rejects.toThrow(/MD5/);
    expect(s.oggetti.has('dati/indice.json')).toBe(false);
  });

  it('riprova dopo 503 e 429, non dopo 403', async () => {
    const s = storageFinto();
    s.guasti.set('rilasci/CollezioneEuro-1.0.84.apk', [503, 429]);
    await esegui(pianoApk(versione(84)), s.ctx, () => Buffer.from('apk'));
    expect(s.registro.filter(r => r === 'carica rilasci/CollezioneEuro-1.0.84.apk')).toHaveLength(3);
    s.guasti.set('rilasci/CollezioneEuro-1.0.85.apk', [403]);
    await expect(esegui(pianoApk(versione(85)), s.ctx, () => Buffer.from('apk'))).rejects.toThrow(/403/);
    expect(s.registro.filter(r => r === 'carica rilasci/CollezioneEuro-1.0.85.apk')).toHaveLength(1);
  });
});

describe('Storage: il programma, come lo lanciano i workflow', () => {
  it("version.json parte solo se su Storage c'è già proprio quell'APK", async () => {
    const s = storageFinto();
    const cartella = mkdtempSync(join(tmpdir(), 'storage-'));
    const apk = join(cartella, 'CollezioneEuro.apk');
    const vj = join(cartella, 'version.json');
    writeFileSync(apk, 'apk vero');
    writeFileSync(vj, JSON.stringify({ ...versione(84), size: 8 }));
    const ambiente = { fetch: s.ctx.fetch, env: { STORAGE_TOKEN: 'gettone' }, aspetta: () => Promise.resolve() };
    await expect(principale(['versione', BUCKET, apk, vj], ambiente)).rejects.toThrow(/manca l'APK/);
    await principale(['apk', BUCKET, apk, vj], ambiente);
    writeFileSync(apk, 'apk dopo');
    await expect(principale(['versione', BUCKET, apk, vj], ambiente)).rejects.toThrow(/manca l'APK/);
    writeFileSync(apk, 'apk vero');
    await principale(['versione', BUCKET, apk, vj], ambiente);
    expect(s.oggetti.has('rilasci/version.json')).toBe(true);
    // la dimensione scritta in version.json dev'essere quella dell'APK
    writeFileSync(vj, JSON.stringify({ ...versione(85), size: 9 }));
    await expect(principale(['apk', BUCKET, apk, vj], ambiente)).rejects.toThrow(/dimensione/);
    await expect(principale(['apk', 'Bucket Strano', apk, vj], ambiente)).rejects.toThrow(/bucket/);
    await expect(principale(['apk', BUCKET, apk, vj], { ...ambiente, env: {} })).rejects.toThrow(/STORAGE_TOKEN/);
  });

  it('il catalogo da una cartella come www/data, due volte', async () => {
    const s = storageFinto();
    const cartella = mkdtempSync(join(tmpdir(), 'dati-'));
    mkdirSync(join(cartella, 'img'));
    writeFileSync(join(cartella, 'img', 'aa.webp'), 'foto');
    writeFileSync(join(cartella, 'catalog.json'), '{"types":[]}');
    writeFileSync(join(cartella, 'details.json'), '{}');
    writeFileSync(join(cartella, 'indice.json'), JSON.stringify(indice(202611300623, ['img/aa.webp'])));
    const ambiente = { fetch: s.ctx.fetch, env: { STORAGE_TOKEN: 'gettone' }, aspetta: () => Promise.resolve() };
    await principale(['dati', BUCKET, cartella], ambiente);
    await principale(['dati', BUCKET, cartella], ambiente);
    expect(s.registro).toHaveLength(4);
    expect(s.oggetti.get('dati/img/aa.webp')?.dati.toString('utf8')).toBe('foto');
    const caricato = await leggi(s.ctx, 'dati/indice.json');
    expect(caricato.dati).toMatchObject({ rev: 202611300623, img: ['img/aa.webp'] });
  });
});
