import { beforeEach, describe, expect, it } from 'vitest';
import {
  applica,
  note,
  possedute,
  preferite,
  prefs,
  registraModifica,
  serializza,
  sostituisci,
  sostituisciNote,
  sostituisciPreferenze,
  sostituisciStorico,
  storico,
  type Backup,
} from '../src/collezione/stato';

describe('collezione e backup', () => {
  beforeEach(() => {
    sostituisci(possedute, []);
    sostituisci(preferite, []);
    sostituisciNote({});
    sostituisciStorico([]);
    sostituisciPreferenze({});
  });

  it('un backup contiene tutto e si ripristina uguale', () => {
    sostituisci(possedute, ['a', 'b']);
    sostituisci(preferite, ['10']);
    sostituisciNote({ '10': 'presa a Roma' });
    registraModifica('+', ['a', 'b']);
    prefs.album = true;
    const testo = serializza();
    sostituisci(possedute, []);
    sostituisciNote({});
    prefs.album = false;
    applica(JSON.parse(testo) as Backup);
    expect([...possedute]).toEqual(['a', 'b']);
    expect([...preferite]).toEqual(['10']);
    expect(note['10']).toBe('presa a Roma');
    expect(storico).toHaveLength(2);
    expect(prefs.album).toBe(true);
  });

  it('senza "anche aspetto" le impostazioni di questo dispositivo restano', () => {
    prefs.album = true;
    applica({ possedute: ['x'], preferenze: { album: false } }, false);
    expect(prefs.album).toBe(true);
    expect([...possedute]).toEqual(['x']);
  });

  it('il permesso delle notifiche e la frequenza di Drive restano di questo telefono', () => {
    prefs.avvisi = false;
    prefs.driveFreq = 'settimana';
    applica({ possedute: [], preferenze: { avvisi: true, driveFreq: 'giorno' } });
    expect(prefs.avvisi).toBe(false);
    expect(prefs.driveFreq).toBe('settimana');
  });

  it("accetta i backup delle primissime versioni (solo l'elenco delle monete)", () => {
    applica(['k1', 'k2']);
    expect(possedute.size).toBe(2);
  });

  it('rifiuta un file che non è un backup', () => {
    expect(() => {
      applica({ ciao: 1 } as unknown as Backup);
    }).toThrow();
  });
});
