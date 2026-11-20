// Cose che non si vedono (trasparenti) ma che TalkBack legge o su cui si può finire col dito/tastiera: per chi usa
// la voce sarebbero pulsanti o testi fantasma. Ciò che è nascosto deve esserlo anche per l'accessibilità.
() => {
  const out = [];
  const trasparente = el => {
    for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity === 0) return true;
    return false;
  };
  for (const el of document.querySelectorAll(
    'button, a[href], input, select, [tabindex], [role=status] *, h1, h2, h3, p, span, b',
  )) {
    if (el.closest('[inert], [aria-hidden=true], [hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const parla = el.matches('button, a[href], input, select, [tabindex]') || (el.textContent || '').trim();
    if (parla && trasparente(el))
      out.push(
        `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} «${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}»`,
      );
  }
  return [...new Set(out)].slice(0, 6);
};
