import { jsPDF } from 'jspdf';
import { catalogo, nomePaese, ordinePaesi, tuttiPezzi } from '../catalogo/indice';
import { numero, percentuale } from '../core/formato';
import { possedute } from './stato';
import { COLONNE, INTESTAZIONI, tabelleCatalogo, type Cella, type Tabella } from './tabelle-catalogo';

/**
 * PDF del catalogo base, come il foglio di carta dei collezionisti: una pagina per paese (per la Germania una per
 * zecca) con la tabella anni × tagli. Le monete che ci sono hanno il tratto blu, quelle che mancano la casella
 * bianca, quelle mai coniate la casella gialla sbarrata. Prima pagina con il riepilogo e la legenda.
 * Il PDF si disegna qui, nel telefono, anche senza rete (jsPDF: testo e linee vere, non immagini).
 */

type Rgb = readonly [number, number, number];
const NERO: Rgb = [18, 20, 23];
const GRIGIO: Rgb = [97, 104, 115];
const LINEE: Rgb = [60, 64, 70];
const GIALLO: Rgb = [246, 210, 74];
const BLU: Rgb = [30, 150, 200];
const ACCENTO: Rgb = [35, 72, 200];

const A4 = { w: 595.28, h: 841.89 };
const MARGINE = 36;

const dataIt = (d: Date): string =>
  d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

