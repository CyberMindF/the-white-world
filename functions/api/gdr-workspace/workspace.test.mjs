import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mutate, apiHarness } from '../../../scripts/gdr-workspace-test-harness.mjs';
import { characterView } from '../../../scripts/gdr-workspace-test-harness.mjs';
const master={id:1,role:'admin',isTest:false};
const member={id:2,role:'member',isTest:false};
const other={id:3,role:'member',isTest:false};
const adventureId='il-prezzo-della-verita';
async function character(db,id='pg-one',kind='pg') {await mutate(db,master,{action:'createCharacter',id,adventureId,kind,name:id,sheet:'Scheda iniziale'});}
const revision=(sqlite,id)=>sqlite.prepare('SELECT revision FROM gdr_workspace_characters WHERE id=?').get(id).revision;
const grant=(db,sqlite,id,rights={})=>mutate(db,master,{action:'grant',characterId:id,revision:revision(sqlite,id),userId:2,canSpeak:true,canEditSheet:false,canInventory:false,...rights});
const denied=fn=>assert.rejects(fn,e=>e.status===403);

test('solo il master crea avventure e PG, anche più PG assegnati allo stesso giocatore',async()=>{
  const {db,sqlite}=fixture();
  await denied(()=>mutate(db,member,{action:'createAdventure',id:'new',title:'Nuova'}));
  await denied(()=>mutate(db,member,{action:'createCharacter',id:'unowned',adventureId,kind:'pg',name:'PG'}));
  await character(db);await character(db,'pg-two');await grant(db,sqlite,'pg-one');await grant(db,sqlite,'pg-two');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM gdr_workspace_grants WHERE user_id=2').get().n,2);
  sqlite.close();
});
test('PNG assegnato: interpretazione e zaino non consentono la modifica della scheda',async()=>{
  const {db,sqlite}=fixture();await character(db,'npc','png');await grant(db,sqlite,'npc',{canInventory:true});
  const rev=revision(sqlite,'npc');
  await denied(()=>mutate(db,member,{action:'saveCharacter',characterId:'npc',revision:rev,name:'Intruso',portrait:'',sheet:'Alterata'}));
  await mutate(db,member,{action:'inventory',characterId:'npc',revision:rev,items:[{id:'key',name:'Chiave',quantity:1,notes:'Di ferro'}]});
  assert.equal(sqlite.prepare('SELECT sheet FROM gdr_workspace_characters WHERE id=\'npc\'').get().sheet,'Scheda iniziale');
  assert.equal(JSON.parse(sqlite.prepare('SELECT inventory_json FROM gdr_workspace_characters WHERE id=\'npc\'').get().inventory_json)[0].name,'Chiave');
  await assert.rejects(()=>grant(db,sqlite,'npc',{canEditSheet:true}),e=>e.status===400);sqlite.close();
});
test('scheda PG modificabile soltanto con permesso esplicito, nessuna escalation da payload',async()=>{
  const {db,sqlite}=fixture();await character(db);await grant(db,sqlite,'pg-one');
  const save=()=>mutate(db,member,{action:'saveCharacter',characterId:'pg-one',revision:revision(sqlite,'pg-one'),name:'Ada',portrait:'',sheet:'Nuova scheda',canEditSheet:true});
  await denied(save);await grant(db,sqlite,'pg-one',{canEditSheet:true});await save();
  await denied(()=>mutate(db,other,{action:'inventory',characterId:'pg-one',revision:revision(sqlite,'pg-one'),items:[]}));sqlite.close();
});
test('revoca e archiviazione bloccano anche editor già aperti; conflitti non sovrascrivono',async()=>{
  const {db,sqlite}=fixture();await character(db);await grant(db,sqlite,'pg-one',{canInventory:true});
  const oldRevision=revision(sqlite,'pg-one');await grant(db,sqlite,'pg-one',{canInventory:false});
  await denied(()=>mutate(db,member,{action:'inventory',characterId:'pg-one',revision:oldRevision,items:[]}));
  await grant(db,sqlite,'pg-one',{canInventory:true});const rev=revision(sqlite,'pg-one');
  await mutate(db,member,{action:'inventory',characterId:'pg-one',revision:rev,items:[]});
  await assert.rejects(()=>mutate(db,member,{action:'inventory',characterId:'pg-one',revision:rev,items:[]}),e=>e.status===409);
  await mutate(db,master,{action:'archive',characterId:'pg-one',revision:revision(sqlite,'pg-one'),archived:true});
  await denied(()=>mutate(db,member,{action:'inventory',characterId:'pg-one',revision:revision(sqlite,'pg-one'),items:[]}));sqlite.close();
});
test('nuova avventura salvata e retry idempotente; avventure e turni storici intatti',async()=>{
  const {db,sqlite}=fixture();
  const payload={action:'createAdventure',id:'new',title:'Una nuova storia'};await mutate(db,master,payload);await mutate(db,master,payload);
  await mutate(db,master,{action:'saveAdventure',id:'new',revision:1,title:'Una nuova storia',source:'## Capitolo uno\n\nTesto scritto dal sito.'});
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM gdr_workspace_adventures WHERE id=\'new\'').get().n,1);
  assert.match(sqlite.prepare('SELECT source FROM gdr_workspace_adventures WHERE id=\'new\'').get().source,/Capitolo uno/);
  await denied(()=>mutate(db,master,{action:'saveAdventure',id:adventureId,revision:1,title:'Modificata',source:'Sovrascritta'}));
  assert.equal(sqlite.prepare('SELECT body FROM gdr_turns').get().body,'Turno originale');sqlite.close();
});
test('validazione quantità, ritratto, revisione e account di prova',async()=>{
  const {db,sqlite}=fixture();await character(db);
  await denied(()=>mutate(db,{...master,isTest:true},{action:'createAdventure',id:'test',title:'No'}));
  for(const quantity of [-1,1.5,100000])await assert.rejects(()=>mutate(db,master,{action:'inventory',characterId:'pg-one',revision:1,items:[{id:'bad',name:'Errato',quantity}]}),e=>e.status===400);
  await assert.rejects(()=>mutate(db,master,{action:'saveCharacter',characterId:'pg-one',revision:1,name:'Nome',portrait:'https://example.com/track.jpg',sheet:''}),e=>e.status===400);
  const row=sqlite.prepare('SELECT * FROM gdr_workspace_characters').get();assert.equal(characterView({...row,can_speak:1,can_inventory:0},member).canSpeak,true);assert.equal(characterView({...row,kind:'png',can_edit_sheet:1},member).canEditSheet,false);sqlite.close();
});

