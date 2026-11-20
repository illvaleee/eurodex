/**
 * Importazione dell'esportazione CSV di altre app di monete euro
 * (formato: Paese;Anno;Valore;Segno;Titolo;…; valore in centesimi, paese con codice a 2 lettere).
 * Solo logica, senza interfaccia: si prova da sola (tests/importa-csv.test.ts).
 */

export interface PezzoCsv {
  key: string;
  y: number;
  m: string;
  proof: boolean;
  mint: number | null;
}

export interface TipoCsv {
  cc: string;
  denom: string;
  commem: boolean;
  design: string;
  title: string;
  pieces: readonly PezzoCsv[];
}

export interface RigaCsv {
  cc: string;
  y: number;
  /** Valore in centesimi. */
  v: number;
  mint: string;
  title: string;
  /** Data in cui era stata aggiunta nella vecchia app (AAAA-MM-GG), se c'è. */
  date: string;
  raw: string;
  /** Paese corretto, se nel file era sbagliato. */
  altCc?: string;
  piece?: PezzoCsv | null;
}

const TAGLIO_DA_CENTESIMI: Record<number, string> = {
  1: '1c',
  2: '2c',
  5: '5c',
  10: '10c',
  20: '20c',
  50: '50c',
  100: '1e',
  200: '2e',
};
const PAROLE_VUOTE = new Set(
  'the of and for in on to a an di del della dei degli delle anni anno anniversario anniversary years year la il le lo gli e ed per da dal dalla nel nella sul serie series dedicata coin euro'.split(
    ' ',
  ),
);

const parole = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d+)\s*(st|nd|rd|th|o|°|º|\.)(?![a-z])/g, '$1 ')
    .split(/[^a-z0-9]+/)
    .filter(w => (w.length >= 3 || /^\d+$/.test(w)) && !PAROLE_VUOTE.has(w));

const radici = (s: string) => new Set(parole(s).map(w => w.replace(/(i|e|a|o|s)$/, '')));

function trigrammi(s: string): Set<string> {
  const g = new Set<string>();
  for (const w of parole(s)) {
    const x = ` ${w} `;
    for (let i = 0; i < x.length - 2; i++) g.add(x.slice(i, i + 3));
  }
  return g;
}

/** Somiglianza tra due temi (0–1): parole in comune, oppure pezzi di parola in comune (lingue diverse, refusi). */
export function somiglianza(a: string, b: string): number {
  const A = radici(a);
  const B = radici(b);
  if (!A.size || !B.size) return 0;
  let k = 0;
  for (const w of A) if (B.has(w)) k++;
  const GA = trigrammi(a);
  const GB = trigrammi(b);
  let gk = 0;
  for (const g of GA) if (GB.has(g)) gk++;
  return Math.max(k / Math.min(A.size, B.size), (0.9 * gk) / Math.min(GA.size, GB.size));
}

/** Assegnazione migliore (somma dei punteggi massima) tra temi e monete dello stesso paese e anno. */
function assegnazioneMigliore(n: number, m: number, punteggio: number[][]): number[] {
  const p = (i: number, j: number) => punteggio[i]?.[j] ?? 0;
  if (n > 7 || m > 8) {
    const coppie: [number, number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) coppie.push([p(i, j), i, j]);
    coppie.sort((a, b) => b[0] - a[0]);
    const presiT = new Set<number>();
    const presiC = new Set<number>();
    const mappa: number[] = [];
    for (const [, i, j] of coppie) {
      if (presiT.has(i) || presiC.has(j)) continue;
      presiT.add(i);
      presiC.add(j);
      mappa[i] = j;
    }
    return mappa;
  }
  let migliore = { totale: -1, mappa: [] as number[] };
  const usati: boolean[] = new Array<boolean>(m).fill(false);
  const attuale: number[] = [];
  const prova = (i: number, totale: number) => {
    if (i === n) {
      if (totale > migliore.totale) migliore = { totale, mappa: [...attuale] };
      return;
    }
    attuale[i] = -1;
    prova(i + 1, totale);
    for (let j = 0; j < m; j++)
      if (!usati[j]) {
        usati[j] = true;
        attuale[i] = j;
        prova(i + 1, totale + p(i, j) + 0.001);
        usati[j] = false;
      }
  };
  prova(0, 0);
  return migliore.mappa;
}

export function leggiCsv(testo: string): RigaCsv[] | null {
  const righe = testo
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(l => l.trim());
  const prima = righe[0];
  if (!prima) return [];
  const sep = (prima.match(/;/g) ?? []).length >= (prima.match(/,/g) ?? []).length ? ';' : ',';
  const testata = prima.split(sep).map(h => h.trim().toLowerCase());
  const col = (nome: string) => testata.findIndex(h => h.startsWith(nome));
  const [iP, iA, iV, iS, iT, iD] = [
    col('paese'),
    col('anno'),
    col('valore'),
    col('segno'),
    col('titolo'),
    col('data agg'),
  ];
  if (iP < 0 || iA < 0 || iV < 0) return null;
  return righe.slice(1).map(l => {
    const c = l.split(sep);
    const cella = (i: number) => (i >= 0 ? (c[i] ?? '').trim() : '');
    const data = cella(iD);
    return {
      cc: cella(iP).toUpperCase(),
      y: Number(cella(iA)),
      v: Number(cella(iV)),
      mint: cella(iS).replace(/^-$/, ''),
      title: cella(iT).replace(/^-$/, ''),
      date: /^\d{4}-\d{2}-\d{2}/.test(data) ? data.slice(0, 10) : '',
      raw: l,
    };
  });
}

