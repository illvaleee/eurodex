// Contrasto del testo (WCAG 2.1 AA) su tutto quello che si vede ora: colore del testo contro lo sfondo effettivo
// (colori semitrasparenti fusi con quelli sotto). Le scritte su foto o sfumature non si possono misurare così e si
// saltano. Restituisce gli elementi sotto la soglia: 4,5:1, oppure 3:1 per il testo grande (24px, o 18,7px in grassetto).
() => {
  const rgba = s => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return [r, g, b, a];
  };
  const fondi = (sopra, sotto) => {
    const a = sopra[3];
    return [0, 1, 2].map(i => sopra[i] * a + sotto[i] * (1 - a)).concat(1);
  };
  const lum = c => {
    const f = v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const rapporto = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  function sfondo(el) {
    const strati = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !e.matches('body, html')) return null; // foto o sfumatura: non misurabile
      const c = rgba(cs.backgroundColor);
      if (c && c[3] > 0) {
        strati.push(c);
        if (c[3] >= 1) break;
      }
      if (e.id === 'sfondo') return null;
    }
    let base = [255, 255, 255, 1];
    if (!strati.length || strati[strati.length - 1][3] < 1)
      base = rgba(getComputedStyle(document.body).backgroundColor) || base;
    for (const c of strati.reverse()) base = fondi(c, base);
    return base;
  }
  const out = [];
  const tutti = document.querySelectorAll('body *:not(script):not(style):not(svg *)');
  for (const el of tutti) {
    const testo = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .join('');
    if (!/[\p{L}\p{N}]/u.test(testo)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
      continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[aria-hidden="true"], [inert]')) continue;
    if (el.closest('[disabled]')) continue; // i pulsanti disattivati sono esclusi dalla regola
    const fondo = sfondo(el);
    if (!fondo) continue;
    const col = rgba(cs.color);
    if (!col) continue;
    const testoC = fondi(col, fondo);
    const px = parseFloat(cs.fontSize),
      grassetto = +cs.fontWeight >= 700;
    const grande = px >= 24 || (grassetto && px >= 18.66);
    const k = rapporto(testoC, fondo);
    if (k < (grande ? 3 : 4.5)) out.push(`«${testo.slice(0, 24)}» ${k.toFixed(2)}:1`);
  }
  return [...new Set(out)];
};