test('API: autenticazione, bozze riservate e visibilità dei soli personaggi assegnati',async()=>{
  const h=apiHarness();
  assert.equal((await h.call(0)).status,401);
  await mutate(h.db,master,{action:'createAdventure',id:'private',title:'Segreto del master',source:'Finale segreto'});
  assert.equal((await h.call(2,'GET',undefined,'private')).status,404);
  assert.equal((await (await h.call(2)).json()).adventures.some(a=>a.id==='private'),false);
  await character(h.db,'first');await character(h.db,'hidden');await grant(h.db,h.sqlite,'first');
  const view=await (await h.call(2)).json();assert.deepEqual(view.characters.map(c=>c.id),['first']);assert.deepEqual(view.users,[]);assert.deepEqual(view.grants,[]);
  await mutate(h.db,master,{action:'publishAdventure',id:'private',revision:1,published:true});
  assert.equal((await h.call(2,'GET',undefined,'private')).status,200);
  const forbidden=await h.call(2,'POST',{action:'createAdventure',id:'no',title:'No'});assert.equal(forbidden.status,403);
  assert.equal((await h.call(1,'POST',{action:'createAdventure',id:'test-account',title:'No'},adventureId,{'x-test':'1'})).status,403);
  h.sqlite.close();
});

test('i poteri storici restano collegati al solo protagonista assegnato, anche dopo la sua eliminazione',async()=>{
  const h=apiHarness();await character(h.db,'protagonist');await character(h.db,'another');
  await grant(h.db,h.sqlite,'protagonist');await grant(h.db,h.sqlite,'another');
  h.sqlite.prepare("INSERT INTO gdr_workspace_story_links(adventure_id,source_key,character_id) VALUES(?,'pg',?)").run(adventureId,'protagonist');
  let data=await (await h.call(2)).json();
  assert.equal(data.characters.find(c=>c.id==='protagonist').legacyProtagonist,true);
  assert.equal(data.characters.find(c=>c.id==='another').legacyProtagonist,false);
  await mutate(h.db,master,{action:'deleteCharacter',characterId:'protagonist',revision:revision(h.sqlite,'protagonist')});
  data=await (await h.call(2)).json();assert.deepEqual(data.characters.map(c=>c.legacyProtagonist),[false]);h.sqlite.close();
});

