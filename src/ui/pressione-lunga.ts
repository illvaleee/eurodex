import { html, nothing } from 'lit-html';
import { avanzamento, elenco } from '../catalogo/ambiti';
import { bandiera, nomePaese, pezzoPerChiave, tipoPerId } from '../catalogo/indice';
import { anni, nomeTipo, sottotitoloTipo } from '../catalogo/proprieta';
import type { Pezzo, Tipo } from '../catalogo/tipi';
import { preferite } from '../collezione/stato';
import { numero } from '../core/formato';
import { apriFoglio } from './foglio';

/** Pressione lunga su un paese, un anno o una moneta: si segna (o si toglie) tutto il gruppo in un colpo. */

interface Gruppo {
  titolo: string;
  sotto: string;
  chiavi: string[];
  tipo?: Tipo;
}

function gruppoDi(ambito: string): Gruppo | null {
  const i = ambito.indexOf(':');
  const k = ambito.slice(0, i);
  const v = ambito.slice(i + 1);
  if (k === 'type') {
    const t = tipoPerId[v];
    if (!t) return null;
    return {
      titolo: `${bandiera(t.cc)} ${nomeTipo(t)}`,
      sotto: t.commem ? `${nomePaese(t.cc)} · ${anni(t)}` : sottotitoloTipo(t),
      chiavi: t.pieces.map(p => p.key),
      tipo: t,
    };
  }
  const lista = elenco(ambito);
  if (!lista.length) return null;
  const [cc = '', y = ''] = v.split('/');
  const titoli: Record<string, () => string> = {
    cc: () => `${bandiera(v)} ${nomePaese(v)}`,
    year: () => `Tutte le monete del ${v}`,
    cyear: () => `${bandiera(cc)} ${nomePaese(cc)} · ${y}`,
    ccy: () => `${bandiera(cc)} ${nomePaese(cc)} · ${y}`,
    cyc: () => `2 euro commemorativi del ${v}`,
  };
  return { titolo: (titoli[k] ?? (() => ambito))(), sotto: '', chiavi: lista.map(p => p.key) };
}

export const scelta = { chiavi: [] as string[], senzaProof: [] as string[], nome: '' };

function apri(ambito: string): void {
  const g = gruppoDi(ambito);
  if (!g) return;
  const ps = g.chiavi.map(k => pezzoPerChiave[k]).filter((p): p is Pezzo => !!p);
  const [o, n] = avanzamento(ps);
  const senzaProof = ps.filter(p => !p.proof).map(p => p.key);
  Object.assign(scelta, { chiavi: g.chiavi, senzaProof, nome: g.titolo });
  apriFoglio(
    html`<h2>${g.titolo}</h2>
      ${g.sotto ? html`<div class="muted">${g.sotto}</div>` : nothing}
      <div class="muted small" style="margin-top:6px">Ne hai ${numero(o)} su ${numero(n)}</div>
      <button class="btn" data-act="lpall" data-v="1">Segna tutte (${numero(n)})</button>
      ${
        senzaProof.length < n
          ? html`<button class="btn sec2" data-act="lpnp">
              Segna tutte tranne le proof (${numero(senzaProof.length)})
            </button>`
          : nothing
      }
      <button class="btn sec2" data-act="lpall" data-v="0">Togli tutte</button>
      ${
        g.tipo
          ? html`<button class="btn sec2" data-act="fav" data-id=${g.tipo.id}>
                ${preferite.has(g.tipo.id) ? '★ Togli dalle preferite' : '☆ Aggiungi alle preferite'}</button
              ><button class="btn sec2" data-detail=${g.tipo.id}>Apri la scheda</button>`
          : nothing
      }
      <button class="btn ghost" data-act="close">Annulla</button>`,
  );
}

let timer: ReturnType<typeof setTimeout> | undefined;
let partenza: { x: number; y: number } | null = null;
let scattata = false;

/** Vero (una volta) se il tocco appena finito era una pressione lunga: il clic che segue non deve fare altro. */
export function consumaPressioneLunga(): boolean {
  if (!scattata) return false;
  scattata = false;
  return true;
}

export function attivaPressioneLunga(): void {
  document.addEventListener('pointerdown', e => {
    if (!(e.target instanceof Element)) return;
    const el = e.target.closest<HTMLElement>('[data-lp]');
    if (!el || e.target.closest('[data-key]')) return;
    partenza = { x: e.clientX, y: e.clientY };
    scattata = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      scattata = true;
      if ('vibrate' in navigator) navigator.vibrate(18);
      apri(el.dataset.lp ?? '');
    }, 560);
  });
  document.addEventListener('pointermove', e => {
    if (partenza && Math.hypot(e.clientX - partenza.x, e.clientY - partenza.y) > 10) {
      clearTimeout(timer);
      partenza = null;
    }
  });
  for (const ev of ['pointerup', 'pointercancel'])
    document.addEventListener(ev, () => {
      clearTimeout(timer);
      partenza = null;
    });
  document.addEventListener('contextmenu', e => {
    if (e.target instanceof Element && e.target.closest('[data-lp]')) e.preventDefault();
  });
}
