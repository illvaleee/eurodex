import { describe, expect, it } from 'vitest';
import { interpreta } from '../src/viste/cerca';
import { catalogoVero } from './aiuto';

describe('ricerca scritta liberamente', () => {
  catalogoVero();
  it('capisce paese, anno e taglio insieme', () => {
    expect(interpreta('Italia 2€ 2015')).toMatchObject({ cc: 'IT', y: 2015, d: '2e', parole: [] });
    expect(interpreta('2 euro grecia')).toMatchObject({ cc: 'GR', d: '2e' });
    expect(interpreta('50 centesimi')).toMatchObject({ d: '50c' });
  });
  it('quello che non riconosce diventa parole da cercare nel testo', () => {
    expect(interpreta('Galileo').parole).toEqual(['galileo']);
  });
  it('non distingue accenti e maiuscole', () => {
    expect(interpreta('ITALIA').cc).toBe('IT');
  });
});
