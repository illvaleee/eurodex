import { html, nothing } from 'lit-html';
import { $, $$ } from '../core/dom';
import { apriFoglio, chiudiFoglio } from './foglio';
import { ICONA } from './icone';

/**
 * Menu a tendina nello stile dell'app (al posto della finestra di sistema di Android): il <select> resta nascosto e
 * tiene il valore; il pulsante apre un pannello con le scelte e, alla scelta, cambia il <select> e manda lo stesso
 * evento "change".
 */

const selectDi = new WeakMap<HTMLButtonElement, HTMLSelectElement>();

export function miglioraSelect(radice: ParentNode): void {
  for (const sel of $$<HTMLSelectElement>('select:not([data-enh])', radice)) {
    sel.dataset.enh = '1';
    sel.hidden = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pick ${sel.className}`;
    b.setAttribute('aria-haspopup', 'dialog');
    const scelta = sel.options[sel.selectedIndex];
    const s = document.createElement('span');
    s.textContent = scelta?.text ?? '';
    b.append(s);
    const nome = sel.getAttribute('aria-label');
    if (nome) b.setAttribute('aria-label', `${nome}: ${scelta?.text ?? ''}`);
    selectDi.set(b, sel);
    sel.after(b);
  }
}

export function apriScelta(b: HTMLButtonElement): void {
  const sel = selectDi.get(b);
  if (!sel) return;
  const primo = sel.options[0];
  const titolo = sel.getAttribute('aria-label') ?? (primo?.value === '' ? primo.text : 'Scegli');
  const sceglie = (i: number) => {
    chiudiFoglio();
    if (sel.isConnected && sel.selectedIndex !== i) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  apriFoglio(
    html`<h2>${titolo}</h2>
      <div class="pklist" role="listbox" aria-label=${titolo}>
        ${[...sel.options].map((o, i) =>
          o.value === '' && i === 0
            ? nothing
            : html`<button
                role="option"
                data-i=${i}
                aria-selected=${i === sel.selectedIndex ? 'true' : 'false'}
                class=${i === sel.selectedIndex ? 'on' : ''}
                @click=${() => {
                  sceglie(i);
                }}
              >
                <span>${o.text.replace(/^Ordina: /, '')}</span>${i === sel.selectedIndex ? ICONA.check : nothing}
              </button>`,
        )}
      </div>`,
    'pick',
  );
  const on = $('.pklist .on');
  const dentro = $('.sheet .in');
  if (on && dentro && on.offsetTop > 300) dentro.scrollTop = on.offsetTop - 120;
}