/**
 * Stessa zecca se indicata; senza zecca, il pezzo senza etichetta. Se restano più versioni (segni del maestro di
 * zecca, varianti), quella con la tiratura più alta: è la moneta più comune, quella che si ha in mano
 * (es. Italia 1 cent 2002: la normale con la R, non l'errore di conio senza R).
 */
function scegli(ps: readonly PezzoCsv[], zecca: string): PezzoCsv | null {
  if (!ps.length) return null;
  const perTiratura = (a: PezzoCsv, b: PezzoCsv) => (b.mint ?? 0) - (a.mint ?? 0);
  if (zecca) {
    const stessa = ps.filter(p => p.m.split(' ')[0] === zecca);
    return [...stessa].sort(perTiratura)[0] ?? null;
  }
  const semplici = ps.filter(p => !p.m);
  return [...(semplici.length ? semplici : ps)].sort(perTiratura)[0] ?? null;
}

export interface EsitoAbbinamento {
  chiavi: string[];
  nonTrovate: RigaCsv[];
  spostate: RigaCsv[];
}

/** Trova per ogni riga il pezzo del catalogo (scrive `piece` e, se serve, `altCc` sulla riga). */
export function abbina(righe: RigaCsv[], tipi: readonly TipoCsv[]): EsitoAbbinamento {
  const chiavi = new Set<string>();
  const nonTrovate: RigaCsv[] = [];
  const perPaese = new Map<string, TipoCsv[]>();
  for (const t of tipi) perPaese.set(t.cc, [...(perPaese.get(t.cc) ?? []), t]);
  const commemorativi = (cc: string, y: number) =>
    (perPaese.get(cc) ?? []).filter(t => t.denom === '2e' && t.commem && t.pieces.some(p => p.y === y));
  const sim = (titolo: string, t: TipoCsv) => Math.max(somiglianza(titolo, t.design), somiglianza(titolo, t.title));

  // 1) commemorativi: si abbinano i temi (per paese e anno), prima i più simili, poi per esclusione
  const temaTipo = new Map<string, TipoCsv>();
  const gruppi = new Map<string, Set<string>>();
  for (const r of righe)
    if (r.title && r.v === 200) {
      const g = `${r.cc}|${r.y}`;
      gruppi.set(g, (gruppi.get(g) ?? new Set()).add(r.title));
    }
  for (const [g, insieme] of gruppi) {
    const [cc = '', y = ''] = g.split('|');
    const candidati = commemorativi(cc, Number(y));
    const titoli = [...insieme];
    const punteggio = titoli.map(titolo => candidati.map(t => sim(titolo, t)));
    const mappa = assegnazioneMigliore(titoli.length, candidati.length, punteggio);
    titoli.forEach((titolo, i) => {
      const j = mappa[i];
      if (j == null || j < 0) return;
      const t = candidati[j];
      const ok = (punteggio[i]?.[j] ?? 0) >= 0.2 || (titoli.length === 1 && candidati.length === 1);
      if (ok && t) temaTipo.set(`${g}|${titolo}`, t);
    });
    // ne resta uno solo da una parte e uno solo dall'altra: sono loro
    const usati = new Set(titoli.map(t => temaTipo.get(`${g}|${t}`)).filter(Boolean));
    const restanti = titoli.filter(t => !temaTipo.has(`${g}|${t}`));
    const liberi = candidati.filter(c => !usati.has(c));
    if (restanti.length === 1 && liberi.length === 1 && restanti[0] && liberi[0])
      temaTipo.set(`${g}|${restanti[0]}`, liberi[0]);
    // tema scritto in un'altra lingua (es. tedesco): la moneta più simile, se stacca nettamente le altre
    for (const titolo of titoli.filter(t => !temaTipo.has(`${g}|${t}`))) {
      const presi = new Set(titoli.map(t => temaTipo.get(`${g}|${t}`)).filter(Boolean));
      const classifica = candidati
        .filter(c => !presi.has(c))
        .map(c => ({ c, s: sim(titolo, c) }))
        .sort((a, b) => b.s - a.s);
      const [primo, secondo] = classifica;
      if (primo && primo.s >= 0.12 && (!secondo || primo.s >= 2 * secondo.s)) temaTipo.set(`${g}|${titolo}`, primo.c);
    }
  }
  for (const r of righe) {
    const taglio = TAGLIO_DA_CENTESIMI[r.v];
    let pezzo: PezzoCsv | null = null;
    if (r.title && r.v === 200) {
      let t = temaTipo.get(`${r.cc}|${r.y}|${r.title}`);
      // nessuna moneta del paese indicato: il tema corrisponde chiaramente a quella di un altro paese
      // (nella vecchia app il paese era sbagliato)
      if (!t) {
        const [primo, secondo] = tipi
          .filter(x => x.commem && x.cc !== r.cc && x.pieces.some(p => p.y === r.y))
          .map(x => ({ x, s: sim(r.title, x) }))
          .sort((a, b) => b.s - a.s);
        if (primo && primo.s >= 0.5 && (!secondo || secondo.s < 0.7 * primo.s)) {
          t = primo.x;
          r.altCc = t.cc;
        }
      }
      if (t)
        pezzo = scegli(
          t.pieces.filter(p => p.y === r.y && !p.proof),
          r.mint,
        );
    } else {
      for (const t of (perPaese.get(r.cc) ?? []).filter(x => x.denom === taglio && !x.commem)) {
        pezzo = scegli(
          t.pieces.filter(p => p.y === r.y && !p.proof),
          r.mint,
        );
        if (pezzo) break;
      }
    }
    r.piece = pezzo;
    if (pezzo) chiavi.add(pezzo.key);
    else nonTrovate.push(r);
  }
  return { chiavi: [...chiavi], nonTrovate, spostate: righe.filter(r => r.altCc && r.piece) };
}
