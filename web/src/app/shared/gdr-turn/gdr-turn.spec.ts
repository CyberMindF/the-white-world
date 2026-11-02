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
  buttons('Elimina blocco')[2].click();fixture.detectChanges();expect(change).not.toHaveBeenCalled();
  buttons('Annulla')[0].click();fixture.detectChanges();expect(change).not.toHaveBeenCalled();
  buttons('Elimina blocco')[2].click();fixture.detectChanges();buttons('Elimina')[0].click();
  expect(change).toHaveBeenCalledWith(source.slice(0,source.lastIndexOf('Stesso testo.')));
 });
 it('usa l’ID originale del blocco condiviso, senza modificare o riserializzare gli altri blocchi',()=>{
  const blocks:GdrBlockRow[]=[{id:'41',documentKey:'avventura',position:0,type:'paragraph',data:{text:'Prima.'}},{id:'76',documentKey:'avventura',position:1,type:'paragraph',data:{text:'Da eliminare.'}}];
  const {fixture,buttons}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  const remove=vi.fn(),change=vi.fn();fixture.componentInstance.deleteBlock.subscribe(remove);fixture.componentInstance.sourceChange.subscribe(change);
  buttons('Elimina blocco')[1].click();fixture.detectChanges();buttons('Elimina')[0].click();
  expect(remove).toHaveBeenCalledWith('76');expect(change).not.toHaveBeenCalled();
 });
 it('nasconde i comandi nella lettura player e annulla una conferma se il testo cambia',()=>{
  const {fixture,buttons}=setup('Prima.');fixture.componentRef.setInput('deletable',false);fixture.detectChanges();expect(buttons('Elimina dalla bozza')).toHaveLength(0);
  fixture.componentRef.setInput('deletable',true);fixture.detectChanges();buttons('Elimina dalla bozza')[0].click();fixture.detectChanges();
  fixture.componentRef.setInput('source','Testo aggiornato.');fixture.detectChanges();expect(buttons('Elimina')).toHaveLength(0);expect(buttons('Elimina dalla bozza')[0].disabled).toBe(false);
 });
 it('mostra foto, descrizioni multilinea e dialoghi identici a master e player',()=>{
  const dialogue='La voce di Shivay.\n\n::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
  const blocks:GdrBlockRow[]=[{id:'1',documentKey:'avventura',position:0,type:'npc_grid',data:{entries:[{name:'Shivay',alt:'Shivay',image:'/assets/intera.webp',description:'Prima riga.\nSeconda riga.'}]}},{id:'2',documentKey:'avventura',position:1,type:'paragraph',data:{text:dialogue,format:'gdr-narrative'}}];
  const {fixture}=setup(serializeGdrBlocks(blocks));fixture.componentRef.setInput('persistedBlocks',blocks);fixture.detectChanges();
  const reading=()=>({photo:fixture.nativeElement.querySelector('.npc-card img')?.getAttribute('src'),description:fixture.nativeElement.querySelector('.npc-card p')?.textContent,avatar:fixture.nativeElement.querySelector('.speaker img')?.getAttribute('src'),dialogue:fixture.nativeElement.querySelector('.dialogue p')?.textContent});
  const master=reading();expect(master).toEqual({photo:'/assets/intera.webp',description:'Prima riga.\nSeconda riga.',avatar:'/assets/avatar.webp',dialogue:'Non è una buona notizia.'});
  fixture.componentRef.setInput('editable',false);fixture.detectChanges();expect(reading()).toEqual(master);
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
  const area=fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;area.value='Un nuovo inizio.';area.dispatchEvent(new Event('input'));fixture.detectChanges();buttons('Aggiungi al racconto')[0].click();
  expect(insert).toHaveBeenCalledWith({beforeId:undefined,source:'Un nuovo inizio.'});expect(privateCopy).not.toHaveBeenCalled();
 });
});
