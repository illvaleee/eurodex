import { html, nothing, render, type TemplateResult } from 'lit-html';
import { prefs, salva } from '../collezione/stato';
import { $ } from '../core/dom';
import { casuale } from '../core/rete';
import { Nativo, nativo } from '../nativo/plugin';
import { avviso } from './avvisi';

/**
 * Sfondo personalizzato: qualsiasi colore (ruota dei colori) o una propria foto, con l'intensità dall'1% al 100%
 * (quanto colore o quanta foto si vede rispetto allo sfondo normale dell'app).
 */

type Rgb = [number, number, number];

const SFONDI_VECCHI: Record<string, string> = {
  cielo: '#7FA6F5',
  oro: '#C9A04A',
  salvia: '#6FAE88',
  cipria: '#D9849F',
  lavanda: '#9B86E4',
  notte: '#1A3A63',
};
const COLORE_INIZIALE = '#7FA6F5';

export function daHex(h: string | undefined): Rgb {
  const n = parseInt((h ?? COLORE_INIZIALE).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const aHex = (c: readonly number[]): string =>
  `#${c
    .map(x =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const mescola = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Luminanza relativa (WCAG). */
export function luminanza(c: readonly number[]): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0] ?? 0) + 0.7152 * f(c[1] ?? 0) + 0.0722 * f(c[2] ?? 0);
}

export function hsvRgb(h: number, s: number, v: number): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

export function rgbHsv([r0, g0, b0]: Rgb): [number, number, number] {
  const [r, g, b] = [r0 / 255, g0 / 255, b0 / 255];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

// ───────── foto salvata nel telefono (IndexedDB) ─────────

function db(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('eurodex', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('file');
    r.onsuccess = () => {
      ok(r.result);
    };
    r.onerror = () => {
      ko(r.error ?? new Error('IndexedDB'));
    };
  });
}

async function metti(k: string, v: Blob | string): Promise<void> {
  const d = await db();
  return new Promise((ok, ko) => {
    const tx = d.transaction('file', 'readwrite');
    tx.objectStore('file').put(v, k);
    tx.oncomplete = () => {
      ok();
    };
    tx.onerror = () => {
      ko(tx.error ?? new Error('IndexedDB'));
    };
  });
}

export async function prendi<T extends Blob | string>(k: string): Promise<T | null> {
  const d = await db();
  return new Promise(ok => {
    const rq = d.transaction('file').objectStore('file').get(k);
    rq.onsuccess = () => {
      ok((rq.result as T | undefined) ?? null);
    };
    rq.onerror = () => {
      ok(null);
    };
  });
}

let urlFoto: string | null = null;
/** Copia compatta della foto, che va nei file di backup. */
let fotoBase64: string | null = null;
export const fotoPerBackup = (): string | null => fotoBase64;

function apriImmagine(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => {
      ok(i);
    };
    i.onerror = () => {
      ko(new Error('immagine'));
    };
    i.src = url;
  });
}

function ridimensiona(img: HTMLImageElement, lato: number): HTMLCanvasElement {
  const k = Math.min(1, lato / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function compatta(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    return ridimensiona(await apriImmagine(url), 1100).toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function caricaFotoPerBackup(): Promise<void> {
  try {
    fotoBase64 = await prendi<string>('sfondo64');
    if (!fotoBase64 && prefs.sfondo === 'foto') {
      const b = await prendi<Blob>('sfondo');
      if (b) {
        fotoBase64 = await compatta(b);
        await metti('sfondo64', fotoBase64);
        if (!prefs.fotoId) {
          prefs.fotoId = casuale(10);
          salva();
        }
      }
    }
  } catch {
    // senza IndexedDB lo sfondo resta quello normale
  }
}

export async function impostaFotoDaBackup(b64: string): Promise<void> {
  const blob = await (await fetch(b64)).blob();
  await metti('sfondo', blob);
  await metti('sfondo64', b64);
  fotoBase64 = b64;
  if (urlFoto) URL.revokeObjectURL(urlFoto);
  urlFoto = null;
  await indirizzoFoto();
}

async function indirizzoFoto(): Promise<string | null> {
  if (urlFoto) return urlFoto;
  try {
    const b = await prendi<Blob>('sfondo');
    if (b) urlFoto = URL.createObjectURL(b);
  } catch {
    // nessuna foto
  }
  return urlFoto;
}

/** Colore medio della foto (serve a scegliere testi chiari o scuri sopra lo sfondo). */
function coloreMedio(img: HTMLImageElement): string {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  if (!x) return COLORE_INIZIALE;
  x.drawImage(img, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  const m: Rgb = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    m[0] += d[i] ?? 0;
    m[1] += d[i + 1] ?? 0;
    m[2] += d[i + 2] ?? 0;
  }
  return aHex(m.map(v => v / 256));
}

const temaScuro = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function applicaSfondo(): void {
  const h = document.documentElement;
  const vecchio = prefs.sfondo ? SFONDI_VECCHI[prefs.sfondo] : undefined;
  if (vecchio) {
    prefs.colore = vecchio;
    prefs.sfondo = 'colore';
    prefs.sfondoVis ??= 35;
  }
  const s = prefs.sfondo === 'colore' || prefs.sfondo === 'foto' ? prefs.sfondo : 'predefinito';
  const scuro = temaScuro();
  const base: Rgb = scuro ? [14, 16, 20] : [245, 246, 248];
  const vis = Math.min(100, Math.max(1, prefs.sfondoVis ?? 40)) / 100;
  for (const v of ['--pagina', '--sfondo', '--hdr', '--velo']) h.style.removeProperty(v);
  h.classList.toggle('tema', s !== 'predefinito');
  if (s === 'predefinito') delete h.dataset.sfondo;
  else h.dataset.sfondo = s;
  let effetto = base;
  if (s === 'colore') {
    const c = daHex(prefs.colore);
    const sopra = mescola(base, c, vis);
    const sotto = mescola(base, c, vis * 0.6);
    h.style.setProperty('--pagina', aHex(sopra));
    h.style.setProperty(
      '--sfondo',
      `linear-gradient(170deg, ${aHex(sopra)} 0%, ${aHex(mescola(sopra, sotto, 0.5))} 50%, ${aHex(sotto)} 100%)`,
    );
    h.style.setProperty('--hdr', `rgba(${sopra.map(Math.round).join(',')},.86)`);
    effetto = mescola(sopra, sotto, 0.3);
  }
  if (s === 'foto') {
    h.style.setProperty('--velo', String(1 - vis));
    if (prefs.fotoMedia) {
      effetto = mescola(base, daHex(prefs.fotoMedia), vis);
      h.style.setProperty('--hdr', `rgba(${effetto.map(Math.round).join(',')},.88)`);
      h.style.setProperty('--pagina', aHex(effetto));
    }
    void indirizzoFoto().then(u => {
      if (!u) {
        prefs.sfondo = 'predefinito';
        salva();
        applicaSfondo();
        return;
      }
      h.style.setProperty('--foto', `url("${u}")`);
      if (!prefs.fotoMedia)
        void apriImmagine(u).then(i => {
          prefs.fotoMedia = coloreMedio(i);
          salva();
          applicaSfondo();
        });
    });
  }
  // testi che stanno direttamente sullo sfondo (titolo, intestazioni, note): chiari su sfondo scuro e viceversa
  const L = luminanza(effetto);
  h.classList.toggle('bgscuro', L < 0.28);
  h.classList.toggle('bgchiaro', L > 0.5 && scuro);
  coloraBarre();
}

/** Barre di sistema: chiare durante l'animazione (fondo blu), poi come il tema dell'app. */
export function coloraBarre(): void {
  if (!nativo()) return;
  const intro = $('#intro:not(.out)');
  const scuro = temaScuro();
  const cs = getComputedStyle(document.documentElement);
  const colore = intro
    ? '#081627'
    : cs.getPropertyValue('--pagina').trim() ||
      getComputedStyle(document.body).getPropertyValue('--bg').trim() ||
      (scuro ? '#0E1014' : '#F5F6F8');
  const cl = document.documentElement.classList;
  Nativo.barre({ colore, iconeChiare: !!intro || (scuro ? !cl.contains('bgchiaro') : cl.contains('bgscuro')) }).catch(
    () => undefined,
  );
}

export function sceltaSfondo(): TemplateResult {
  const s = prefs.sfondo === 'colore' || prefs.sfondo === 'foto' ? prefs.sfondo : 'predefinito';
  const vis = prefs.sfondoVis ?? 40;
  const [, , v] = rgbHsv(daHex(prefs.colore));
  const colore = prefs.colore ?? COLORE_INIZIALE;
  return html`<div class="seg" role="radiogroup" aria-label="Sfondo">
      ${(
        [
          ['predefinito', 'Classico'],
          ['colore', 'Colore'],
          ['foto', 'Foto'],
        ] as const
      ).map(
        ([k, nome]) =>
          html`<button
            class=${s === k ? 'on' : ''}
            data-act="sfondo"
            data-v=${k}
            role="radio"
            aria-checked=${s === k ? 'true' : 'false'}
          >
            ${nome}
          </button>`,
      )}
    </div>
    ${
      s === 'colore'
        ? html`<div class="ruotabox">
              <canvas
                class="ruota"
                width="440"
                height="440"
                aria-label="Ruota dei colori: tocca o trascina per scegliere"
              ></canvas
              ><i class="ruotacur"></i>
            </div>
            <div class="colsel">
              <i id="colprev" style="background:${colore}"></i><span id="colhex">${colore.toUpperCase()}</span>
            </div>
            <div class="rng">
              <span>Luminosità del colore</span
              ><input
                type="range"
                id="bglum"
                min="5"
                max="100"
                step="1"
                .value=${String(Math.round(v * 100))}
                aria-label="Luminosità del colore"
              />
            </div>`
        : nothing
    }
    ${
      s === 'foto'
        ? html`<label class="btn sec2 lbtn"
            >${urlFoto ? 'Cambia foto' : 'Scegli una foto'}<input type="file" id="bgfile" accept="image/*" hidden
          /></label>`
        : nothing
    }
    ${
      s !== 'predefinito'
        ? html`<div class="rng">
            <span>Intensità <b id="visval">${vis}%</b></span
            ><input
              type="range"
              id="bgvis"
              min="1"
              max="100"
              step="1"
              .value=${String(vis)}
              aria-label="Intensità dello sfondo"
            />
          </div>`
        : nothing
    }`;
}

export function ridisegnaSceltaSfondo(): void {
  const box = $('#sfondobox');
  if (!box) return;
  render(sceltaSfondo(), box);
  disegnaRuota();
}

/** Ruota dei colori: il giro dà la tinta, la distanza dal centro quanto è intensa; la luminosità ha il suo cursore. */
export function disegnaRuota(): void {
  const cv = $<HTMLCanvasElement>('.ruota');
  const x = cv?.getContext('2d');
  if (!cv || !x) return;
  const L = cv.width;
  const R = L / 2;
  const img = x.createImageData(L, L);
  const d = img.data;
  for (let py = 0; py < L; py++)
    for (let px = 0; px < L; px++) {
      const dx = px - R;
      const dy = py - R;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > R) continue;
      const i = (py * L + px) * 4;
      const [cr, cg, cb] = hsvRgb(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, r / R, 1);
      d[i] = cr;
      d[i + 1] = cg;
      d[i + 2] = cb;
      d[i + 3] = r > R - 1.5 ? (255 * (R - r)) / 1.5 : 255;
    }
  x.putImageData(img, 0, 0);
  posizionaCursore();
  let premuto = false;
  let fotogramma = 0;
  const scegli = (e: PointerEvent) => {
    const b = cv.getBoundingClientRect();
    const dx = e.clientX - b.left - b.width / 2;
    const dy = e.clientY - b.top - b.height / 2;
    const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (b.width / 2));
    const tinta = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const lum = Number($<HTMLInputElement>('#bglum')?.value ?? 100) / 100;
    prefs.colore = aHex(hsvRgb(tinta, sat, lum));
    posizionaCursore();
    cancelAnimationFrame(fotogramma);
    fotogramma = requestAnimationFrame(applicaSfondo);
  };
  cv.addEventListener('pointerdown', e => {
    premuto = true;
    cv.setPointerCapture(e.pointerId);
    scegli(e);
  });
  cv.addEventListener('pointermove', e => {
    if (premuto) scegli(e);
  });
  const fine = () => {
    if (premuto) {
      premuto = false;
      salva();
    }
  };
  cv.addEventListener('pointerup', fine);
  cv.addEventListener('pointercancel', fine);
}

export function posizionaCursore(): void {
  const cv = $('.ruota');
  const cur = $('.ruotacur');
  if (!cv || !cur) return;
  const colore = prefs.colore ?? COLORE_INIZIALE;
  const [h, s] = rgbHsv(daHex(colore));
  const a = (h * Math.PI) / 180;
  const r = s * 50;
  cur.style.left = `${50 + Math.cos(a) * r}%`;
  cur.style.top = `${50 + Math.sin(a) * r}%`;
  cur.style.background = colore;
  const anteprima = $('#colprev');
  const hex = $('#colhex');
  if (anteprima) anteprima.style.background = colore;
  if (hex) hex.textContent = colore.toUpperCase();
}

/** Cursore della luminosità: cambia solo la luminosità del colore scelto. */
export function cambiaLuminosita(v: number): void {
  const [h, s] = rgbHsv(daHex(prefs.colore));
  prefs.colore = aHex(hsvRgb(h, s, v / 100));
  posizionaCursore();
  applicaSfondo();
}

export async function scegliFoto(file: File): Promise<void> {
  try {
    const url = URL.createObjectURL(file);
    const img = await apriImmagine(url);
    const c = ridimensiona(img, 1600);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>(ok => {
      c.toBlob(ok, 'image/jpeg', 0.85);
    });
    if (!blob) throw new Error('immagine');
    await metti('sfondo', blob);
    fotoBase64 = await compatta(blob);
    await metti('sfondo64', fotoBase64);
    if (urlFoto) URL.revokeObjectURL(urlFoto);
    urlFoto = null;
    prefs.sfondo = 'foto';
    prefs.fotoMedia = coloreMedio(img);
    prefs.fotoId = casuale(10);
    prefs.sfondoVis ??= 40;
    salva();
    await indirizzoFoto();
    applicaSfondo();
    ridisegnaSceltaSfondo();
    avviso('Sfondo impostato ✓');
  } catch {
    avviso('Questa immagine non si riesce ad aprire');
  }
}

/** Tocco su Classico / Colore / Foto. */
export function cambiaSfondo(s: 'predefinito' | 'colore' | 'foto'): void {
  if (s === 'colore' && !prefs.colore) prefs.colore = COLORE_INIZIALE;
  prefs.sfondo = s;
  salva();
  applicaSfondo();
  ridisegnaSceltaSfondo();
  if (s === 'foto' && !urlFoto)
    void indirizzoFoto().then(u => {
      if (u) ridisegnaSceltaSfondo();
    });
}