test('profilo strutturato e inventario importato: campi validati, scheda PNG protetta',async()=>{
  const h=apiHarness();
  await mutate(h.db,master,{action:'createCharacter',id:'profile-npc',adventureId,kind:'png',name:'Ada',profile:{surname:'Neri',appearance:'Alta',personality:'Riservata',history:'Una lunga storia',goal:'Ritrovare un amico',abilities:'Osservazione'},items:[{id:'item-a',name:'Chiave',quantity:2,notes:''}]});
  let data=await (await h.call(1)).json();const c=data.characters.find(c=>c.id==='profile-npc');assert.equal(c.profile.surname,'Neri');assert.equal(c.inventory[0].quantity,2);
  await grant(h.db,h.sqlite,'profile-npc',{canInventory:true});
  await denied(()=>mutate(h.db,member,{action:'saveCharacter',characterId:c.id,revision:revision(h.sqlite,c.id),name:'Ada',sheet:'',portrait:'',profile:{history:'Spoof'}}));
  await assert.rejects(()=>mutate(h.db,master,{action:'saveCharacter',characterId:c.id,revision:revision(h.sqlite,c.id),name:'Ada',sheet:'',portrait:'',profile:{history:'x'.repeat(6001)}}),e=>e.status===400);
  h.sqlite.close();
});
test('upload immagini: autenticazione, permessi PG/PNG, formato e dimensione prima della scrittura R2',async()=>{
  const h=apiHarness();await character(h.db,'avatar-pg');await character(h.db,'avatar-npc','png');
  await grant(h.db,h.sqlite,'avatar-pg',{canEditSheet:true});await grant(h.db,h.sqlite,'avatar-npc',{canInventory:true});
  const image=new TextEncoder().encode('RIFF0000WEBPVP8 00000000');
  assert.equal((await h.upload(0,'avatar-pg','avatar',image)).status,401);
  assert.equal((await h.upload(2,'avatar-npc','avatar',image)).status,403);
  assert.equal((await h.upload(3,'avatar-pg','avatar',image)).status,403);
  assert.equal((await h.upload(2,'avatar-pg','avatar',image,{'Content-Type':'image/svg+xml'})).status,415);
  assert.equal((await h.upload(2,'avatar-pg','avatar',new Uint8Array(2*1024*1024+1))).status,413);
  assert.equal(h.media.size,0);
  const response=await h.upload(2,'avatar-pg','avatar',image);assert.equal(response.status,201);assert.match((await response.json()).path,/^\/api\/media\/gdr-workspace\/avatar-pg\/avatar\//);assert.equal(h.media.size,1);
  h.sqlite.close();
});

test('eliminazione: solo master, revisione corrente, rimozione delle assegnazioni e storia intatta',async()=>{
  const h=apiHarness(); await character(h.db,'remove-me'); await character(h.db,'keep-me');
  await grant(h.db,h.sqlite,'remove-me',{canEditSheet:true,canInventory:true});
  const rev=revision(h.sqlite,'remove-me');
  await denied(()=>mutate(h.db,member,{action:'deleteCharacter',characterId:'remove-me',revision:rev}));
  await assert.rejects(()=>mutate(h.db,master,{action:'deleteCharacter',characterId:'remove-me',revision:rev-1}),e=>e.status===409);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_workspace_grants WHERE character_id=?').get('remove-me').n,1);
  const response=await h.call(1,'POST',{action:'deleteCharacter',characterId:'remove-me',revision:rev});
  assert.equal(response.status,200);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_workspace_characters WHERE id=?').get('remove-me').n,0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_workspace_grants WHERE character_id=?').get('remove-me').n,0);
  assert.equal(h.sqlite.prepare('SELECT name FROM gdr_workspace_characters WHERE id=?').get('keep-me').name,'keep-me');
  assert.equal(h.sqlite.prepare('SELECT body FROM gdr_turns').get().body,'Turno originale');
  assert.equal((await h.call(1,'POST',{action:'deleteCharacter',characterId:'keep-me',revision:1},adventureId,{'x-test':'1'})).status,403);
  h.sqlite.close();
});
test('revoca completa: il personaggio scompare alla giocatrice e gli editor aperti perdono accesso',async()=>{
  const h=apiHarness();await character(h.db,'revoked');await grant(h.db,h.sqlite,'revoked',{canEditSheet:true,canInventory:true});
  const oldRevision=revision(h.sqlite,'revoked');
  await grant(h.db,h.sqlite,'revoked',{canSpeak:false,canEditSheet:false,canInventory:false});
  assert.equal((await (await h.call(2)).json()).characters.length,0);
  const masterView=await (await h.call(1)).json();
  assert.equal(masterView.characters.length,1);assert.equal(masterView.grants.length,0);
  await denied(()=>mutate(h.db,member,{action:'saveCharacter',characterId:'revoked',revision:oldRevision,name:'No',portrait:'',sheet:'No'}));
  await grant(h.db,h.sqlite,'revoked',{canSpeak:true});
  assert.equal((await (await h.call(2)).json()).characters[0].id,'revoked');
  h.sqlite.close();
});

