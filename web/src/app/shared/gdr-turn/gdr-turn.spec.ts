import {TestBed} from '@angular/core/testing';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {GdrTurn} from './gdr-turn';
import {serializeGdrBlocks} from '../gdr-blocks/gdr-markdown.serializer';
import {GdrBlockRow} from '../gdr-blocks/gdr-block.types';

function setup(source:string) {
 TestBed.configureTestingModule({imports:[GdrTurn]});
 const fixture=TestBed.createComponent(GdrTurn);
 fixture.componentRef.setInput('source',source);fixture.componentRef.setInput('editable',true);fixture.componentRef.setInput('deletable',true);fixture.detectChanges();
 const buttons=(text:string)=>Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).filter(b=>b.textContent?.trim()===text);
 return {fixture,buttons};
}
describe('eliminazione dei blocchi della storia',()=>{
 afterEach(()=>TestBed.resetTestingModule());
 it('chiede conferma e rimuove solo la seconda di due frasi uguali, conservando dialoghi e ritorni a capo',()=>{
  const source='Stesso testo.\r\n\r\n::: dialogo Ada\r\nCiao.\r\n:::\r\n\r\nStesso testo.';
  const {fixture,buttons}=setup(source);fixture.componentRef.setInput('deletionScope','partita');fixture.detectChanges();
  const change=vi.fn();fixture.componentInstance.sourceChange.subscribe(change);
  expect(buttons('Elimina blocco')).toHaveLength(0);
  fixture.nativeElement.querySelectorAll('button.gdr-edit-start')[1].click();fixture.detectChanges();
  buttons('Elimina blocco')[0].click();fixture.detectChanges();expect(change).not.toHaveBeenCalled();
  buttons('Annulla')[0].click();fixture.detectChanges();expect(change).not.toHaveBeenCalled();
  expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
  buttons('Elimina blocco')[0].click();fixture.detectChanges();buttons('Elimina')[0].click();fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  expect(change).toHaveBeenCalledWith(source.slice(0,source.lastIndexOf('Stesso testo.')));
 });
 it('usa l’ID originale del blocco condiviso, senza modificare o riserializzare gli altri blocchi',()=>{
  const blocks:GdrBlockRow[]=[{id:'41',documentKey:'avventura',position:0,type:'paragraph',data:{text:'Prima.'}},{id:'76',documentKey:'avventura',position:1,type:'paragraph',data:{text:'Da eliminare.'}}];
  const {fixture,buttons}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  const remove=vi.fn(),change=vi.fn();fixture.componentInstance.deleteBlock.subscribe(remove);fixture.componentInstance.sourceChange.subscribe(change);
  expect(buttons('Elimina blocco')).toHaveLength(0);
  fixture.nativeElement.querySelectorAll('button.gdr-edit-start')[1].click();fixture.detectChanges();
  buttons('Elimina blocco')[0].click();fixture.detectChanges();buttons('Elimina')[0].click();
  expect(remove).toHaveBeenCalledWith('76');expect(change).not.toHaveBeenCalled();
 });
 it('nasconde l’eliminazione fuori dalla modifica e blocca la conferma se il testo cambia',()=>{
  const {fixture,buttons}=setup('Prima.');
  const remove=vi.fn();fixture.componentInstance.sourceChange.subscribe(remove);
  fixture.componentRef.setInput('editable',false);fixture.detectChanges();
  expect(buttons('Elimina dalla bozza')).toHaveLength(0);expect(fixture.nativeElement.querySelector('button.gdr-edit-start')).toBeNull();
  fixture.componentRef.setInput('editable',true);fixture.detectChanges();
  fixture.nativeElement.querySelector('button.gdr-edit-start').click();fixture.detectChanges();
  buttons('Elimina dalla bozza')[0].click();fixture.detectChanges();
  fixture.componentRef.setInput('source','Nuova.');fixture.detectChanges();
  expect(buttons('Elimina')).toHaveLength(0);
  buttons('Elimina dalla bozza')[0].click();fixture.detectChanges();
  expect(buttons('Elimina')).toHaveLength(0);expect(remove).not.toHaveBeenCalled();
 });
 it('annulla solo la conferma di eliminazione, conservando testo e modifica aperta',async()=>{
  const {fixture,buttons}=setup('Prima.');const editing=vi.fn();fixture.componentInstance.editingChange.subscribe(editing);
  fixture.nativeElement.querySelector('button.gdr-edit-start').click();fixture.detectChanges();await fixture.whenStable();
  const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  area.value='Modifica non ancora salvata.';area.dispatchEvent(new Event('input'));fixture.detectChanges();
  buttons('Elimina dalla bozza')[0].click();fixture.detectChanges();expect(buttons('Applica al testo')[0].disabled).toBe(true);
  buttons('Annulla')[0].click();fixture.detectChanges();
  expect(area.value).toBe('Modifica non ancora salvata.');expect(buttons('Applica al testo')[0].disabled).toBe(false);
  expect(editing.mock.calls).toEqual([[true]]);
 });
 it('mostra foto, descrizioni multilinea e dialoghi identici a master e player',()=>{
  const dialogue='La voce di Shivay.\n\n::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
  const blocks:GdrBlockRow[]=[{id:'1',documentKey:'avventura',position:0,type:'npc_grid',data:{entries:[{name:'Shivay',alt:'Shivay',image:'/assets/intera.webp',description:'Prima riga.\nSeconda riga.'}]}},{id:'2',documentKey:'avventura',position:1,type:'paragraph',data:{text:dialogue,format:'gdr-narrative'}}];
  const {fixture}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  const reading=()=>({photo:fixture.nativeElement.querySelector('.npc-card img')?.getAttribute('src'),description:fixture.nativeElement.querySelector('.npc-card p')?.textContent,avatar:fixture.nativeElement.querySelector('.speaker img')?.getAttribute('src'),dialogue:fixture.nativeElement.querySelector('.dialogue p')?.textContent});
  const master=reading();expect(master).toEqual({photo:'/assets/intera.webp',description:'Prima riga.\nSeconda riga.',avatar:'/assets/avatar.webp',dialogue:'Non è una buona notizia.'});
  fixture.componentRef.setInput('editable',false);fixture.detectChanges();expect(reading()).toEqual(master);
 });
 it('cambia il formato di un PNG già presente conservando ID, foto e descrizione',async()=>{
  const blocks:GdrBlockRow[]=[{id:'22',documentKey:'avventura',position:0,type:'npc_grid',data:{entries:[{name:'Sally',alt:'Sally',image:'/assets/intera.webp',description:'La gatta di Daisy.'}]}}];
  const {fixture,buttons}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  fixture.nativeElement.querySelector('button.gdr-edit-start').click();fixture.detectChanges();await fixture.whenStable();
  const select=fixture.nativeElement.querySelector('select[id$="-layout"]') as HTMLSelectElement;
  expect(select.value).toBe('card');select.value='full';select.dispatchEvent(new Event('change'));fixture.detectChanges();
  const save=vi.fn();fixture.componentInstance.blockChange.subscribe(save);buttons('Applica al testo')[0].click();
  expect(save).toHaveBeenCalledWith({id:'22',source:'::: npc full\n- image: /assets/intera.webp\n  alt: Sally\n  name: Sally\n  description: La gatta di Daisy.\n:::'});
 });
 it('inserisce il PNG a tutta pagina anche dalla modifica rapida e lo rende uguale per master e player',async()=>{
  const {fixture,buttons}=setup('');fixture.componentRef.setInput('insertable',true);
  fixture.componentRef.setInput('characters',[{id:'sally',name:'Sally',kind:'png',portrait:'/assets/avatar.webp',photo:'/assets/foto-intera.webp',description:'La gatta di Daisy.'}]);fixture.detectChanges();
  fixture.nativeElement.querySelector('button[aria-label="Inizia a scrivere"]').click();fixture.detectChanges();await fixture.whenStable();
  const select=fixture.nativeElement.querySelector('select[aria-label="Inserisci contenuto nel blocco"]') as HTMLSelectElement;
  select.value='npc_full';select.dispatchEvent(new Event('change'));fixture.detectChanges();
  let source='';fixture.componentInstance.sourceChange.subscribe(value=>source=value);
  buttons('Aggiungi al racconto')[0].click();fixture.componentRef.setInput('source',source);fixture.detectChanges();
  const full=fixture.nativeElement.querySelector('.npc-grid.npc-full');
  expect(full.querySelector('img').getAttribute('src')).toBe('/assets/foto-intera.webp');expect(full.textContent).toContain('Sally');expect(full.textContent).toContain('La gatta di Daisy.');
  const master=full.textContent;fixture.componentRef.setInput('editable',false);fixture.detectChanges();expect(fixture.nativeElement.querySelector('.npc-grid.npc-full').textContent).toBe(master);
 });
 it('salva la conversione in dialogo sul blocco condiviso, anziché emettere una copia privata della storia',async()=>{
  const blocks:GdrBlockRow[]=[{id:'22',documentKey:'avventura',position:0,type:'paragraph',data:{text:'Non è una buona notizia.'}}];
  const {fixture,buttons}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  const save=vi.fn(),privateCopy=vi.fn();fixture.componentInstance.blockChange.subscribe(save);fixture.componentInstance.sourceChange.subscribe(privateCopy);
  fixture.nativeElement.querySelector('button.gdr-edit-start').click();fixture.detectChanges();await fixture.whenStable();
  const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  const source='::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
  area.value=source;area.dispatchEvent(new Event('input'));fixture.detectChanges();buttons('Applica al testo')[0].click();
  expect(save).toHaveBeenCalledWith({id:'22',source});expect(privateCopy).not.toHaveBeenCalled();
 });
 it('aggiunge contenuti condivisi anche quando la storia è vuota, senza creare una bozza privata',async()=>{
  const {fixture,buttons}=setup('');fixture.componentRef.setInput('insertable',true);fixture.componentRef.setInput('sharedDocument',true);fixture.detectChanges();
  const insert=vi.fn(),privateCopy=vi.fn();fixture.componentInstance.insertBlock.subscribe(insert);fixture.componentInstance.sourceChange.subscribe(privateCopy);
  fixture.nativeElement.querySelector('button[aria-label="Inizia a scrivere"]').click();fixture.detectChanges();await fixture.whenStable();
  expect(buttons('Elimina dalla bozza')).toHaveLength(0);expect(buttons('Elimina blocco')).toHaveLength(0);
  const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;area.value='Un nuovo inizio.';area.dispatchEvent(new Event('input'));fixture.detectChanges();buttons('Aggiungi al racconto')[0].click();
  expect(insert).toHaveBeenCalledWith({beforeId:undefined,source:'Un nuovo inizio.'});expect(privateCopy).not.toHaveBeenCalled();
 });
});
