import { describe, expect, it } from 'vitest';
import { ErroreArchivio, motivoArchivio, nomeApk } from '../src/core/archivio';

describe('versioni e catalogo da Storage (passo 5)', () => {
  it('il codice della parte nativa diventa il motivo', () => {
    expect(motivoArchivio({ code: 'SENZA_SESSIONE' })).toBe('senzaSessione');
    expect(motivoArchivio({ code: 'NEGATO' })).toBe('negato');
    expect(motivoArchivio({ code: 'ASSENTE' })).toBe('assente');
    expect(motivoArchivio({ code: 'RETE' })).toBe('rete');
    expect(motivoArchivio(new Error('qualunque'))).toBe('rete');
    expect(motivoArchivio(null)).toBe('rete');
    const e = new ErroreArchivio('negato', 'no');
    expect(e).toBeInstanceOf(Error);
    expect(e.motivo).toBe('negato');
  });

  it("il nome dell'APK da version.json diventa un percorso solo se è un nome semplice", () => {
    expect(nomeApk({ apk: 'CollezioneEuro-1.0.84.apk' })).toBe('CollezioneEuro-1.0.84.apk');
    for (const cattivo of [
      '../segreti.apk',
      'rilasci/x.apk',
      'x.apk?alt=media',
      'x.APK.exe',
      '',
      'a'.repeat(81) + '.apk',
      42,
      null,
    ])
      expect(nomeApk({ apk: cattivo })).toBeNull();
    expect(nomeApk({})).toBeNull();
    expect(nomeApk(null)).toBeNull();
    expect(nomeApk(undefined)).toBeNull();
  });
});
