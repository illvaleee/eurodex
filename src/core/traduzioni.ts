/** Traduce i termini inglesi più comuni dei sottotitoli di Numista. */
export function termini(testo: string | null | undefined): string {
  return (
    (testo ?? '')
      .replace(/^\(\w{2}\)\s*/, '')
      .replace(/\b1st type\b/gi, '1° tipo')
      .replace(/\b2nd type\b/gi, '2° tipo')
      .replace(/\b3rd type\b/gi, '3° tipo')
      .replace(/\b1st portrait\b/gi, '1° ritratto')
      .replace(/\b2nd portrait\b/gi, '2° ritratto')
      .replace(/\b3rd portrait\b/gi, '3° ritratto')
      .replace(/\b1st map\b/gi, 'vecchia carta')
      .replace(/\b2nd map\b/gi, 'nuova carta')
      .replace(/\bwith mintmark\b/gi, 'con segno di zecca')
      .replace(/\bwithout mintmark\b/gi, 'senza segno di zecca')
      // nomi dei periodi: forma storica italiana
      .replace(/\bFifth Republic\b/g, 'Quinta Repubblica')
      .replace(/\bThird Hellenic Republic\b/g, 'Terza Repubblica ellenica')
      .replace(/\bWilliam V\b/g, 'Guglielmo V')
      .replace(/\(Sede Vacante\)/g, '(Sede vacante)')
      .replace(/\s*;\s*/g, ', ')
  );
}
