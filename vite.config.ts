import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const nonUsato = fileURLToPath(new URL('./src/core/non-usato.ts', import.meta.url));

// L'app si compila da src/ dentro www/ (la cartella che Capacitor mette nell'APK). In www restano anche i dati
// del catalogo, le foto e i file statici, che la compilazione non tocca: per questo non si svuota la cartella.
export default defineConfig({
  root: 'src',
  base: './',
  publicDir: false,
  // jsPDF li carica solo per convertire HTML/SVG, che l'app non fa: non si includono
  resolve: { alias: { html2canvas: nonUsato, dompurify: nonUsato, canvg: nonUsato } },
  build: {
    outDir: '../www',
    emptyOutDir: false,
    assetsDir: 'build',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
  },
});
