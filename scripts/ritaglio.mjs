// Ritaglio delle foto delle monete: via lo sfondo (bianco, grigio o di altro colore), resta solo la moneta,
// con il bordo pulito e lo sfondo trasparente. L'ombra la aggiunge l'app (scura nel tema chiaro, chiara nel tema scuro).
// - monete tonde: cerchio perfetto, ricavato dalla sagoma della moneta e stretto di un soffio per togliere l'alone chiaro
// - 20 cent ("fiore spagnolo", con 7 incavi): sagoma vera della moneta, così negli incavi non resta sfondo
import sharp from 'sharp';

const N = 400; // lato dell'immagine di lavoro per trovare la sagoma

export async function ritaglia(input, denom, size = 480) {
  const base = sharp(input, { failOn: 'none' }).ensureAlpha();
  const meta = await base.metadata();
  const { data, info } = await base
    .clone()
    .resize(N, N, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width,
    H = info.height,
    px = i => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
  // colore dello sfondo: mediana dei pixel del bordo (escluso quello aggiunto trasparente)
  const border = [];
  for (let x = 0; x < W; x++) for (const y of [0, 1, H - 2, H - 1]) border.push(y * W + x);
  for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) border.push(y * W + x);
  const solid = border.map(px).filter(p => p[3] > 200);
  const med = k => {
    const v = solid.map(p => p[k]).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 255;
  };
  const bg = [med(0), med(1), med(2)];
  const isBg = i => {
    const p = px(i);
    return p[3] < 40 || Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) < 54;
  };
  // riempimento dallo sfondo verso l'interno: è sfondo solo ciò che tocca il bordo
  const fondo = new Uint8Array(W * H),
    stack = [];
  for (const i of border)
    if (!fondo[i] && isBg(i)) {
      fondo[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const i = stack.pop(),
      x = i % W,
      y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
      if (j >= 0 && !fondo[j] && isBg(j)) {
        fondo[j] = 1;
        stack.push(j);
      }
  }
  // riquadro della moneta: righe e colonne con abbastanza pixel di moneta (ignora puntini isolati)
  const cols = new Array(W).fill(0),
    rows = new Array(H).fill(0);
  for (let i = 0; i < W * H; i++)
    if (!fondo[i]) {
      cols[i % W]++;
      rows[(i / W) | 0]++;
    }
  const first = (a, t) => a.findIndex(v => v >= t),
    last = (a, t) => a.length - 1 - [...a].reverse().findIndex(v => v >= t);
  const t = 3,
    x0 = first(cols, t),
    x1 = last(cols, t),
    y0 = first(rows, t),
    y1 = last(rows, t);
  if (x0 < 0 || y0 < 0 || x1 - x0 < N * 0.3 || y1 - y0 < N * 0.3) return null; // sagoma non trovata: meglio nessun ritaglio
  // dalle coordinate di lavoro a quelle dell'originale
  const sc = Math.max(meta.width, meta.height) / N,
    ox = (N - meta.width / sc) / 2,
    oy = (N - meta.height / sc) / 2;
  const cx = ((x0 + x1 + 1) / 2 - ox) * sc,
    cy = ((y0 + y1 + 1) / 2 - oy) * sc;
  const r = (Math.min(x1 - x0 + 1, y1 - y0 + 1) / 2) * sc;
  const side = Math.round(2 * r),
    left = Math.round(cx - r),
    top = Math.round(cy - r);
  size = Math.min(size, Math.max(160, side)); // foto piccole: non si ingrandiscono (resterebbero sfocate)
  // ritaglio quadrato attorno alla moneta (allargando la tela se la moneta tocca il bordo della foto)
  const pad = Math.max(0, -left, -top, left + side - meta.width, top + side - meta.height);
  let img = sharp(input, { failOn: 'none' }).ensureAlpha();
  if (pad)
    img = sharp(
      await img
        .extend({
          top: pad,
          bottom: pad,
          left: pad,
          right: pad,
          background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 },
        })
        .png()
        .toBuffer(),
    );
  const sq = await img
    .extract({ left: left + pad, top: top + pad, width: side, height: side })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  // maschera: cerchio stretto dell'1,2% (via l'alone), con bordo morbido di mezzo pixel
  const rr = (size / 2) * 0.988;
  let mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${rr}" fill="#fff"/></svg>`,
  );
  let maskPng = await sharp(mask).png().toBuffer();
  if (denom === '20c') {
    // sagoma vera (incavi compresi): sfondo trovato sopra, portato alla stessa scala, ristretto di un pixel
    const shape = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) shape[i] = fondo[i] ? 0 : 255;
    const sx = (left - ox * sc) / sc,
      sy = (top - oy * sc) / sc,
      ss = side / sc;
    const crop = { left: Math.max(0, Math.round(sx)), top: Math.max(0, Math.round(sy)) };
    crop.width = Math.min(W - crop.left, Math.round(ss));
    crop.height = Math.min(H - crop.top, Math.round(ss));
    const sh = await sharp(shape, { raw: { width: W, height: H, channels: 1 } })
      .extract(crop)
      .resize(size, size)
      .blur(1.2)
      .threshold(170)
      .blur(0.6)
      .png()
      .toBuffer();
    maskPng = await sharp(maskPng)
      .composite([{ input: sh, blend: 'multiply' }])
      .png()
      .toBuffer();
  }
  const alpha = await sharp(maskPng).extractChannel(0).raw().toBuffer();
  const rgb = await sharp(sq).removeAlpha().raw().toBuffer();
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .webp({ quality: 84, alphaQuality: 90 })
    .toBuffer();
}
