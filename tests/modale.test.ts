// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isola, libera } from '../src/ui/modale';

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`manca #${id}`);
  return e;
}
const inerti = () => ['app', 'nav', 'scheda', 'domanda', 'toast'].filter(id => el(id).hasAttribute('inert'));

describe('finestre sopra la pagina', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="app"></div><nav id="nav"></nav><div id="scheda"></div><div id="domanda"></div><div id="toast"></div>';
  });

  it('con una finestra aperta il resto non si raggiunge (tranne il messaggio "Annulla")', () => {
    isola(el('scheda'));
    expect(inerti()).toEqual(['app', 'nav', 'domanda']);
    libera(el('scheda'));
    expect(inerti()).toEqual([]);
  });

  it('una sopra l’altra: si raggiunge solo quella in cima, in qualsiasi ordine si chiudano', () => {
    isola(el('scheda'));
    isola(el('domanda'));
    expect(inerti()).toEqual(['app', 'nav', 'scheda']);
    libera(el('scheda')); // chiusa prima quella sotto
    expect(inerti()).toEqual(['app', 'nav', 'scheda']);
    libera(el('domanda'));
    expect(inerti()).toEqual([]);
  });

  it('riaprire la stessa finestra non la conta due volte', () => {
    isola(el('scheda'));
    isola(el('scheda'));
    libera(el('scheda'));
    expect(inerti()).toEqual([]);
  });
});
