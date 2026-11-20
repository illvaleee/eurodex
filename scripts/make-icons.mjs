// Icona e schermata di avvio dell'app (al posto di quelle di Capacitor).
// Va lanciato dopo "npx cap add android". Le immagini di partenza sono in assets/icona
// (ricavate dal logo: angoli bianchi tolti, sfondo blu a tutto campo).
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const RES = 'android/app/src/main/res';
const ICON = 'assets/icona';
// colore dei bordi del video di apertura: la schermata di Android prima del video ha lo stesso blu
const SPLASH_BG = '#081627';
const LOGO_BG = '#1F365F';

const png = (file, size) => sharp(path.join(ICON, file)).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = path.join(RES, `mipmap-${d}`);
  await fs.mkdir(dir, { recursive: true });
  const legacy = Math.round(48 * k),
    layer = Math.round(108 * k);
  // telefoni vecchi (prima di Android 8): icona classica e icona tonda
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), await png('classica.png', legacy));
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), await png('tonda.png', legacy));
  // Android 8 e successivi: icona adattiva. Il logo intero sta nel livello di sfondo (emblema dentro la zona sicura),
  // il livello davanti è trasparente: così Android può ritagliarla a cerchio, goccia o quadrato senza tagliare nulla.
  await fs.writeFile(path.join(dir, 'ic_launcher_background.png'), await png('adattiva.png', layer));
  await fs.writeFile(
    path.join(dir, 'ic_launcher_foreground.png'),
    await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer(),
  );
}
const any = path.join(RES, 'mipmap-anydpi-v26');
await fs.mkdir(any, { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
await fs.writeFile(path.join(any, 'ic_launcher.xml'), adaptive);
await fs.writeFile(path.join(any, 'ic_launcher_round.xml'), adaptive);
const valDir = path.join(RES, 'values');
await fs.mkdir(valDir, { recursive: true });
await fs.writeFile(
  path.join(valDir, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${LOGO_BG}</color>\n    <color name="splash_sfondo">${SPLASH_BG}</color>\n</resources>\n`,
);

// schermata di avvio: solo il blu del video (senza icona), così il passaggio al video non si nota
await fs.mkdir(path.join(RES, 'drawable'), { recursive: true });
await fs.writeFile(
  path.join(RES, 'drawable', 'splash_vuoto.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent"/>
    <size android:width="1dp" android:height="1dp"/>
</shape>
`,
);
// icona piccola delle notifiche (bianca, come vuole Android): il simbolo dell'euro dentro un anello
await fs.writeFile(
  path.join(RES, 'drawable', 'ic_notifica.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,1.5a10.5,10.5 0,1 0,0.001 0zM12,3.3a8.7,8.7 0,1 1,-0.001 0z"/>
    <path android:fillColor="#FFFFFFFF" android:pathData="M14.2,16.6c-1.9,0 -3.5,-1.07 -4.32,-2.63L14.2,13.97l0.75,-1.5L9.47,12.47c-0.04,-0.25 -0.06,-0.49 -0.06,-0.75s0.02,-0.5 0.06,-0.75L14.2,10.97l0.75,-1.5L9.88,9.47C10.7,7.91 12.32,6.85 14.2,6.85c1.21,0 2.32,0.44 3.17,1.18L18.7,6.7C17.51,5.63 15.93,4.97 14.2,4.97c-2.94,0 -5.43,1.88 -6.36,4.5L5.2,9.47l-0.75,1.5h3.05c-0.03,0.25 -0.05,0.5 -0.05,0.75s0.02,0.5 0.05,0.75L5.2,12.47l-0.75,1.5h3.39c0.93,2.62 3.42,4.5 6.36,4.5 1.73,0 3.31,-0.65 4.5,-1.72l-1.33,-1.33c-0.85,0.73 -1.95,1.18 -3.17,1.18z"/>
</vector>
`,
);
const stylesFile = path.join(valDir, 'styles.xml');
let styles = await fs.readFile(stylesFile, 'utf8');
const launch = '<item name="android:background">@drawable/splash</item>';
if (!styles.includes(launch)) throw new Error('styles.xml di Capacitor cambiato: tema di avvio non trovato');
styles = styles.replace(
  launch,
  `${launch}
        <item name="windowSplashScreenBackground">@color/splash_sfondo</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_vuoto</item>
        <item name="android:windowBackground">@color/splash_sfondo</item>`,
);
await fs.writeFile(stylesFile, styles);

const walk = async dir =>
  (await fs.readdir(dir, { withFileTypes: true })).flatMap(e => (e.isDirectory() ? [] : [path.join(dir, e.name)]));
let n = 0;
for (const sub of await fs.readdir(RES)) {
  if (!sub.startsWith('drawable')) continue;
  for (const f of await walk(path.join(RES, sub))) {
    if (path.basename(f) !== 'splash.png') continue;
    const { width, height } = await sharp(f).metadata();
    await fs.writeFile(
      f,
      await sharp({ create: { width, height, channels: 3, background: SPLASH_BG } })
        .png()
        .toBuffer(),
    );
    n++;
  }
}
console.log(`Icone generate, ${n} schermate di avvio sostituite.`);