function colore(doc: jsPDF, tipo: 'testo' | 'riempi' | 'linea', c: Rgb): void {
  if (tipo === 'testo') doc.setTextColor(c[0], c[1], c[2]);
  else if (tipo === 'riempi') doc.setFillColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

/** Disegna il contenuto di una casella (il bordo lo disegna la griglia). */
function casella(doc: jsPDF, x: number, y: number, w: number, h: number, c: Cella): void {
  if (c.stato === 'mai') {
    colore(doc, 'riempi', GIALLO);
    doc.rect(x, y, w, h, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    colore(doc, 'testo', NERO);
    doc.text('/', x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
  } else if (c.stato === 'ha' || c.stato === 'parte') {
    // il tratto di evidenziatore del foglio di carta: da in alto a sinistra a in basso a destra
    colore(doc, 'linea', BLU);
    doc.setLineCap('round');
    doc.setLineWidth(c.stato === 'ha' ? 3.2 : 2);
    if (c.stato === 'parte') doc.setLineDashPattern([3, 2.5], 0);
    doc.line(x + 5, y + 4.5, x + w - 5, y + h - 4.5);
    doc.setLineDashPattern([], 0);
    doc.setLineCap('butt');
    if (c.stato === 'parte') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      colore(doc, 'testo', BLU);
      doc.text(`${String(c.hai)}/${String(c.di)}`, x + w - 3, y + 2.5, { align: 'right', baseline: 'top' });
    }
  }
}

function legenda(doc: jsPDF, x: number, y: number): void {
  const w = 36;
  const h = 16;
  const voci: [Cella, string][] = [
    [{ stato: 'ha', hai: 1, di: 1 }, "ce l'hai"],
    [{ stato: 'manca', hai: 0, di: 1 }, 'manca'],
    [{ stato: 'mai', hai: 0, di: 0 }, 'non coniata'],
    [{ stato: 'parte', hai: 1, di: 2 }, 'ne hai 1 su 2 (più versioni nello stesso anno)'],
  ];
  let cx = x;
  for (const [c, nome] of voci) {
    casella(doc, cx, y, w, h, c);
    colore(doc, 'linea', LINEE);
    doc.setLineWidth(0.6);
    doc.rect(cx, y, w, h, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5); // la casella disegnata qui sopra cambia la dimensione del testo: si rimette ogni volta
    colore(doc, 'testo', GRIGIO);
    doc.text(nome, cx + w + 5, y + h / 2, { baseline: 'middle' });
    cx += w + 12 + doc.getTextWidth(nome);
  }
}

function paginaTabella(doc: jsPDF, t: Tabella): void {
  const x0 = MARGINE;
  const anniW = 62;
  const colW = (A4.w - 2 * MARGINE - anniW) / COLONNE.length;
  const testaH = 22;
  const yTitolo = 58;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  colore(doc, 'testo', NERO);
  doc.text(t.paese.toLocaleUpperCase('it-IT'), x0, yTitolo);
  if (t.zecca) {
    doc.setFontSize(26);
    colore(doc, 'testo', ACCENTO);
    doc.text(t.zecca.lettera, A4.w - MARGINE, yTitolo, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    colore(doc, 'testo', GRIGIO);
    doc.text(`zecca di ${t.zecca.citta}`, A4.w - MARGINE, yTitolo + 14, { align: 'right' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  colore(doc, 'testo', GRIGIO);
  doc.text(`Ce l'hai: ${numero(t.hai)} di ${numero(t.totale)} monete`, x0, yTitolo + 16);

  const yTab = 92;
  const righeH = Math.min(20, (A4.h - yTab - testaH - 78) / t.anni.length);
  // intestazione
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  colore(doc, 'testo', NERO);
  COLONNE.forEach((_, i) => {
    doc.text(INTESTAZIONI[i] ?? '', x0 + anniW + colW * i + colW / 2, yTab + testaH / 2, {
      align: 'center',
      baseline: 'middle',
    });
  });
  // righe
  t.anni.forEach((anno, r) => {
    const y = yTab + testaH + righeH * r;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    colore(doc, 'testo', NERO);
    doc.text(String(anno), x0 + anniW / 2, y + righeH / 2, { align: 'center', baseline: 'middle' });
    (t.righe[r] ?? []).forEach((c, i) => {
      casella(doc, x0 + anniW + colW * i, y, colW, righeH, c);
    });
  });
  // griglia sopra le caselle (così il giallo non copre le linee)
  colore(doc, 'linea', LINEE);
  doc.setLineWidth(0.6);
  const altezza = testaH + righeH * t.anni.length;
  doc.rect(x0, yTab, anniW + colW * COLONNE.length, altezza, 'S');
  for (let i = 0; i <= COLONNE.length; i++)
    doc.line(x0 + anniW + colW * i, yTab, x0 + anniW + colW * i, yTab + altezza);
  for (let r = 0; r <= t.anni.length; r++)
    doc.line(x0, yTab + testaH + righeH * r, x0 + anniW + colW * COLONNE.length, yTab + testaH + righeH * r);

  legenda(doc, x0, yTab + altezza + 14);
}

function copertina(doc: jsPDF, tabelle: readonly Tabella[], oggi: Date): void {
  const x0 = MARGINE;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  colore(doc, 'testo', NERO);
  doc.text('Catalogo base delle monete in euro', x0, 70);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  colore(doc, 'testo', GRIGIO);
  doc.text(
    doc.splitTextToSize(
      'Monete di circolazione da 1 cent a 2 euro (senza commemorative, proof e varianti): una tabella per paese, ' +
        'per la Germania una per zecca (A, D, F, G, J).',
      A4.w - 2 * MARGINE,
    ) as string[],
    x0,
    92,
  );
  const hai = tabelle.reduce((s, t) => s + t.hai, 0);
  const totale = tabelle.reduce((s, t) => s + t.totale, 0);
  const perc = percentuale(hai, totale);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  colore(doc, 'testo', NERO);
  doc.text(`La collezione al ${dataIt(oggi)}: ${numero(hai)} monete su ${numero(totale)} (${String(perc)}%)`, x0, 136);
  legenda(doc, x0, 152);

  // riepilogo per paese, su due colonne
  const yInizio = 200;
  const rigaH = 19;
  const colW = (A4.w - 2 * MARGINE - 24) / 2;
  const perColonna = Math.ceil(tabelle.length / 2);
  doc.setFontSize(10.5);
  tabelle.forEach((t, i) => {
    const col = i < perColonna ? 0 : 1;
    const x = x0 + col * (colW + 24);
    const y = yInizio + (i % perColonna) * rigaH;
    doc.setFont('helvetica', 'normal');
    colore(doc, 'testo', NERO);
    doc.text(t.zecca ? `${t.paese} · zecca ${t.zecca.lettera}` : t.paese, x, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${numero(t.hai)} / ${numero(t.totale)}`, x + colW, y, { align: 'right' });
    colore(doc, 'linea', [225, 228, 233]);
    doc.setLineWidth(0.5);
    doc.line(x, y + 6, x + colW, y + 6);
  });
}

function piePagina(doc: jsPDF, oggi: Date): void {
  const n = doc.getNumberOfPages();
  const generato = catalogo?.generated ? dataIt(new Date(catalogo.generated)) : '';
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    colore(doc, 'testo', GRIGIO);
    doc.text(`Eurodex · creato il ${dataIt(oggi)}${generato ? ` · catalogo del ${generato}` : ''}`, MARGINE, A4.h - 22);
    doc.text(`${String(i)} / ${String(n)}`, A4.w - MARGINE, A4.h - 22, { align: 'right' });
  }
}

/** Il PDF come byte, pronto da salvare o condividere. */
export function pdfCatalogo(tabelle: readonly Tabella[], oggi = new Date()): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: 'Catalogo base delle monete in euro', subject: 'Collezione Eurodex', creator: 'Eurodex' });
  copertina(doc, tabelle, oggi);
  for (const t of tabelle) {
    doc.addPage();
    paginaTabella(doc, t);
  }
  piePagina(doc, oggi);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Il PDF della collezione di adesso. */
export function creaPdfCatalogo(): Uint8Array {
  const oggi = new Date();
  return pdfCatalogo(
    tabelleCatalogo({
      pezzi: tuttiPezzi,
      possedute,
      ordinePaesi,
      nomePaese,
      annoCorrente: oggi.getFullYear(),
    }),
    oggi,
  );
}
