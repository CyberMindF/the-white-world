import { describe, expect, it } from 'vitest';
import { insertNarrativeBlock, narrativeSnippet, replaceNarrativeSelection } from './gdr-writing';
import { parseNarrative } from './gdr-turn.parser';

describe('inserimento nel racconto', () => {
  it('inserisce fra due paragrafi uguali senza confondere o riscrivere i blocchi', () => {
    const source = 'Testo uguale.\n\n::: dialogo Ada\nCiao.\n:::\n\nTesto uguale.';
    const offset = source.lastIndexOf('Testo uguale.');
    const inserted = '## Un nuovo capitolo';
    const result = insertNarrativeBlock(source, offset, inserted);
    expect(result).toBe(source.slice(0, offset) + inserted + '\n\n' + source.slice(offset));
    expect(parseNarrative(result).errors).toEqual([]);
    expect(parseNarrative(result).sections.map((s) => s.kind)).toEqual([
      'document',
      'dialogo',
      'document',
    ]);
  });
  it('gestisce inizio, fine e documento vuoto mantenendo separati i blocchi', () => {
    expect(insertNarrativeBlock('', 0, 'Primo testo.')).toBe('Primo testo.');
    expect(insertNarrativeBlock('## Fine', 0, 'Inizio.')).toBe('Inizio.\n\n## Fine');
    expect(insertNarrativeBlock('## Inizio', 9, 'Fine.')).toBe('## Inizio\n\nFine.');
    expect(insertNarrativeBlock('Prima.\n\n', 8, 'Dopo.')).toBe('Prima.\n\nDopo.');
  });
  it('conserva emoji e ritorni a capo Windows del contenuto esistente', () => {
    const source = '🪄 Prima.\r\n\r\n## Dopo';
    const offset = source.indexOf('##');
    const result = insertNarrativeBlock(source, offset, 'Un incontro.');
    expect(result).toBe(source.slice(0, offset) + 'Un incontro.\r\n\r\n## Dopo');
    expect(parseNarrative(result).errors).toEqual([]);
  });
  it('riusa le righe esistenti sostituendo un blocco e non aggiunge righe in fondo', () => {
    const snippet = narrativeSnippet('azione', 'Mi avvicino.');
    expect(replaceNarrativeSelection('', 0, 0, snippet).source).toBe(snippet);
    const source = 'Prima.\n\nDa cambiare.\n\nDopo.';
    const start = source.indexOf('Da cambiare.');
    const result = replaceNarrativeSelection(source, start, start + 'Da cambiare.'.length, snippet);
    expect(result.source).toBe('Prima.\n\n' + snippet + '\n\nDopo.');
    expect(result.source.slice(result.start, result.end)).toBe(snippet);
    let current = result;
    for (let i = 0; i < 5; i++) current = replaceNarrativeSelection(current.source, current.start, current.end, snippet);
    expect(current).toEqual(result);
  });
  it('riutilizza anche i separatori Windows e conserva gli spazi scritti intenzionalmente', () => {
    const source = 'Prima.\r\n\r\nVecchio.\r\n\r\nDopo.';
    const start = source.indexOf('Vecchio.');
    expect(replaceNarrativeSelection(source, start, start + 8, 'Nuovo.').source).toBe('Prima.\r\n\r\nNuovo.\r\n\r\nDopo.');
    const spaced = 'Prima.\n\n\n\nVecchio.\n\nDopo.';
    const position = spaced.indexOf('Vecchio.');
    expect(replaceNarrativeSelection(spaced, position, position + 8, 'Nuovo.').source).toBe('Prima.\n\n\n\nNuovo.\n\nDopo.');
  });
  it('usa la stessa sintassi e la voce scelta in entrambi gli editor', () => {
    const snippet = narrativeSnippet('dialogo', 'Le mie parole.', {
      name: 'Ada\n|PNG',
      portrait: '/api/media/gdr/ada.webp',
    });
    const section = parseNarrative(snippet).sections[0];
    expect(section.speaker).toBe('Ada  PNG');
    expect(section.portrait).toBe('/api/media/gdr/ada.webp');
    expect(section.text).toBe('Le mie parole.');
    expect(
      narrativeSnippet('dialogo', '', { name: 'Ada', portrait: 'javascript:alert(1)' }),
    ).not.toContain('javascript');
  });
});
