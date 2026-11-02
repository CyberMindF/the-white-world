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
});