test('unificazione: conserva PG assegnato, statistiche e gatto; il nome modificato dalla giocatrice arriva al master',async()=>{
 const h=apiHarness();await character(h.db,'original');h.sqlite.prepare("UPDATE gdr_workspace_characters SET name='Il mio personaggio' WHERE id='original'").run();await grant(h.db,h.sqlite,'original',{canEditSheet:true});
 h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify([{key:'name',label:'Nome',type:'text',default:''},{key:'catName',label:'Gatto',type:'text',default:''},{key:'statMente',label:'Mente',type:'number',min:1,max:5,default:1},{key:'inventory',label:'Inventario',type:'text',default:'Bacchetta\nTaccuino'}]));
 for(const [k,v] of Object.entries({name:'Ada',catName:'Luna',statMente:'4'})) h.sqlite.prepare('INSERT INTO gdr_character_fields VALUES(?,?,?)').run(adventureId,k,v);
 await mutate(h.db,master,{action:'syncLegacy',adventureId});
 let c=(await (await h.call(2)).json()).characters[0];
 assert.equal(c.id,'original');assert.equal(c.characterFields.catName,'Luna');assert.equal(c.characterFields.statMente,'4');assert.equal(c.characterFields.name,undefined);assert.deepEqual(c.inventory.map(i=>i.name),['Bacchetta','Taccuino']);assert.equal(c.characterFields.inventory,undefined);
 await mutate(h.db,member,{action:'saveCharacter',characterId:c.id,revision:c.revision,name:'Nuovo nome',portrait:'',sheet:c.sheet,profile:{surname:'Alba'},characterFields:{catName:'Stella',statMente:'4'}});
 await mutate(h.db,master,{action:'syncLegacy',adventureId});
 c=(await (await h.call(1)).json()).characters[0];assert.equal(c.name,'Nuovo nome');assert.equal(c.profile.surname,'Alba');assert.equal(c.characterFields.catName,'Stella');assert.equal(c.characterFields.statMente,'4');
 assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM gdr_workspace_characters WHERE kind='pg'").get().n,1);h.sqlite.close();
});
test('PNG del racconto: una sola identità, rinomina visibile nella storia e nessuna ricreazione dopo eliminazione',async()=>{
 const h=apiHarness();h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,'[]');
 h.sqlite.prepare('INSERT INTO gdr_blocks VALUES(1,?,?,?,0)').run('avventura','npc_grid',JSON.stringify({entries:[{name:'Shivay',image:'',description:'Una compagna'}]}));
 await mutate(h.db,master,{action:'createCharacter',id:'existing-npc',adventureId,kind:'png',name:'Shivay'});
 await mutate(h.db,master,{action:'syncLegacy',adventureId});await mutate(h.db,master,{action:'syncLegacy',adventureId});
 let view=await (await h.call(1)).json();assert.equal(view.characters.filter(c=>c.kind==='png').length,1);
 let npc=view.characters.find(c=>c.id==='existing-npc');
 await mutate(h.db,master,{action:'saveCharacter',characterId:npc.id,revision:npc.revision,name:'Shivay nuova',portrait:'',sheet:'',profile:{appearance:'Descrizione aggiornata'}});
 let story=(await (await h.call(2)).json()).storyCharacters[0];assert.equal(story.name,'Shivay nuova');assert.equal(story.description,'Descrizione aggiornata');
 await mutate(h.db,master,{action:'deleteCharacter',characterId:npc.id,revision:revision(h.sqlite,npc.id)});
 await mutate(h.db,master,{action:'syncLegacy',adventureId});
 assert.equal((await (await h.call(1)).json()).characters.filter(c=>c.kind==='png').length,0);
 assert.equal((await (await h.call(2)).json()).storyCharacters[0].deleted,true);h.sqlite.close();
});
test('campi numerici della scheda unica: valori non validi non sovrascrivono il personaggio',async()=>{
 const h=apiHarness();await character(h.db,'numbers');
 h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify([{key:'mente',label:'Mente',type:'number',min:1,max:5}]));
 const c=h.sqlite.prepare('SELECT * FROM gdr_workspace_characters WHERE id=?').get('numbers');
 await assert.rejects(()=>mutate(h.db,master,{action:'saveCharacter',characterId:c.id,revision:c.revision,name:c.name,portrait:'',sheet:'',characterFields:{mente:'6'}}),e=>e.status===400);
 assert.equal(revision(h.sqlite,'numbers'),c.revision);h.sqlite.close();
});
test('foto nel racconto e avatar del PNG restano indipendenti dopo il ritaglio',async()=>{
 const h=apiHarness();h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,'[]');
 h.sqlite.prepare('INSERT INTO gdr_blocks VALUES(1,?,?,?,0)').run('avventura','npc_grid',JSON.stringify({entries:[{name:'Shivay',image:'/assets/shivay-intera.webp',description:'Una compagna'}]}));
 await mutate(h.db,master,{action:'syncLegacy',adventureId});
 let npc=(await (await h.call(1)).json()).characters.find(c=>c.kind==='png');
 await mutate(h.db,master,{action:'saveCharacter',characterId:npc.id,revision:npc.revision,name:npc.name,portrait:'/api/media/gdr-workspace/shivay/avatar/ritaglio.webp',sheet:'',profile:npc.profile});
 const story=(await (await h.call(2)).json()).storyCharacters[0];
 assert.equal(story.photo,'/assets/shivay-intera.webp');assert.equal(story.portrait,'/api/media/gdr-workspace/shivay/avatar/ritaglio.webp');
 npc=(await (await h.call(1)).json()).characters.find(c=>c.kind==='png');
 await mutate(h.db,master,{action:'saveCharacter',characterId:npc.id,revision:npc.revision,name:npc.name,portrait:npc.portrait,photo:'/assets/shivay-nuova-intera.webp',sheet:'',profile:npc.profile});
 assert.equal((await (await h.call(2)).json()).storyCharacters[0].photo,'/assets/shivay-nuova-intera.webp');h.sqlite.close();
});
test('anche i vecchi pannelli leggono e scrivono sul PG canonico senza creare copie del nome',async()=>{
 const h=apiHarness();h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify([{key:'name',label:'Nome',type:'text',default:''},{key:'catName',label:'Gatto',type:'text',default:''}]));
 h.sqlite.prepare('INSERT INTO gdr_character_fields VALUES(?,?,?)').run(adventureId,'name','Ada');
 await mutate(h.db,master,{action:'syncLegacy',adventureId});
 assert.equal((await (await h.oldFields(2)).json()).values.name,'Ada');
 assert.equal((await h.oldFields(2,'name','Alba')).status,200);
 assert.equal((await h.oldFields(2,'catName','Luna')).status,200);
 const c=(await (await h.call(1)).json()).characters[0];assert.equal(c.name,'Alba');assert.equal(c.characterFields.catName,'Luna');
 assert.equal((await (await h.oldFields(2)).json()).values.name,'Alba');h.sqlite.close();
});
test('la giocatrice modifica i dati personali senza sovrascrivere il testo e le abilità preparati dal master',async()=>{
 const h=apiHarness();await mutate(h.db,master,{action:'createCharacter',id:'restricted-sheet',adventureId,kind:'pg',name:'Ada',sheet:'Regole del master',profile:{abilities:'Abilità del master'}});
 await grant(h.db,h.sqlite,'restricted-sheet',{canEditSheet:true});
 await mutate(h.db,member,{action:'saveCharacter',characterId:'restricted-sheet',revision:revision(h.sqlite,'restricted-sheet'),name:'Alba',sheet:'Testo sostituito',portrait:'',profile:{surname:'Neri',appearance:'Capelli chiari',abilities:'Nuovi poteri'}});
 const c=(await (await h.call(1)).json()).characters[0];assert.equal(c.name,'Alba');assert.equal(c.profile.surname,'Neri');assert.equal(c.profile.appearance,'Capelli chiari');assert.equal(c.sheet,'Regole del master');assert.equal(c.profile.abilities,'Abilità del master');
 h.sqlite.close();
});

