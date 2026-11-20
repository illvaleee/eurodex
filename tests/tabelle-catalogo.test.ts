import { describe, expect, it } from 'vitest';
import type { CodiceTaglio, Pezzo, Tipo } from '../src/catalogo/tipi';
import { presente } from './aiuto';
import { pdfCatalogo } from '../src/collezione/pdf-catalogo';
import { COLONNE, anniTabella, tabelleCatalogo, type DatiTabelle } from '../src/collezione/tabelle-catalogo';

function tipo(cc: string, denom: CodiceTaglio, commem = false): Tipo {
  return { id: `${cc}-${denom}`, cc, denom, commem, pieces: [], extras: [] } as unknown as Tipo;
}
function pezzo(t: Tipo, y: number, m = '', o: Partial<Pezzo> = {}): Pezzo {
  return {
    key: `${t.id}-${String(y)}-${m}-${String(o.proof ?? false)}-${String(o.extra ?? false)}`,
    t,
    y,
    m,
    proof: false,
    mint: null,
    n: '',
    extra: false,
    ...o,
  };
}

const it2 = tipo('IT', '2e');
const it1c = tipo('IT', '1c');
const de2 = tipo('DE', '2e');
const comm = tipo('IT', '2e', true);
const pezzi = [
  pezzo(it2, 2002, 'R'),
  pezzo(it2, 2003, 'R'),
  pezzo(it2, 2003, 'R', { proof: true }), // proof: non conta
  pezzo(it2, 2004, 'R', { extra: true }), // variante: non conta
  pezzo(comm, 2005, 'R'), // commemorativa: non conta
  pezzo(it1c, 2010, 'R'),
  pezzo(it1c, 2010, 'R', { n: 'seconda versione', key: 'it1c-2010-b' }),
  pezzo(de2, 2002, 'A'),
  pezzo(de2, 2002, 'F'),
  pezzo(de2, 2008, 'F'),
];
const dati = (possedute: string[], annoCorrente = 2026): DatiTabelle => ({
  pezzi,
  possedute: new Set(possedute),
  ordinePaesi: ['DE', 'IT', 'FR'],
  nomePaese: cc => ({ DE: 'Germania', IT: 'Italia', FR: 'Francia' })[cc] ?? cc,
  annoCorrente,
});
const cella = (t: ReturnType<typeof tabelleCatalogo>[number], y: number, d: CodiceTaglio) =>
  t.righe[t.anni.indexOf(y)]?.[COLONNE.indexOf(d)];

describe('tabelle del catalogo base (PDF)', () => {
  it('anni dal 1999 almeno al 2030, e sempre qualche anno oltre quello in corso', () => {
    expect(anniTabella(2026).at(0)).toBe(1999);
    expect(anniTabella(2026).at(-1)).toBe(2030);
    expect(anniTabella(2029).at(-1)).toBe(2033);
  });

  it('una tabella per paese, la Germania una per zecca, nessuna per i paesi senza monete', () => {
    const t = tabelleCatalogo(dati([]));
    expect(t.map(x => `${x.cc}${x.zecca?.lettera ?? ''}`)).toEqual(['DEA', 'DED', 'DEF', 'DEG', 'DEJ', 'IT']);
    expect(t.find(x => x.zecca?.lettera === 'F')?.totale).toBe(2);
  });

  it('solo la serie base: niente proof, varianti e commemorative', () => {
    const itTab = tabelleCatalogo(dati([])).find(x => x.cc === 'IT');
    expect(itTab?.totale).toBe(4);
    expect(cella(presente(itTab), 2004, '2e')?.stato).toBe('mai');
    expect(cella(presente(itTab), 2005, '2e')?.stato).toBe('mai');
  });

  it("ce l'hai, manca, mai coniata, anni futuri vuoti, più versioni in parte", () => {
    const itTab = presente(
      tabelleCatalogo(dati([presente(pezzi[0]).key, presente(pezzi[5]).key])).find(x => x.cc === 'IT'),
    );
    expect(cella(itTab, 2002, '2e')).toEqual({ stato: 'ha', hai: 1, di: 1 });
    expect(cella(itTab, 2003, '2e')?.stato).toBe('manca');
    expect(cella(itTab, 2001, '2e')?.stato).toBe('mai');
    expect(cella(itTab, 2025, '1e')?.stato).toBe('mai');
    expect(cella(itTab, 2026, '1e')?.stato).toBe('futura'); // anno in corso: potrebbe ancora uscire
    expect(cella(itTab, 2030, '2e')?.stato).toBe('futura');
    expect(cella(itTab, 2010, '1c')).toEqual({ stato: 'parte', hai: 1, di: 2 });
    expect(itTab.hai).toBe(2);
  });

  it('Germania: ogni zecca ha le sue monete', () => {
    const t = tabelleCatalogo(dati([presente(pezzi[8]).key]));
    const a = presente(t.find(x => x.zecca?.lettera === 'A'));
    const f = presente(t.find(x => x.zecca?.lettera === 'F'));
    expect(cella(a, 2002, '2e')?.stato).toBe('manca');
    expect(cella(f, 2002, '2e')?.stato).toBe('ha');
    expect(cella(a, 2008, '2e')?.stato).toBe('mai');
    expect(cella(f, 2008, '2e')?.stato).toBe('manca');
  });

  it('il PDF è un PDF vero: copertina più una pagina per tabella', () => {
    const t = tabelleCatalogo(dati([presente(pezzi[0]).key]));
    const byte = pdfCatalogo(t, new Date('2026-11-20'));
    const testo = new TextDecoder('latin1').decode(byte);
    expect(testo.startsWith('%PDF-')).toBe(true);
    expect(testo.match(/\/Type \/Page\b/g)?.length).toBe(t.length + 1);
  });
});
