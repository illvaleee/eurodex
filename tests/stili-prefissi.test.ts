import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// La compilazione (Vite 8) unisce una proprietà e la sua versione -webkit- in una sola, e vince quella scritta per
// ULTIMA. Con "backdrop-filter" prima e "-webkit-backdrop-filter" dopo, nell'APK restava solo la versione -webkit-,
// che Chrome e il WebView di Android non leggono: le barre in alto e in basso non sfocavano più (1.0.81, visto sul
// telefono vero e sull'emulatore). Quindi la versione -webkit- va sempre scritta prima di quella normale.
const css = readFileSync('src/stili/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocchi(): { selettore: string; proprieta: string[] }[] {
  const out: { selettore: string; proprieta: string[] }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const proprieta = (m[2] ?? '')
      .split(';')
      .map(d => (d.split(':')[0] ?? '').trim().toLowerCase())
      .filter(Boolean);
    out.push({ selettore: (m[1] ?? '').trim(), proprieta });
  }
  return out;
}

describe('stili: versione -webkit- prima di quella normale', () => {
  it('in ogni blocco, -webkit-X viene prima di X', () => {
    const sbagliati: string[] = [];
    for (const { selettore, proprieta } of blocchi())
      proprieta.forEach((p, i) => {
        if (!p.startsWith('-webkit-')) return;
        const normale = proprieta.indexOf(p.slice(8));
        if (normale >= 0 && normale < i) sbagliati.push(`${selettore}: ${p.slice(8)} prima di ${p}`);
      });
    expect(sbagliati).toEqual([]);
  });

  it('le barre in alto e in basso hanno lo sfocato normale', () => {
    for (const sel of ['header.top', 'nav.tabs']) {
      const b = blocchi().find(x => x.selettore === sel);
      expect(b?.proprieta).toContain('backdrop-filter');
    }
  });
});
