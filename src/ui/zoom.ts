import { html, render } from 'lit-html';
import { bandiera, tipoPerId } from '../catalogo/indice';
import { nomeTipo } from '../catalogo/proprieta';
import type { Faccia } from '../catalogo/tipi';
import { necessario } from '../core/dom';
import { isola, libera } from './modale';
import { disegnoMoneta, fotoTipo } from './monete';

/** Foto a schermo intero: pizzica o tocca due volte per ingrandire, trascina per spostarla. */

const z = {
  s: 1,
  x: 0,
  y: 0,
  id: '',
  faccia: 'nat' as Faccia,
  punti: new Map<number, { x: number; y: number }>(),
  d0: 0,
  s0: 1,
  x0: 0,
  y0: 0,
  ultimo: 0,
};

function applica(): void {
  necessario('#zoomin').style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`;
}

export function apriZoom(id: string, faccia: Faccia): void {
  const t = tipoPerId[id];
  if (!t) return;
  Object.assign(z, { id, faccia, s: 1, x: 0, y: 0 });
  const src = fotoTipo(t, faccia);
  render(
    src ? html`<img src=${src} alt="" draggable="false" />` : disegnoMoneta(t, faccia, 300),
    necessario('#zoomin'),
  );
  const lato = faccia === 'common' ? 'lato comune' : t.commem ? 'lato commemorativo' : 'lato nazionale';
  necessario('#zcap').textContent = `${bandiera(t.cc)} ${nomeTipo(t)} · ${lato}`;
  const box = necessario('#zoom');
  isola(box);
  box.classList.add('show');
  box.setAttribute('aria-hidden', 'false');
  applica();
}

export const giraZoom = (): void => {
  apriZoom(z.id, z.faccia === 'nat' ? 'common' : 'nat');
};

export function chiudiZoom(): void {
  const box = necessario('#zoom');
  libera(box);
  box.classList.remove('show');
  box.setAttribute('aria-hidden', 'true');
}

export const zoomAperto = (): boolean => necessario('#zoom').classList.contains('show');

export function attivaGestiZoom(): void {
  const box = necessario('#zoom');
  box.addEventListener('pointerdown', e => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    box.setPointerCapture(e.pointerId);
    z.punti.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.punti.size === 2) {
      const [a, b] = [...z.punti.values()];
      if (a && b) z.d0 = Math.hypot(a.x - b.x, a.y - b.y);
      z.s0 = z.s;
    } else {
      z.x0 = e.clientX - z.x;
      z.y0 = e.clientY - z.y;
      const ora = Date.now();
      if (ora - z.ultimo < 300) {
        z.s = z.s > 1 ? 1 : 2.6;
        if (z.s === 1) Object.assign(z, { x: 0, y: 0 });
        applica();
      }
      z.ultimo = ora;
    }
  });
  box.addEventListener('pointermove', e => {
    if (!z.punti.has(e.pointerId)) return;
    z.punti.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.punti.size === 2) {
      const [a, b] = [...z.punti.values()];
      if (a && b) z.s = Math.min(6, Math.max(1, (z.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / (z.d0 || 1)));
    } else if (z.s > 1) {
      z.x = e.clientX - z.x0;
      z.y = e.clientY - z.y0;
    }
    applica();
  });
  const su = (e: PointerEvent) => {
    z.punti.delete(e.pointerId);
    const [a] = [...z.punti.values()];
    if (z.punti.size === 1 && a) {
      z.x0 = a.x - z.x;
      z.y0 = a.y - z.y;
    }
    if (z.s <= 1.02) {
      Object.assign(z, { s: 1, x: 0, y: 0 });
      applica();
    }
  };
  box.addEventListener('pointerup', su);
  box.addEventListener('pointercancel', su);
  box.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      z.s = Math.min(6, Math.max(1, z.s * (e.deltaY < 0 ? 1.15 : 0.87)));
      if (z.s === 1) Object.assign(z, { x: 0, y: 0 });
      applica();
    },
    { passive: false },
  );
}
