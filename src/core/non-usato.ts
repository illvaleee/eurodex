/**
 * Al posto dei moduli che jsPDF carica solo per convertire HTML o SVG in PDF (html2canvas, dompurify, canvg):
 * l'app disegna il PDF con testo e linee e non li usa, così non finiscono nell'APK.
 */
export default function nonUsato(): never {
  throw new Error("modulo non incluso nell'app");
}
