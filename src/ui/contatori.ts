import { avanzamento, elenco } from '../catalogo/ambiti';
import { pezzi, tuttiPezzi } from '../catalogo/indice';
import { possedute, prefs } from '../collezione/stato';
import { $, $$ } from '../core/dom';
import { numero, percentuale, plurale } from '../core/formato';
import { CIRCONFERENZA } from './componenti';
import { coloreMappa } from './mappa';
import { mancantiFiltrate } from '../viste/mancanti';

/**
 * Aggiorna sul posto tutti i numeri e le barre della pagina (e della scheda aperta) dopo una modifica, senza
 * ridisegnare: ogni elemento con data-scope="…" mostra l'avanzamento del suo gruppo.
 */
export function aggiornaContatori(): void {
  const vista = $('#main')?.dataset.v ?? '';
  if (vista === 'miss') {
    const el = $('[data-misscount]');
    if (el) el.textContent = plurale(mancantiFiltrate().length, 'mancante', 'mancanti');
  }
  if (vista === 'extra') {
    const contaExtra = (cc?: string) =>
      tuttiPezzi.filter(p => p.extra && (!cc || p.t.cc === cc) && !(prefs.noProof && p.proof) && possedute.has(p.key))
        .length;
    for (const gruppo of $$('[data-xgruppo]')) {
      const h = $(`[data-xnum="${gruppo.dataset.xgruppo ?? ''}"]`);
      if (h) h.textContent = `· ${numero(contaExtra(gruppo.dataset.cc))}/${numero(Number(h.dataset.xtot))}`;
    }
    const tot = $('[data-extratot]');
    if (tot) tot.textContent = numero(contaExtra());
  }
  if (vista === 'mine') {
    for (const gruppo of $$('[data-gruppo]')) {
      const h = $(`[data-gnum="${gruppo.dataset.gruppo ?? ''}"]`);
      if (h) h.textContent = `· ${numero(gruppo.querySelectorAll('[data-key].on').length)}`;
    }
    const tot = $('[data-minetot]');
    if (tot) tot.textContent = numero(pezzi.filter(p => possedute.has(p.key)).length);
  }
  for (const el of $$('[data-scope]')) {
    const [o, t] = avanzamento(elenco(el.dataset.scope ?? ''));
    const pct = t ? o / t : 0;
    // solo gli elementi di questo gruppo, non quelli di un gruppo annidato
    const miei = (sel: string) => $$(sel, el).filter(x => x.closest('[data-scope]') === el);
    for (const x of miei('[data-c]')) x.textContent = `${numero(o)}/${numero(t)}`;
    for (const x of miei('[data-p]')) x.textContent = `${String(percentuale(o, t))}%`;
    for (const x of miei('[data-o]')) x.textContent = numero(o);
    for (const x of miei('[data-miss]')) x.textContent = numero(t - o);
    // singolare e plurale che seguono i numeri ("1 posseduta", "Ne manca 1")
    for (const x of miei('[data-op]')) x.textContent = o === 1 ? 'posseduta' : 'possedute';
    for (const x of miei('[data-mp]')) x.textContent = t - o === 1 ? 'mancante' : 'mancanti';
    for (const x of miei('[data-mv]')) x.textContent = t - o === 1 ? 'manca' : 'mancano';
    for (const x of miei('[data-bar]')) x.style.width = `${pct * 100}%`;
    for (const x of $$<SVGElement>('[data-ring]', el)) x.style.strokeDashoffset = String(CIRCONFERENZA * (1 - pct));
    el.classList.toggle('done', t > 0 && o === t);
    el.classList.toggle('none', o === 0);
    // le barre dicono a TalkBack quanto sono piene
    for (const x of miei('.bar')) {
      x.setAttribute('role', 'progressbar');
      x.setAttribute('aria-valuemin', '0');
      x.setAttribute('aria-valuemax', String(t));
      x.setAttribute('aria-valuenow', String(o));
      x.setAttribute('aria-label', `${numero(o)} su ${numero(t)}`);
    }
  }
  for (const el of $$<SVGElement>('[data-mapcc]')) {
    const [o, t] = avanzamento(elenco(`cc:${el.dataset.mapcc ?? ''}`));
    el.style.fill = coloreMappa(t ? o / t : 0, o === t && t > 0);
  }
}
