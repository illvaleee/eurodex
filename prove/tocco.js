// Misura minima di tutto quello che si tocca: 48×48 dp (linee guida Android e Material; nel browser 1 px CSS = 1 dp).
// Sono esclusi, come prevede la regola WCAG 2.5.8, i link dentro una frase.
() => {
  const sel =
    'button, a[href], [role=button], [role=radio], [role=tab], select, input:not([type=hidden]), summary, [data-act]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (getComputedStyle(el).visibility === 'hidden' || el.closest('[inert], [aria-hidden=true], [hidden]')) continue;
    if (el.matches('input') && el.closest('label')) continue; // si tocca tutta la riga dell'etichetta
    const inFrase =
      el.matches('a') && [...(el.parentElement?.childNodes ?? [])].some(n => n.nodeType === 3 && n.textContent.trim());
    if (inFrase) continue;
    if (r.width < 47.5 || r.height < 47.5) {
      const nome = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20);
      out.push(`«${nome}» ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return [...new Set(out)];
};
