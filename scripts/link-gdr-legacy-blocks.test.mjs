import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSource,resolveLegacyCharacter} from './link-gdr-legacy-blocks.mjs';
const roster=[{id:'pg-1',name:'Daisy Bordegard',kind:'pg'},{id:'png-1',name:'Shivay Lorenne',kind:'png',photo:'/assets/shivay.webp'}];
test('links existing PG/PNG blocks only, preserves CRLF and prose, and is idempotent',()=>{
 const prose='Daisy dice: ciao. Shivay risponde.';
 const source=prose+'\r\n\r\n::: dialogo Daisy\r\nCiao Shivay.\r\n:::\r\n\r\n::: npc\r\n- image: /assets/shivay.webp\r\n  alt: Shivay\r\n  name: Shivay Lorenne\r\n  description: Una descrizione.\r\n:::';
 const linked=linkSource(source,roster);
 assert.match(linked,/::: dialogo Daisy \|  \| pg-1\r\n/);
 assert.match(linked,/characterId: png-1/);
 assert.equal(linked.replace('::: dialogo Daisy |  | pg-1','::: dialogo Daisy').replace('  characterId: png-1\r\n',''),source);
 assert.equal(linkSource(linked,roster),linked);
 assert.equal(linkSource(prose,roster),prose);
});
test('ambiguous names stay unbound and callout contents are not reinterpreted',()=>{
 assert.equal(resolveLegacyCharacter([...roster,{id:'pg-2',name:'Daisy Due',kind:'pg'}],'Daisy'),undefined);
 const source='::: callout\n::: dialogo Daisy\nCiao\n:::';
 assert.equal(linkSource(source,roster),source);
});
test('an existing ID survives arbitrary later renames and portrait changes',()=>{
 const linked=linkSource('::: dialogo Daisy\nCiao.\n:::',roster);
 const renamed=roster.map(c=>({...c,name:'Completamente diversa',portrait:'/assets/nuova.webp'}));
 assert.equal(linkSource(linked,renamed),linked);
 assert.match(linked,/pg-1/);
});
