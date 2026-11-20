import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GdrTurn } from './gdr-turn';
import { parseNarrative } from './gdr-turn.parser';
import { writeCorrespondence } from './gdr-correspondence';
import { GdrBlockRow } from '../gdr-blocks/gdr-block.types';
import { serializeGdrBlocks } from '../gdr-blocks/gdr-markdown.serializer';

function setup(source: string) {
  TestBed.configureTestingModule({ imports: [GdrTurn] });
  const fixture = TestBed.createComponent(GdrTurn);
  fixture.componentRef.setInput('source', source);
  fixture.componentRef.setInput('editable', true);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const button = (text: string) => Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
  const field = async (suffix: string, value: string) => {
    const input = root.querySelector(`[id$="-${suffix}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, root, button, field };
}

describe('modifica di lettere, messaggi e pensieri', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('modifica i campi separatamente, conserva il corpo cambiando formato e non mostra campi vuoti', async () => {
    const { fixture, root, button, field } = setup('Prima.\n\n::: lettera\nCara Ada,\n\nci vediamo presto.\n:::\n\nDopo.');
    expect(root.querySelector('.letter-date, .letter-signature')).toBeNull();
    button('✎ Modifica lettera').click(); fixture.detectChanges(); await fixture.whenStable();
    expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Cara Ada,\n\nci vediamo presto.');
    await field('signature', 'Bea'); await field('date', 'Terza luna'); await field('format', 'messaggio');
    await field('contact-name', '+39 123'); await field('time', 'Dopo cena'); await field('format', 'lettera');
    expect((root.querySelector('[id$="-signature"]') as HTMLInputElement).value).toBe('Bea');
    await field('format', 'messaggio');
    const save = vi.fn(); fixture.componentInstance.sourceChange.subscribe(save);
    button('Applica al testo').click();
    const saved = save.mock.calls[0][0];
    expect(saved.startsWith('Prima.\n\n')).toBe(true); expect(saved.endsWith('\n\nDopo.')).toBe(true);
    expect(parseNarrative(saved).sections[1]).toMatchObject({ kind: 'messaggio', speaker: '+39 123', text: 'Cara Ada,\n\nci vediamo presto.', correspondence: { signature: 'Bea', date: 'Terza luna', time: 'Dopo cena' } });
    fixture.componentRef.setInput('source', saved); fixture.detectChanges();
    expect(root.querySelector('.chat-contact')?.textContent).toContain('+39 123');
    expect(root.querySelector('.chat-meta')?.textContent).toContain('Dopo cena');
    const master = root.querySelector('.chat-message')?.textContent;
    fixture.componentRef.setInput('editable', false); fixture.detectChanges();
    expect(root.querySelector('.chat-message')?.textContent).toBe(master);
  });

  it('sceglie un PNG dal roster pubblico e rilegge nome e avatar senza legare i contatti liberi', async () => {
    const { fixture, root, button } = setup('::: messaggio\nArrivo.\n:::');
    fixture.componentRef.setInput('characters', [{ id: 'pg', name: 'Protagonista', portrait: '' }]);
    fixture.componentRef.setInput('characterRoster', [{ id: 'npc', kind: 'png', name: 'Ada', portrait: '/assets/ada.webp' }]);
    fixture.detectChanges(); button('✎ Modifica messaggio').click(); fixture.detectChanges(); await fixture.whenStable();
    const contact = root.querySelector('[id$="-contact"]') as HTMLSelectElement;
    expect(contact.textContent).toContain('Ada · PNG');
    contact.selectedIndex = 1; contact.dispatchEvent(new Event('change')); fixture.detectChanges();
    const save = vi.fn(); fixture.componentInstance.sourceChange.subscribe(save); button('Applica al testo').click();
    const source = save.mock.calls[0][0];
    expect(source).not.toContain('/assets/');
    expect(parseNarrative(source).sections[0].characterId).toBe('npc');
    fixture.componentRef.setInput('source', source);
    fixture.componentRef.setInput('characterRoster', [{ id: 'npc', name: 'Ada Nuova', portrait: '/assets/new.webp' }]); fixture.detectChanges();
    expect(root.querySelector('.chat-contact')?.textContent).toContain('Ada Nuova');
    expect(root.querySelector('.chat-contact img')?.getAttribute('src')).toBe('/assets/new.webp');
    fixture.componentRef.setInput('source', '::: messaggio {"name":"Ada"}\nArrivo.\n:::'); fixture.detectChanges();
    expect(root.querySelector('.chat-contact')?.textContent).toContain('Ada');
    expect(root.querySelector('.chat-contact img')).toBeNull();
  });

  it('salva un blocco narrativo condiviso con il suo ID e impedisce di applicare un corpo vuoto', async () => {
    const source = writeCorrespondence({ kind: 'lettera', body: 'Ciao.', name: '', characterId: '', portrait: '', signature: 'Ada', date: '', time: '' });
    const blocks: GdrBlockRow[] = [{ id: '42', documentKey: 'avventura', position: 0, type: 'paragraph', data: { text: source, format: 'gdr-narrative' } }];
    const { fixture, root, button, field } = setup(serializeGdrBlocks(blocks));
    fixture.componentRef.setInput('persistedBlocks', blocks); fixture.detectChanges();
    button('✎ Modifica lettera').click(); fixture.detectChanges(); await fixture.whenStable();
    const body = root.querySelector('textarea') as HTMLTextAreaElement;
    body.value = '   '; body.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(button('Applica al testo').disabled).toBe(true);
    body.value = 'Nuovo testo.'; body.dispatchEvent(new Event('input')); fixture.detectChanges(); await field('signature', '');
    const save = vi.fn(), privateCopy = vi.fn();
    fixture.componentInstance.blockChange.subscribe(save); fixture.componentInstance.sourceChange.subscribe(privateCopy);
    button('Applica al testo').click();
    expect(save).toHaveBeenCalledWith({ id: '42', source: '::: lettera\nNuovo testo.\n:::' }); expect(privateCopy).not.toHaveBeenCalled();
  });

  it('mostra il pensiero in corsivo con il personaggio corrente e modifica solo il corpo', async () => {
    const { fixture, root, button } = setup('::: pensiero Vecchio | | ada\nMeglio tacere.\n:::');
    fixture.componentRef.setInput('characters', [{ id: 'ada', name: 'Ada', portrait: '/assets/a.webp' }]); fixture.detectChanges();
    expect(root.querySelector('.thought-heading')?.textContent).toContain('Ada · Pensiero');
    expect(root.querySelector('.thought em')?.textContent).toBe('Meglio tacere.');
    (root.querySelector('[aria-label="Modifica pensiero"]') as HTMLButtonElement).click(); fixture.detectChanges(); await fixture.whenStable();
    const body = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(body.value).toBe('Meglio tacere.'); body.value = 'Devo parlare.'; body.dispatchEvent(new Event('input')); fixture.detectChanges();
    const save = vi.fn(); fixture.componentInstance.sourceChange.subscribe(save); button('Applica al testo').click();
    expect(save).toHaveBeenCalledWith('::: pensiero Ada |  | ada\nDevo parlare.\n:::');
  });
});
