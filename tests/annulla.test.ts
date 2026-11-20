import { describe, expect, it } from 'vitest';
import { annullaOperazione, fotografa, type CollezioneViva } from '../src/collezione/annulla';
import type { VoceStorico } from '../src/collezione/stato';

const viva = (possedute: string[], storico: VoceStorico[] = [], note: Record<string, string> = {}): CollezioneViva => ({
  possedute: new Set(possedute),
  preferite: new Set(),
  note: { ...note },
  storico: [...storico],
});

describe("Annulla di un'operazione sulla collezione", () => {
  it('azzera e annulla: torna tutto, compresa la moneta arrivata nel frattempo da un altro dispositivo', () => {
    const c = viva(['A', 'B']);
    const prima = fotografa(c);
    c.possedute.clear(); // azzera
    const dopo = fotografa(c);
    c.possedute.add('Z'); // arriva Z dal tablet nei 5 secondi
    annullaOperazione(prima, dopo, c);
    expect([...c.possedute].sort()).toEqual(['A', 'B', 'Z']);
  });

  it("una moneta tolta dall'operazione e poi rimessa da fuori non si tocca", () => {
    const c = viva(['A', 'B']);
    const prima = fotografa(c);
    c.possedute.clear();
    const dopo = fotografa(c);
    c.possedute.add('A'); // A rimessa da un altro dispositivo
    annullaOperazione(prima, dopo, c);
    expect([...c.possedute].sort()).toEqual(['A', 'B']);
  });

  it('importazione annullata: via solo le importate, restano quelle arrivate da fuori', () => {
    const r1: VoceStorico = [1, '+', 'A'];
    const c = viva(['A'], [r1]);
    const prima = fotografa(c);
    c.possedute.add('I1');
    c.possedute.add('I2');
    const riga1: VoceStorico = [2, '+', 'I1', 'd'];
    const riga2: VoceStorico = [2, '+', 'I2', 'd'];
    c.storico.push(riga1, riga2);
    const dopo = fotografa(c);
    c.possedute.add('Z');
    const daFuori: VoceStorico = [3, '+', 'Z', '@Tablet'];
    c.storico.push(daFuori);
    annullaOperazione(prima, dopo, c);
    expect([...c.possedute].sort()).toEqual(['A', 'Z']);
    expect(c.storico).toEqual([r1, daFuori]);
  });

  it('ripristino annullato: note e preferite come prima, ma non quelle cambiate da fuori nel frattempo', () => {
    const c = viva(['A'], [], { n1: 'mia', n2: 'resta' });
    c.preferite.add('t1');
    const prima = fotografa(c);
    // il backup ha un'altra collezione
    c.possedute.clear();
    c.possedute.add('V');
    c.preferite.clear();
    c.note.n1 = 'del backup';
    Reflect.deleteProperty(c.note, 'n2');
    const dopo = fotografa(c);
    c.note.n3 = 'arrivata da fuori';
    annullaOperazione(prima, dopo, c);
    expect([...c.possedute]).toEqual(['A']);
    expect([...c.preferite]).toEqual(['t1']);
    expect(c.note).toEqual({ n1: 'mia', n2: 'resta', n3: 'arrivata da fuori' });
  });

  it("storico lungo accorciato dall'operazione: con Annulla torna intero, senza righe finte", () => {
    const vecchie: VoceStorico[] = Array.from({ length: 10 }, (_, i) => [i, '+', `k${String(i)}`]);
    const c = viva(['k1', 'k2'], vecchie);
    const prima = fotografa(c);
    // l'operazione aggiunge righe e accorcia (tiene le ultime 6)
    c.storico.push([20, '-', 'k1'], [20, '-', 'k2']);
    c.storico.splice(0, c.storico.length - 6);
    c.possedute.clear();
    const dopo = fotografa(c);
    annullaOperazione(prima, dopo, c);
    expect(c.storico).toEqual(vecchie);
  });
});
