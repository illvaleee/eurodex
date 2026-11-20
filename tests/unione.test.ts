import { describe, expect, it } from 'vitest';
import { scrivi } from '../src/sync/orologio';
import {
  chiaveVoce,
  documentoDi,
  annullaInvio,
  cambiDaApplicare,
  daRiparare,
  modificheLocali,
  riapplica,
  unisci,
  vociDelDocumento,
  vociPerDocumento,
  type Voci,
} from '../src/sync/unione';

const t = (ms: number, nodo = 'A') => scrivi({ ms, c: 0, nodo });

describe('unione della collezione condivisa', () => {
  it('vince la modifica più recente, in qualsiasi ordine arrivino', () => {
    const vecchia = { 'p:1': { v: true, t: t(100) } };
    const nuova = { 'p:1': { v: false, t: t(200, 'B') } };
    const a: Voci = {};
    unisci(a, vecchia);
    unisci(a, nuova);
    const b: Voci = {};
    unisci(b, nuova);
    unisci(b, vecchia);
    expect(a).toEqual(b);
    expect(a['p:1']?.v).toBe(false);
  });

  it('segnala come cambio solo quello che cambia davvero il valore', () => {
    const c: Voci = { 'p:1': { v: true, t: t(100) } };
    expect(unisci(c, { 'p:1': { v: true, t: t(300) } })).toHaveLength(0);
    expect(unisci(c, { 'p:2': { v: true, t: t(300) } })).toHaveLength(1);
  });

  it("trova le modifiche fatte qui rispetto all'ultimo stato conosciuto", () => {
    const conosciute: Voci = {
      [chiaveVoce('p', 'a')]: { v: true, t: t(1) },
      [chiaveVoce('p', 'b')]: { v: true, t: t(1) },
      [chiaveVoce('n', '9')]: { v: 'vecchia', t: t(1) },
    };
    const m = modificheLocali(
      { possedute: new Set(['a', 'c']), preferite: new Set(['5']), note: { '9': 'nuova' } },
      conosciute,
    );
    expect(Object.fromEntries(m)).toEqual({ 'p:c': true, 'f:5': true, 'n:9': 'nuova', 'p:b': false });
  });

  it('divide le possedute in 16 documenti, sempre allo stesso modo', () => {
    const d = documentoDi('p', '12345-678');
    expect(d).toMatch(/^p[0-9a-f]$/);
    expect(documentoDi('p', '12345-678')).toBe(d);
    expect(documentoDi('f', 'x')).toBe('f');
  });

  it('quello che si scrive su Firestore si rilegge uguale (chiavi complete, con il tipo)', () => {
    const voci: Voci = {
      'p:12345-678': { v: true, t: t(1) },
      'p:999-1': { v: false, t: t(2) },
      'f:42': { v: true, t: t(3) },
      'n:42': { v: 'presa a Roma', t: t(4) },
    };
    const riletto: Voci = {};
    for (const [nome, e] of vociPerDocumento(voci)) {
      expect(nome).toMatch(/^(p[0-9a-f]|f|n[0-3])$/);
      for (const k of Object.keys(e)) expect(k).not.toMatch(/^[pfn]:/); // nel documento la chiave è senza il tipo
      Object.assign(riletto, vociDelDocumento(nome, e));
    }
    expect(riletto).toEqual(voci);
  });

  it('da Firestore si scarta quello che non è valido', () => {
    expect(vociDelDocumento('altro', { a: { v: true, t: t(1) } })).toEqual({});
    expect(vociDelDocumento('f', { a: { v: 'testo', t: t(1) }, b: { v: true } })).toEqual({});
    expect(vociDelDocumento('n0', { a: { v: true, t: t(1) } })).toEqual({});
  });

  it('chiavi senza tipo non entrano e non partono', () => {
    const c: Voci = {};
    expect(unisci(c, { '12345-678': { v: true, t: t(1) } })).toHaveLength(0);
    expect(c).toEqual({});
    const m = modificheLocali(
      { possedute: new Set(), preferite: new Set(), note: {} },
      { '12345-678': { v: true, t: t(1) } },
    );
    expect(m.size).toBe(0);
  });
});

