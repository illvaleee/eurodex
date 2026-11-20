import { Share } from '@capacitor/share';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { bandiera, nomePaese, tuttiPezzi } from '../catalogo/indice';
import type { Pezzo } from '../catalogo/tipi';
import { TAGLIO } from '../core/costanti';
import { neutralizza } from '../core/testo';
import { numero, oggiIso } from '../core/formato';
import { nativo, annullato } from '../nativo/plugin';
import { ordina } from '../viste/ordine';
import { note, possedute } from './stato';

/** Condivisione e file da esportare (CSV, lista da stampare, backup). */

export async function condividiTesto(titolo: string, testo: string): Promise<'condiviso' | 'copiato' | 'no'> {
  if (nativo()) {
    try {
      await Share.share({ title: titolo, text: testo, dialogTitle: titolo });
      return 'condiviso';
    } catch (e) {
      if (annullato(e)) return 'condiviso';
    }
  }
  try {
    await navigator.share({ title: titolo, text: testo });
    return 'condiviso';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'condiviso';
  }
  try {
    await navigator.clipboard.writeText(testo);
    return 'copiato';
  } catch {
    return 'no';
  }
}

/** Byte in base64 (a pezzi: con file grandi un'unica conversione supererebbe i limiti degli argomenti). */
function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export type EsitoFile = 'condiviso' | 'annullato' | 'errore';

/**
 * Salva un file (testo o byte, come un PDF) e apre la condivisione di Android; nel browser lo scarica.
 * "annullato" se l'utente chiude la condivisione senza scegliere niente.
 */
export async function condividiFile(
  nome: string,
  dati: string | Uint8Array,
  tipo: string,
  titolo: string,
): Promise<EsitoFile> {
  if (nativo()) {
    // nell'app il download del browser non esiste: se la condivisione non riesce si dice che non è riuscita
    try {
      const r = await Filesystem.writeFile(
        typeof dati === 'string'
          ? { path: nome, data: dati, directory: Directory.Cache, encoding: Encoding.UTF8 }
          : { path: nome, data: base64(dati), directory: Directory.Cache },
      );
      await Share.share({ title: titolo, url: r.uri, dialogTitle: titolo });
      return 'condiviso';
    } catch (e) {
      return annullato(e) ? 'annullato' : 'errore';
    }
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([typeof dati === 'string' ? dati : dati.slice().buffer], { type: tipo }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    return 'condiviso';
  } catch {
    return 'errore';
  }
}

const cella = (v: string | number): string =>
  /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

/** Stesso formato della vecchia app, così il file si reimporta ovunque. */
export function csvCollezione(soloMancanti: boolean, lista?: readonly Pezzo[]): string {
  const righe = [['Paese', 'Anno', 'Valore', 'Segno', 'Titolo', 'Proof', 'Tiratura', 'Posseduta', 'Nota'].join(';')];
  for (const p of ordina(lista ?? tuttiPezzi, 'paese')) {
    if (soloMancanti && possedute.has(p.key)) continue;
    const centesimi = p.t.denom === '1e' ? 100 : p.t.denom === '2e' ? 200 : parseInt(p.t.denom, 10);
    righe.push(
      [
        p.t.cc.toLowerCase(),
        p.y,
        centesimi,
        p.m || '-',
        p.t.commem ? p.t.design || p.t.title : '-',
        p.proof ? 'S' : 'N',
        p.mint ?? '',
        possedute.has(p.key) ? 'S' : 'N',
        note[p.t.id] ?? '',
      ]
        .map(cella)
        .join(';'),
    );
  }
  return `\uFEFF${righe.join('\n')}`;
}

/** Pagina HTML a sé (si apre nel browser o si condivide) con la lista da stampare. */
export function paginaDaStampare(lista: readonly Pezzo[], titolo: string): string {
  let corpo = '';
  let cc: string | null = null;
  for (const p of lista) {
    if (p.t.cc !== cc) {
      if (cc) corpo += '</tbody></table>';
      cc = p.t.cc;
      corpo += `<h2>${bandiera(cc)} ${neutralizza(nomePaese(cc))}</h2><table><tbody>`;
    }
    corpo += `<tr><td class="b">${possedute.has(p.key) ? '☑' : '☐'}</td><td>${p.t.commem ? '2 € comm.' : TAGLIO[p.t.denom].label}</td><td>${p.y}</td><td>${neutralizza(p.m)}${p.proof ? ' proof' : ''}</td><td>${p.t.commem ? neutralizza(p.t.design || '') : ''}</td></tr>`;
  }
  if (cc) corpo += '</tbody></table>';
  const stile =
    'body{font:12px system-ui,sans-serif;margin:24px}h1{font-size:18px}h2{font-size:14px;margin:18px 0 6px;break-after:avoid}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:3px 6px}td.b{width:18px;font-size:14px}';
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${neutralizza(titolo)}</title><style>${stile}</style></head><body><h1>${neutralizza(titolo)}</h1><div>${oggiIso().split('-').reverse().join('/')} · ${numero(lista.length)} monete</div>${corpo}</body></html>`;
}

export async function stampa(lista: readonly Pezzo[], titolo: string, nome: string): Promise<EsitoFile> {
  const pagina = paginaDaStampare(lista, titolo);
  if (nativo()) return condividiFile(nome, pagina, 'text/html', titolo);
  const url = URL.createObjectURL(new Blob([pagina], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    return condividiFile(nome, pagina, 'text/html', titolo);
  }
  w.addEventListener('load', () => {
    w.print();
    URL.revokeObjectURL(url);
  });
  return 'condiviso';
}
