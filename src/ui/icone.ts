import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit-html';

/** Icone dell'app (tratto, 24×24, colore del testo). */
// Il contenuto va scritto con svg`…`: con html`…` lit-html crea gli elementi fuori dallo spazio SVG e l'icona non si
// vede (il browser li tratta come tag HTML sconosciuti).
const tratto = (contenuto: SVGTemplateResult, spessore = 1.8) =>
  html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width=${spessore}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${contenuto}
  </svg>`;

export const ICONA = {
  back: tratto(svg`<path d="M15 18l-6-6 6-6" />`, 2),
  coll: tratto(svg`<circle cx="9" cy="9" r="6" /><path d="M15.5 4.6A6 6 0 1 1 9.4 15" />`),
  cat: tratto(
    svg`<rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect
        x="3.5"
        y="13.5"
        width="7"
        height="7"
        rx="2"
      /><rect x="13.5" y="13.5" width="7" height="7" rx="2" />`,
  ),
  miss: tratto(svg`<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.6" /><path d="M12 8v8M8 12h8" />`),
  extra: tratto(
    svg`<path d="M12 3.2l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.1l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z" /><path
        d="M12 9.6v4.2M9.9 11.7h4.2"
      />`,
  ),
  mine: tratto(
    svg`<circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5.2" /><path d="M9.8 12.1l1.5 1.5 2.9-3.1" />`,
  ),
  search: tratto(svg`<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />`),
  gear: tratto(
    svg`<circle cx="12" cy="12" r="3" /><path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      />`,
  ),
  eye: tratto(svg`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />`),
  eyeoff: tratto(
    svg`<path
      d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"
    />`,
  ),
  list: tratto(svg`<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />`, 2),
  grid: tratto(
    svg`<circle cx="6" cy="6" r="2.5" /><circle cx="12" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle
        cx="6"
        cy="13"
        r="2.5"
      /><circle cx="12" cy="13" r="2.5" /><circle cx="18" cy="13" r="2.5" /><circle cx="6" cy="20" r="2.5" /><circle
        cx="12"
        cy="20"
        r="2.5"
      />`,
    2,
  ),
  share: tratto(svg`<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />`, 2),
  down: tratto(svg`<path d="M12 3v12M7 10l5 5 5-5M5 21h14" />`, 2),
  cloud: tratto(svg`<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z" />`),
  warn: tratto(svg`<path d="M12 3l10 18H2zM12 10v4M12 17.5v.01" />`),
  spark: tratto(svg`<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />`),
  check: tratto(svg`<path d="M5 12.5l4.5 4.5L19 7.5" />`, 2.4),
  clock: tratto(svg`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />`),
  telefono: tratto(svg`<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" />`, 2),
  tablet: tratto(svg`<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M11 17.5h2" />`, 2),
} satisfies Record<string, TemplateResult>;

/** Logo di Google (colori ufficiali), per i pulsanti "Accedi con Google". */
export const ICONA_GOOGLE = html`<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path
    fill="#FFC107"
    d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
  />
  <path
    fill="#FF3D00"
    d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
  />
  <path
    fill="#4CAF50"
    d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
  />
  <path
    fill="#1976D2"
    d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
  />
</svg>`;