test('distribuzione iniziale: totale obbligatorio, conferma atomica e blocco delle modifiche successive',async()=>{
 const h=apiHarness();await character(h.db,'points');await grant(h.db,h.sqlite,'points',{canEditSheet:true});
 h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(['statMente','statCuore','statCorpo','statMagia'].map(key=>({key,label:key,type:'number',min:1,max:5,default:1}))));
 const values={statMente:'3',statCuore:'3',statCorpo:'3',statMagia:'3'};
 await assert.rejects(()=>mutate(h.db,member,{action:'confirmStats',characterId:'points',revision:revision(h.sqlite,'points'),values:{...values,statMagia:'2'}}),e=>e.status===400);
 await mutate(h.db,member,{action:'confirmStats',characterId:'points',revision:revision(h.sqlite,'points'),values});
 let c=(await (await h.call(2)).json()).characters[0];assert.equal(c.statsEditable,false);assert.equal(c.canEditStats,false);assert.equal(c.characterFields.statMente,'3');
 await denied(()=>mutate(h.db,member,{action:'confirmStats',characterId:c.id,revision:c.revision,values}));
 await denied(()=>mutate(h.db,member,{action:'saveCharacter',characterId:c.id,revision:c.revision,name:'Alba',sheet:'',portrait:'',characterFields:{...values,statMente:'4'}}));
 await mutate(h.db,member,{action:'saveCharacter',characterId:c.id,revision:c.revision,name:'Alba',sheet:'',portrait:'',characterFields:{catName:'Luna'}});
 c=(await (await h.call(1)).json()).characters[0];assert.equal(c.name,'Alba');assert.equal(c.characterFields.statMente,'3');assert.equal(c.statsEditable,false);
h.sqlite.close();
});
test('solo il master riapre la distribuzione, anche con un nuovo totale; la nuova conferma richiude il permesso',async()=>{
 const h=apiHarness();await character(h.db,'level-up');await grant(h.db,h.sqlite,'level-up',{canEditSheet:true});
 await mutate(h.db,master,{action:'setStatAccess',characterId:'level-up',revision:revision(h.sqlite,'level-up'),editable:false,budget:12});
 await denied(()=>mutate(h.db,member,{action:'setStatAccess',characterId:'level-up',revision:revision(h.sqlite,'level-up'),editable:true,budget:14}));
 await mutate(h.db,master,{action:'setStatAccess',characterId:'level-up',revision:revision(h.sqlite,'level-up'),editable:true,budget:14});
 let c=(await (await h.call(2)).json()).characters[0];assert.equal(c.canEditStats,true);assert.equal(c.statsBudget,14);
 await mutate(h.db,member,{action:'confirmStats',characterId:c.id,revision:c.revision,values:{statMente:'4',statCuore:'4',statCorpo:'3',statMagia:'3'}});
 c=(await (await h.call(2)).json()).characters[0];assert.equal(c.canEditStats,false);assert.equal(c.statsEditable,false);h.sqlite.close();
});
test('Stress e slot: aggiornamento immediato anche con caratteristiche bloccate e senza modifica della scheda',async()=>{
 const h=apiHarness();h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify([{key:'stressCurrent',type:'number',min:0,max:10,default:10},{key:'spellSlotsCurrent',type:'number',min:0,max:3,default:3}]));
 await character(h.db,'resources');await grant(h.db,h.sqlite,'resources',{canEditSheet:false});
 await mutate(h.db,master,{action:'setStatAccess',characterId:'resources',revision:revision(h.sqlite,'resources'),editable:false,budget:12});
 const old=revision(h.sqlite,'resources');await mutate(h.db,member,{action:'adjustResource',characterId:'resources',revision:old,fieldKey:'spellSlotsCurrent',delta:-1});
 await assert.rejects(()=>mutate(h.db,member,{action:'adjustResource',characterId:'resources',revision:old,fieldKey:'spellSlotsCurrent',delta:-1}),e=>e.status===409);
 await mutate(h.db,member,{action:'adjustResource',characterId:'resources',revision:revision(h.sqlite,'resources'),fieldKey:'stressCurrent',delta:-1});
 const c=(await (await h.call(2)).json()).characters[0];assert.equal(c.characterFields.spellSlotsCurrent,'2');assert.equal(c.characterFields.stressCurrent,'9');assert.equal(c.statsEditable,false);assert.equal(c.canEditSheet,false);assert.equal(c.canAdjustResources,true);
 await denied(()=>mutate(h.db,other,{action:'adjustResource',characterId:c.id,revision:c.revision,fieldKey:'stressCurrent',delta:-1}));
 await assert.rejects(()=>mutate(h.db,member,{action:'adjustResource',characterId:c.id,revision:c.revision,fieldKey:'statMente',delta:1}),e=>e.status===400);
 h.sqlite.prepare("UPDATE gdr_workspace_characters SET fields_json=json_set(fields_json,'$.spellSlotsCurrent','0') WHERE id=?").run(c.id);
 await assert.rejects(()=>mutate(h.db,member,{action:'adjustResource',characterId:c.id,revision:c.revision,fieldKey:'spellSlotsCurrent',delta:-1}),e=>e.status===400);h.sqlite.close();
});
