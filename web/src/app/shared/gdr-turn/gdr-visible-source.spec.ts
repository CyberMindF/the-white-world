import { describe, expect, it } from 'vitest';
import { parseNarrative } from './gdr-turn.parser';
import { storedSourceOffset, updateVisibleNarrativeSource, visibleNarrativeSource, visibleSourceOffset } from './gdr-visible-source';

const roster = [{id: 'ada-1', name: 'Ada', portrait: '/assets/a.webp'}, {id: 'ada-2', name: 'Ada', portrait: '/assets/b.webp'}];

describe('riferimenti dei personaggi nascosti nella textbox', () => {
  it('mostra solo il nome, conserva il riferimento anche con omonimi e rilegge una rinomina', () => {
    const source = '::: pensiero Prima | /assets/old.webp | ada-2\nNon devo dirlo.\n:::';
    const view = visibleNarrativeSource(source, roster);
    expect(view.text).toBe('::: pensiero Ada\nNon devo dirlo.\n:::');
    expect(updateVisibleNarrativeSource(view, view.text)).toBe(source);
    const edited = updateVisibleNarrativeSource(view, view.text.replace('Non devo dirlo.', 'Devo parlare.'), roster);
    expect(parseNarrative(edited).sections[0]).toMatchObject({characterId: 'ada-2', text: 'Devo parlare.'});
    expect(visibleNarrativeSource(edited, [{...roster[1], name: 'Ada Nuova'}]).text).toContain('::: pensiero Ada Nuova');
  });

  it('mantiene distinti più blocchi con lo stesso nome quando si modifica il corpo', () => {
    const source = 'Prima.\n\n::: dialogo Ada | | ada-1\nCiao.\n:::\n\n::: pensiero Ada | | ada-2\nCiao.\n:::\n\nDopo.';
    const view = visibleNarrativeSource(source, roster);
    const position = view.text.lastIndexOf('Ciao.');
    const edited = updateVisibleNarrativeSource(view, view.text.slice(0, position) + 'Non lo dirò.' + view.text.slice(position + 5), roster);
    expect(parseNarrative(edited).sections.filter(s => s.characterId).map(s => [s.characterId, s.text])).toEqual([['ada-1', 'Ciao.'], ['ada-2', 'Non lo dirò.']]);
    expect(edited.startsWith('Prima.\n\n')).toBe(true); expect(edited.endsWith('\n\nDopo.')).toBe(true);
  });

  it('mantiene il personaggio scelto passando da dialogo a pensiero anche con omonimi', () => {
    const view=visibleNarrativeSource('::: dialogo Ada | | ada-2\nCiao.\n:::',roster);
    const edited=updateVisibleNarrativeSource(view,view.text.replace('dialogo','pensiero'),roster);
    expect(parseNarrative(edited).sections[0]).toMatchObject({kind:'pensiero',characterId:'ada-2'});
  });

  it('conserva il riferimento mentre la chiusura è incompleta e non mostra mai le barre', () => {
    const source = '::: dialogo Ada | | ada-2\nCiao.\n:::';
    const view = visibleNarrativeSource(source);
    const edited = updateVisibleNarrativeSource(view, view.text.slice(0, -3), roster);
    expect(edited).toContain('ada-2');
    const incomplete = visibleNarrativeSource(edited);
    expect(incomplete.text).toBe('::: dialogo Ada\nCiao.\n');
    expect(incomplete.text).not.toContain('|');
    expect(updateVisibleNarrativeSource(incomplete, incomplete.text + ':::', roster)).toBe(source);
  });

  it('non ricollega un riferimento eliminato a un omonimo e non assegna un nuovo nome ambiguo', () => {
    const view = visibleNarrativeSource('::: dialogo Vecchio | | deleted-id\nCiao.\n:::', roster);
    expect(updateVisibleNarrativeSource(view, view.text.replace('Ciao.', 'Ancora.'), roster)).toContain('deleted-id');
    const changedName = updateVisibleNarrativeSource(view, view.text.replace('Vecchio', 'Ada'), roster);
    expect(parseNarrative(changedName).sections[0].characterId).toBe('');
    expect(changedName).not.toContain('deleted-id');
  });

  it('collega un nome scritto liberamente solo se univoco e consente di eliminare tutto il blocco', () => {
    const old = visibleNarrativeSource('Testo.');
    const next = updateVisibleNarrativeSource(old, '::: dialogo Ada\nCiao.\n:::', [roster[0]]);
    expect(parseNarrative(next).sections[0].characterId).toBe('ada-1');
    expect(updateVisibleNarrativeSource(visibleNarrativeSource(next), 'Testo.')).toBe('Testo.');
  });

  it('non nasconde testo che sembra un comando dentro un riquadro o dentro il corpo del dialogo', () => {
    const source = '::: callout Sintassi\n::: dialogo Ada | | esempio\n:::\n\n::: dialogo Ada | | ada-1\n::: pensiero Questo è testo | | non-un-id\n:::';
    const view = visibleNarrativeSource(source);
    expect(view.text).toContain('::: dialogo Ada | | esempio');
    expect(view.text).toContain('::: pensiero Questo è testo | | non-un-id');
    expect(view.text).not.toContain('ada-1');
  });

  it('traduce le selezioni dopo più intestazioni nascoste, emoji e ritorni a capo Windows', () => {
    const source = '🪄 Prima.\r\n\r\n::: dialogo Vecchio | /assets/old.webp | ada-1\r\nCiao.\r\n:::\r\n\r\n::: pensiero Ada | | ada-2\r\nDopo.\r\n:::';
    const view = visibleNarrativeSource(source, roster);
    for (const body of ['Ciao.', 'Dopo.']) {
      const start = view.text.indexOf(body), original = source.indexOf(body);
      expect(storedSourceOffset(view, start)).toBe(original);
      expect(storedSourceOffset(view, start + body.length)).toBe(original + body.length);
      expect(visibleSourceOffset(view, original)).toBe(start);
    }
  });
});
