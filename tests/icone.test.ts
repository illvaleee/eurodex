// @vitest-environment jsdom
import { render } from 'lit-html';
import { describe, expect, it } from 'vitest';
import { ICONA, ICONA_GOOGLE } from '../src/ui/icone';

const SVG = 'http://www.w3.org/2000/svg';

/** Elementi dentro un <svg> che il browser non disegnerebbe (creati come HTML invece che come SVG). */
function fuoriDaSvg(radice: Element): string[] {
  return [...radice.querySelectorAll('svg *')].filter(e => e.namespaceURI !== SVG).map(e => e.localName);
}

describe('icone', () => {
  for (const [nome, icona] of Object.entries({ ...ICONA, google: ICONA_GOOGLE })) {
    it(`${nome}: tutte le forme sono SVG vere e la icona non è vuota`, () => {
      const box = document.createElement('div');
      render(icona, box);
      const disegno = box.querySelector('svg');
      expect(disegno?.namespaceURI).toBe(SVG);
      expect(fuoriDaSvg(box)).toEqual([]);
      expect(box.querySelectorAll('svg path, svg circle, svg rect').length).toBeGreaterThan(0);
    });
  }
});
