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
  return { fixture, root, button };
}

describe('modifica di lettere, messaggi e pensieri', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('modifica dati e corpo nella stessa textbox, mantenendo il testo circostante', async () => {
    const {fixture,root,button}=setup('Prima.\n\n::: lettera\nCara Ada,\n\nci vediamo presto.\n:::\n\nDopo.');
    expect(root.querySelector('.letter-date, .letter-signature')).toBeNull();
    button('✎ Modifica lettera').click();fixture.detectChanges();await fixture.whenStable();
    const area=root.querySelector('textarea') as HTMLTextAreaElement;
    expect(root.querySelector('.correspondence-fields, input')).toBeNull();
    expect(area.value).toContain('::: lettera');
    area.value='::: messaggio\nCONTATTO: +39 123\nDATA: Terza luna\nORA: Dopo cena\n---\nCara Ada,\n\nci vediamo presto.\n:::';
    area.dispatchEvent(new Event('input'));fixture.detectChanges();
    const save=vi.fn();fixture.componentInstance.sourceChange.subscribe(save);button('Applica al testo').click();
    const saved=save.mock.calls[0][0];
    expect(saved.startsWith('Prima.\n\n')).toBe(true);expect(saved.endsWith('\n\nDopo.')).toBe(true);
    expect(parseNarrative(saved).sections[1]).toMatchObject({kind:'messaggio',speaker:'+39 123',text:'Cara Ada,\n\nci vediamo presto.',correspondence:{date:'Terza luna',time:'Dopo cena'}});
    fixture.componentRef.setInput('source',saved);fixture.detectChanges();
    expect(root.querySelector('.chat-contact')?.textContent).toContain('+39 123');
    expect(root.querySelector('.chat-meta')?.textContent).toContain('Dopo cena');
    const master=root.querySelector('.chat-message')?.textContent;fixture.componentRef.setInput('editable',false);fixture.detectChanges();
    expect(root.querySelector('.chat-message')?.textContent).toBe(master);
  });

  it('mantiene il riferimento e l’avatar modificando i codici di un messaggio già salvato', async () => {
    const {fixture,root,button}=setup('::: messaggio {"name":"Ada","characterId":"npc"}\nArrivo.\n:::');
    fixture.componentRef.setInput('characterRoster',[{id:'npc',name:'Ada',portrait:'/assets/ada.webp'}]);fixture.detectChanges();
    button('✎ Modifica messaggio').click();fixture.detectChanges();await fixture.whenStable();
    const area=root.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).not.toContain('characterId');expect(root.querySelector('.correspondence-fields')).toBeNull();
    area.value=area.value.replace('---','ORA: Dopo cena\n---');area.dispatchEvent(new Event('input'));fixture.detectChanges();
    const save=vi.fn();fixture.componentInstance.sourceChange.subscribe(save);button('Applica al testo').click();
    const source=save.mock.calls[0][0];expect(source).not.toContain('/assets/');
    expect(parseNarrative(source).sections[0]).toMatchObject({characterId:'npc',correspondence:{time:'Dopo cena'}});
    fixture.componentRef.setInput('source',source);fixture.componentRef.setInput('characterRoster',[{id:'npc',name:'Ada Nuova',portrait:'/assets/new.webp'}]);fixture.detectChanges();
    expect(root.querySelector('.chat-contact')?.textContent).toContain('Ada Nuova');
    expect(root.querySelector('.chat-contact img')?.getAttribute('src')).toBe('/assets/new.webp');
    fixture.componentRef.setInput('source','::: messaggio\nCONTATTO: Ada\n---\nArrivo.\n:::');fixture.detectChanges();
    expect(root.querySelector('.chat-contact img')).toBeNull();
  });

  it('salva un blocco narrativo condiviso con il suo ID e impedisce di applicare un corpo vuoto', async () => {
    const source = writeCorrespondence({ kind: 'lettera', body: 'Ciao.', name: '', characterId: '', portrait: '', signature: 'Ada', date: '', time: '' });
    const blocks: GdrBlockRow[] = [{ id: '42', documentKey: 'avventura', position: 0, type: 'paragraph', data: { text: source, format: 'gdr-narrative' } }];
    const { fixture, root, button } = setup(serializeGdrBlocks(blocks));
    fixture.componentRef.setInput('persistedBlocks', blocks); fixture.detectChanges();
    button('✎ Modifica lettera').click(); fixture.detectChanges(); await fixture.whenStable();
    const body = root.querySelector('textarea') as HTMLTextAreaElement;
    body.value = body.value.replace('Ciao.','   '); body.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(button('Applica al testo').disabled).toBe(true);
    body.value = '::: lettera\nNuovo testo.\n:::'; body.dispatchEvent(new Event('input')); fixture.detectChanges();
    const save = vi.fn(), privateCopy = vi.fn();
    fixture.componentInstance.blockChange.subscribe(save); fixture.componentInstance.sourceChange.subscribe(privateCopy);
    button('Applica al testo').click();
    expect(save).toHaveBeenCalledWith({ id: '42', source: '::: lettera\nNuovo testo.\n:::' }); expect(privateCopy).not.toHaveBeenCalled();
  });

  it('mostra il pensiero in corsivo con il personaggio corrente e modifica solo il corpo', async () => {
    const { fixture, root, button } = setup('::: pensiero Vecchio | | ada\nMeglio tacere.\n:::');
    fixture.componentRef.setInput('characters', [{ id: 'ada', name: 'Ada', portrait: '/assets/a.webp' }]); fixture.detectChanges();
    expect(root.querySelector('.thought .speaker')?.textContent).toContain('Ada');
    expect(root.querySelector('.thought')?.textContent).not.toContain('Pensiero');
    expect(root.querySelector('.thought .speaker img')?.getAttribute('src')).toBe('/assets/a.webp');
    expect(root.querySelector('.thought .cloud-outline')).not.toBeNull();
    expect(root.querySelector('.thought em')?.textContent).toBe('Meglio tacere.');
    (root.querySelector('[aria-label="Modifica pensiero"]') as HTMLButtonElement).click(); fixture.detectChanges(); await fixture.whenStable();
    const body = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(body.value).toBe('Meglio tacere.'); body.value = 'Devo parlare.'; body.dispatchEvent(new Event('input')); fixture.detectChanges();
    const save = vi.fn(); fixture.componentInstance.sourceChange.subscribe(save); button('Applica al testo').click();
    expect(save).toHaveBeenCalledWith('::: pensiero Ada |  | ada\nDevo parlare.\n:::');
  });

  it('nasconde i riferimenti anche nei blocchi misti della modifica rapida', async () => {
    const {fixture,root,button}=setup('Prima.');
    fixture.componentRef.setInput('characters',[{id:'ada-1',name:'Ada',portrait:''},{id:'ada-2',name:'Ada',portrait:'/assets/b.webp'}]);fixture.detectChanges();
    button('✎ Modifica paragrafo').click();fixture.detectChanges();await fixture.whenStable();
    const body=root.querySelector('textarea') as HTMLTextAreaElement;
    body.value='Prima.\n\n::: pensiero Ada | | ada-2\nMeglio tacere.\n:::';body.dispatchEvent(new Event('input'));fixture.detectChanges();await fixture.whenStable();
    expect(body.value).not.toContain('ada-2');expect(body.value).not.toContain('|');
    body.value=body.value.replace('Meglio tacere.','Meglio parlare.');body.dispatchEvent(new Event('input'));fixture.detectChanges();
    const save=vi.fn();fixture.componentInstance.sourceChange.subscribe(save);button('Applica al testo').click();
    expect(parseNarrative(save.mock.calls[0][0]).sections[1]).toMatchObject({characterId:'ada-2',text:'Meglio parlare.'});
  });
});