describe("modifiche non arrivate all'account", () => {
  it("un invio rifiutato rimette le voci com'erano, così le modifiche ripartono", () => {
    const prima = { v: true, t: t(1) };
    const conosciute: Voci = { 'p:a': prima };
    const inviate: Voci = { 'p:a': { v: false, t: t(2) }, 'p:b': { v: true, t: t(2) } };
    Object.assign(conosciute, inviate);
    annullaInvio(conosciute, inviate, { 'p:a': prima, 'p:b': undefined });
    expect(conosciute).toEqual({ 'p:a': prima });
    const stato = { possedute: new Set<string>(), preferite: new Set<string>(), note: {} };
    // la moneta "a" è stata tolta qui e "b" aggiunta: risultano di nuovo da inviare
    stato.possedute.add('b');
    expect(modificheLocali(stato, conosciute)).toEqual(
      new Map<string, boolean | string>([
        ['p:b', true],
        ['p:a', false],
      ]),
    );
  });

  it('una voce già superata da una modifica più recente non si tocca', () => {
    const inviata = { v: true, t: t(2) };
    const piuRecente = { v: false, t: t(3) };
    const conosciute: Voci = { 'p:a': piuRecente };
    annullaInvio(conosciute, { 'p:a': inviata }, { 'p:a': undefined });
    expect(conosciute['p:a']).toBe(piuRecente);
  });

  it("le modifiche fatte qui si rimettono sopra la collezione arrivata dall'account", () => {
    const stato = {
      possedute: new Set(['a', 'c']),
      preferite: new Set(['x']),
      note: { n1: 'vecchia' } as Record<string, string>,
    };
    riapplica(
      stato,
      new Map<string, boolean | string>([
        ['p:a', false],
        ['p:b', true],
        ['f:x', false],
        ['n:n1', ''],
        ['n:n2', 'nuova'],
        ['zz', true],
      ]),
    );
    expect([...stato.possedute].sort()).toEqual(['b', 'c']);
    expect([...stato.preferite]).toEqual([]);
    expect(stato.note).toEqual({ n2: 'nuova' });
  });
});

describe('riparazione delle voci rimaste vecchie sul server', () => {
  it('chi conosce la voce più recente la riscrive identica', () => {
    const nuova = { v: false, t: t(205, 'B') };
    const conosciute: Voci = { 'p:x': nuova, 'p:y': { v: true, t: t(100) } };
    // il server ha ricevuto per ultima la modifica vecchia di A (rimasto senza rete)
    expect(daRiparare(conosciute, { 'p:x': { v: true, t: t(200, 'A') }, 'p:y': { v: true, t: t(100) } })).toEqual({
      'p:x': nuova,
    });
  });

  it('non ripara niente se arriva la stessa voce o una più recente', () => {
    const conosciute: Voci = { 'p:x': { v: true, t: t(100) } };
    expect(daRiparare(conosciute, { 'p:x': { v: true, t: t(100) } })).toEqual({});
    expect(daRiparare(conosciute, { 'p:x': { v: false, t: t(300) } })).toEqual({});
    expect(daRiparare(conosciute, { 'p:z': { v: true, t: t(1) } })).toEqual({});
  });

  it('due dispositivi che riparano arrivano allo stesso risultato e si fermano', () => {
    // A ha mandato tardi la sua voce vecchia; B e C conoscono quella nuova
    const nuova = { v: false, t: t(205, 'B') };
    let server: Voci = { 'p:x': { v: true, t: t(200, 'A') } };
    const b: Voci = { 'p:x': nuova };
    const c: Voci = { 'p:x': nuova };
    for (let giro = 0; giro < 3; giro++) {
      for (const d of [b, c]) {
        const r = daRiparare(d, server);
        server = { ...server, ...r };
        unisci(d, server);
      }
    }
    expect(server['p:x']).toEqual(nuova);
    expect(daRiparare(b, server)).toEqual({});
    expect(daRiparare(c, server)).toEqual({});
  });
});

describe('un tocco non ancora inviato non si perde', () => {
  it('la voce arrivata da fuori non cancella il tocco: il tocco parte dopo e vince', () => {
    // ieri sul tablet Y è stata tolta (il telefono era spento); oggi qui l'utente la segna mentre arriva quella modifica
    const stato = { possedute: new Set(['y']), preferite: new Set<string>(), note: {} };
    const conosciute: Voci = { 'p:y': { v: false, t: t(50) } };
    const pendenti = modificheLocali(stato, conosciute);
    expect(pendenti.get('p:y')).toBe(true);
    const cambi = cambiDaApplicare(unisci(conosciute, { 'p:y': { v: false, t: t(200, 'B') } }), pendenti);
    expect(cambi).toHaveLength(0);
    expect(stato.possedute.has('y')).toBe(true);
    // le voci conosciute hanno quella arrivata: il tocco risulta ancora da inviare
    expect(modificheLocali(stato, conosciute).get('p:y')).toBe(true);
  });

  it('i cambi delle voci non toccate qui si applicano normalmente', () => {
    const conosciute: Voci = { 'p:a': { v: true, t: t(1) } };
    const stato = { possedute: new Set(['a']), preferite: new Set<string>(), note: {} };
    const pendenti = modificheLocali(stato, conosciute); // prima di unire, come in applica
    const cambi = cambiDaApplicare(unisci(conosciute, { 'p:a': { v: false, t: t(5, 'B') } }), pendenti);
    expect(cambi.map(c => c.chiave)).toEqual(['p:a']);
  });
});
