import { html, nothing, render } from 'lit-html';
import { isola, libera } from './modale';

/**
 * Finestre di domanda nello stile dell'app, al posto di quelle di sistema di Android (prompt/confirm, con
 * "CANCEL/OK" in inglese): si aprono SOPRA quello che c'è (le impostazioni restano sotto).
 */
export interface OpzioniDialogo {
  titolo: string;
  testo?: string;
  campo?: { valore?: string; segnaposto?: string; max?: number };
  ok?: string;
  annulla?: string;
  pericolo?: boolean;
}

let aperto: { chiudi: (v: string | true | null) => void } | null = null;

export const dialogoAperto = (): boolean => aperto !== null;
export function chiudiDialogo(): void {
  aperto?.chiudi(null);
}

/** Restituisce il testo scritto (con `campo`), `true` per la conferma, `null` se si annulla. */
export function dialogo(o: OpzioniDialogo & { campo: NonNullable<OpzioniDialogo['campo']> }): Promise<string | null>;
export function dialogo(o: OpzioniDialogo): Promise<true | null>;
export function dialogo(o: OpzioniDialogo): Promise<string | true | null> {
  chiudiDialogo();
  // chiusa la finestra, il cursore (e TalkBack) torna dove si era prima di aprirla
  const primaDiAprire = document.activeElement;
  return new Promise(risolvi => {
    const el = document.createElement('div');
    el.className = 'dlg';
    el.setAttribute('role', 'dialog');
    // niente aria-modal: l'isolamento lo fa inert (ui/modale.ts). Con aria-modal il WebView di Android nasconde a
    // TalkBack tutto quello che sta fuori dalla finestra, compreso il messaggio in basso ("Annulla", risposte)
    el.setAttribute('aria-labelledby', 'dlg-titolo');
    let campo: HTMLInputElement | null = null;
    const chiudi = (v: string | true | null) => {
      if (!aperto) return;
      aperto = null;
      libera(el);
      el.classList.remove('show');
      setTimeout(() => {
        el.remove();
      }, 220);
      if (primaDiAprire instanceof HTMLElement && primaDiAprire.isConnected)
        primaDiAprire.focus({ preventScroll: true });
      risolvi(v);
    };
    const conferma = () => {
      if (campo) {
        const v = campo.value.trim();
        if (!v) {
          campo.focus();
          return;
        }
        chiudi(v);
      } else chiudi(true);
    };
    render(
      html`<div class="dlgbox">
        <h3 id="dlg-titolo">${o.titolo}</h3>
        ${o.testo ? html`<div class="muted">${o.testo}</div>` : nothing}
        ${
          o.campo
            ? html`<input
                class="search dlgin"
                type="text"
                maxlength=${o.campo.max ?? 60}
                placeholder=${o.campo.segnaposto ?? ''}
                aria-label=${o.titolo}
                autocomplete="off"
                spellcheck="false"
                .value=${o.campo.valore ?? ''}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    conferma();
                  }
                }}
              />`
            : nothing
        }
        <div class="dlgbtn">
          <button
            class="btn sec2"
            @click=${() => {
              chiudi(null);
            }}
          >
            ${o.annulla ?? 'Annulla'}
          </button>
          <button class="btn${o.pericolo ? ' danger' : ''}" @click=${conferma}>${o.ok ?? 'OK'}</button>
        </div>
      </div>`,
      el,
    );
    el.addEventListener('click', e => {
      if (e.target === el) chiudi(null);
    });
    document.body.appendChild(el);
    isola(el);
    campo = el.querySelector('.dlgin');
    aperto = { chiudi };
    requestAnimationFrame(() => {
      el.classList.add('show');
      if (campo) {
        const c = campo;
        setTimeout(() => {
          c.focus();
          c.select();
        }, 250);
      } else el.querySelector<HTMLButtonElement>('.dlgbtn .btn:last-child')?.focus();
    });
  });
}
