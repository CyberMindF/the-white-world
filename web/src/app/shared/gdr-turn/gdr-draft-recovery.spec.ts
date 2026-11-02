import {describe,expect,it} from 'vitest';
import {GdrBlockRow} from '../gdr-blocks/gdr-block.types';
import {serializeGdrBlocks} from '../gdr-blocks/gdr-markdown.serializer';
import {recoverStoryDraft} from './gdr-draft-recovery';
const paragraph=(id:string,text:string):GdrBlockRow=>({id,documentKey:'avventura',position:Number(id),type:'paragraph',data:{text}});
describe('recupero della vecchia bozza privata',()=>{
 it('isola il paragrafo trasformato in dialogo, senza ripubblicare avatar copiati nelle schede PNG',()=>{
  const blocks:GdrBlockRow[]=[paragraph('1','Il corridoio.'),{id:'2',documentKey:'avventura',position:2,type:'npc_grid',data:{entries:[{name:'Shivay',alt:'Shivay',image:'/assets/intera.webp',description:'Una compagna'}]}},paragraph('3','Si avvicina Shivay.'),paragraph('4','Non è una buona notizia.'),paragraph('5','Cosa fai?')];
  const dialogue='::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
  const draft=serializeGdrBlocks(blocks).replace('/assets/intera.webp','/assets/ritaglio.webp').replace('Non è una buona notizia.',dialogue);
  expect(recoverStoryDraft(blocks,draft)).toEqual([{id:'4',source:dialogue}]);
 });
 it('non recupera eliminazioni, blocchi ambigui o una bozza malformata',()=>{
  const blocks=[paragraph('1','Uguale.'),paragraph('2','Uguale.'),paragraph('3','Fine.')];
  expect(recoverStoryDraft(blocks,'Cambiato.\n\nUguale.\n\nFine.')).toEqual([]);
  expect(recoverStoryDraft(blocks,'Fine.')).toEqual([]);
  expect(recoverStoryDraft(blocks,'::: dialogo Shivay\nNon chiuso')).toEqual([]);
 });
});
