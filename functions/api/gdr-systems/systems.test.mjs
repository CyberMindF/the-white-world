import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {systemsHarness} from '../../../scripts/gdr-systems-test-harness.mjs';
import {fixture,mutate} from '../../../scripts/gdr-workspace-test-harness.mjs';
const master={id:1,role:'admin',isTest:false},member={id:2,role:'member',isTest:false};
const fields=[{key:'vigore',label:'Vigore',type:'number',role:'stat',min:1,max:3,default:1},{key:'agilita',label:'Agilità',type:'number',role:'stat',min:1,max:3,default:1},{key:'hp',label:'Energia',type:'number',role:'resource',min:0,max:10,default:5}];
const system=(id='sys-a',extra={})=>({action:'saveSystem',id,name:'Sistema '+id,description:'Condiviso',fields,statBudget:4,ruleIds:[],powerIds:[],revision:null,...extra});
const rule=(extra={})=>({action:'saveRule',id:'rule-a',title:'Prova di coraggio',revision:null,blocks:[{type:'paragraph',data:{text:'Tira un dado.'}}],...extra});
async function getSystem(h,id){return (await (await h.resource()).json()).systems.find(s=>s.id===id);}
async function save(h,p){const r=await h.resource('systems','POST',p);assert.equal(r.status,200,JSON.stringify(await r.json()));return r;}
async function adventure(h,id,systemId){await mutate(h.db,master,{action:'createAdventure',id,title:id,source:'Testo originale',systemId});h.sqlite.prepare('UPDATE gdr_workspace_adventures SET published=1 WHERE id=?').run(id);}
async function character(h,id='pg',adventureId='story-a',kind='pg'){await mutate(h.db,master,{action:'createCharacter',id,adventureId,kind,name:id});}
const revision=(h,id)=>h.sqlite.prepare('SELECT revision FROM gdr_workspace_characters WHERE id=?').get(id).revision;

test('sistemi: permessi reali, modalità admin, account test e Safe controllati sul server',async()=>{
  const h=systemsHarness();try{
    for(const [user,headers,status] of [[0,{},401],[2,{},403],[1,{'x-no-admin':'1'},403],[1,{'x-test':'1'},403],[1,{'x-safe':'1'},403]]){
      assert.equal((await h.resource('systems','GET',undefined,user,headers)).status,status);
      assert.equal((await h.resource('systems','POST',system(),user,headers)).status,status);
    }
    assert.equal(h.sqlite.prepare("SELECT count(*) n FROM gdr_systems WHERE id='sys-a'").get().n,0);
  }finally{h.sqlite.close();}
});
test('migrazione: conserva documenti, campi, valori, revisioni e assegnazioni',()=>{
  const h=fixture({systems:false});try{
    const id='il-prezzo-della-verita';
    h.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(id,JSON.stringify(fields));
    const rules=[{type:'heading',data:{level:2,text:'Regole'}},{type:'table',data:{header:['Dado','Esito'],rows:[['1','Bene']]}}];
    h.sqlite.prepare('UPDATE gdr_workspace_adventures SET rules_json=? WHERE id=?').run(JSON.stringify(rules),id);
    h.sqlite.prepare("INSERT INTO gdr_workspace_characters(id,adventure_id,kind,name,created_by,created_at,fields_json) VALUES('pg',?,'pg','Daisy',1,'originale',?)").run(id,JSON.stringify({hp:'7',agilita:'2',vigore:'2',vecchio:'conservato'}));
    h.sqlite.exec("INSERT INTO gdr_powers(id,kind,name) VALUES('spell','spell','Scudo');INSERT INTO gdr_power_adventures VALUES('spell','il-prezzo-della-verita');INSERT INTO gdr_character_powers VALUES('pg','spell');");
    const before=h.sqlite.prepare('SELECT * FROM gdr_workspace_characters').all().map(c=>({...c}));
    h.sqlite.exec(readFileSync('migrations/0163_add_gdr_systems.sql','utf8'));
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM gdr_workspace_characters').all().map(({stat_budget_override,...c})=>c),before);
    const migrated=h.sqlite.prepare('SELECT r.type,r.data_json FROM gdr_rule_blocks r JOIN gdr_system_rules sr ON sr.rule_id=r.id WHERE sr.system_id=? ORDER BY sr.position').all(id).map(r=>({type:r.type,data:JSON.parse(r.data_json)}));
    assert.deepEqual(migrated,rules);assert.deepEqual(JSON.parse(h.sqlite.prepare('SELECT rules_json FROM gdr_workspace_adventures WHERE id=?').get(id).rules_json),rules);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM gdr_character_powers').get().n,1);
    assert.equal(h.sqlite.prepare('SELECT count(*) n FROM gdr_power_availability').get().n,1);
    assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{h.sqlite.close();}
});
test('blocchi condivisi: una modifica si propaga a due sistemi e alle rispettive avventure; una copia resta indipendente',async()=>{
  const h=systemsHarness();try{
    await save(h,rule());await save(h,system('sys-a',{ruleIds:['rule-a']}));await save(h,system('sys-b',{ruleIds:['rule-a']}));
    await adventure(h,'story-a','sys-a');await adventure(h,'story-b','sys-b');
    await save(h,rule({revision:1,blocks:[{type:'paragraph',data:{text:'Regola aggiornata.'}}]}));
    for(const id of ['story-a','story-b']){const a=(await(await h.call(2,'GET',undefined,id)).json()).adventures.find(a=>a.id===id);assert.equal(a.rules[0].data.text,'Regola aggiornata.');assert.equal(a.fields[2].key,'hp');}
    assert.ok(h.events.some(e=>e.adventure==='story-a'));assert.ok(h.events.some(e=>e.adventure==='story-b'));
    await save(h,rule({id:'rule-copy',blocks:[{type:'paragraph',data:{text:'Versione indipendente.'}}]}));
    let b=await getSystem(h,'sys-b');await save(h,{...b,action:'saveSystem',ruleIds:['rule-copy']});
    await save(h,rule({revision:2,blocks:[{type:'paragraph',data:{text:'Solo originale.'}}]}));
    assert.equal((await(await h.call(2,'GET',undefined,'story-b')).json()).adventures.find(a=>a.id==='story-b').rules[0].data.text,'Versione indipendente.');
    assert.equal((await h.resource('systems','POST',rule({revision:1}))).status,409);
  }finally{h.sqlite.close();}
});
test('schede ereditate: valori iniziali, risorse e distribuzione punti funzionano anche in una nuova avventura',async()=>{
  const h=systemsHarness();try{
    await save(h,system());await adventure(h,'story-a','sys-a');await character(h);
    await mutate(h.db,master,{action:'grant',characterId:'pg',revision:revision(h,'pg'),userId:2,canSpeak:true,canEditSheet:true,canInventory:false});
    let c=(await(await h.call(2,'GET',undefined,'story-a')).json()).characters[0];assert.equal(c.characterFields.hp,'5');assert.equal(c.statsBudget,4);assert.equal(c.canEditStats,true);
    await mutate(h.db,member,{action:'adjustResource',characterId:'pg',revision:c.revision,fieldKey:'hp',delta:-1});
    await mutate(h.db,member,{action:'confirmStats',characterId:'pg',revision:revision(h,'pg'),values:{vigore:'2',agilita:'2'}});
    c=(await(await h.call(2,'GET',undefined,'story-a')).json()).characters[0];assert.equal(c.characterFields.hp,'4');assert.equal(c.canEditStats,false);
    await assert.rejects(()=>mutate(h.db,member,{action:'saveCharacter',characterId:'pg',revision:c.revision,name:'pg',sheet:'',portrait:'',characterFields:{vigore:'3'}}),e=>e.status===403);
    await character(h,'npc','story-a','png');
    await mutate(h.db,master,{action:'adjustResource',characterId:'npc',revision:revision(h,'npc'),fieldKey:'hp',delta:-1});
    assert.equal(JSON.parse(h.sqlite.prepare("SELECT fields_json FROM gdr_workspace_characters WHERE id='npc'").get().fields_json).hp,'4');
  }finally{h.sqlite.close();}
});
test('catalogo: disponibilità per sistemi, assegnazioni protette e descrizione unica',async()=>{
  const h=systemsHarness();try{
    await save(h,system());await save(h,system('sys-b'));await adventure(h,'story-a','sys-a');await adventure(h,'story-b','sys-b');await character(h);await character(h,'npc','story-b','png');
    const power={id:'spell',kind:'spell',name:'Scudo',description:'Condiviso',effects:[],revision:null,systemIds:['sys-a','sys-b']};
    assert.equal((await h.resource('powers','POST',power)).status,201);
    for(const id of ['pg','npc'])assert.equal((await h.resource('assignments','PUT',{characterId:id,revision:revision(h,id),powerIds:['spell']})).status,200);
    let s=await getSystem(h,'sys-a');const oldLinks=h.sqlite.prepare('SELECT * FROM gdr_system_powers').all();
    assert.equal((await h.resource('systems','POST',{...s,action:'saveSystem',powerIds:[]})).status,409);assert.deepEqual(h.sqlite.prepare('SELECT * FROM gdr_system_powers').all(),oldLinks);
    const p=(await(await h.resource('powers')).json()).powers.find(p=>p.id==='spell');
    assert.equal((await h.resource('powers','POST',{...power,revision:p.revision,systemIds:['sys-a']})).status,409);
    assert.equal((await h.resource('powers','POST',{...power,revision:p.revision,description:'Aggiornata'})).status,200);
    const state=(await(await h.call(1,'GET',undefined,'story-a')).json());assert.equal(state.characters[0].powers[0].description,'Aggiornata');
  }finally{h.sqlite.close();}
});
test('conflitti e compatibilità: nessuna cancellazione parziale e nessuna perdita di valori cambiando sistema',async()=>{
  const h=systemsHarness();try{
    await save(h,rule());await save(h,system('sys-a',{ruleIds:['rule-a']}));await save(h,system('sys-b',{fields:fields.map(f=>f.key==='hp'?{...f,max:2,default:2}:f)}));await adventure(h,'story-a','sys-a');await character(h);
    const a=h.sqlite.prepare("SELECT revision FROM gdr_workspace_adventures WHERE id='story-a'").get(),b=await getSystem(h,'sys-b');
    assert.equal((await h.resource('systems','POST',{action:'assignSystem',id:'story-a',revision:a.revision,systemId:'sys-b',systemRevision:b.revision})).status,409);
    assert.equal(h.sqlite.prepare("SELECT system_id FROM gdr_workspace_adventures WHERE id='story-a'").get().system_id,'sys-a');
    const current=await getSystem(h,'sys-a'),batch=h.db.batch.bind(h.db);
    h.db.batch=async statements=>{h.sqlite.exec("UPDATE gdr_systems SET revision=revision+1 WHERE id='sys-a'");return batch(statements);};
    assert.equal((await h.resource('systems','POST',{...current,action:'saveSystem',ruleIds:[]})).status,409);
    assert.equal(h.sqlite.prepare("SELECT rule_id FROM gdr_system_rules WHERE system_id='sys-a'").get().rule_id,'rule-a');
  }finally{h.sqlite.close();}
});

test('punti: il totale del sistema si eredita, le personalizzazioni del master restano personali',async()=>{
  const h=systemsHarness();try{
    await save(h,system());await adventure(h,'story-a','sys-a');await character(h);
    let s=await getSystem(h,'sys-a');await save(h,{...s,action:'saveSystem',statBudget:6});
    let c=(await(await h.call(1,'GET',undefined,'story-a')).json()).characters[0];assert.equal(c.statsBudget,6);
    await mutate(h.db,master,{action:'setStatAccess',characterId:c.id,revision:c.revision,editable:true,budget:5});
    s=await getSystem(h,'sys-a');await save(h,{...s,action:'saveSystem',statBudget:4});
    c=(await(await h.call(1,'GET',undefined,'story-a')).json()).characters[0];assert.equal(c.statsBudget,5);
  }finally{h.sqlite.close();}
});

test('cambio di scheda o sistema invalida gli editor dei personaggi già aperti',async()=>{
  const h=systemsHarness();try{
    await save(h,system());await adventure(h,'story-a','sys-a');await character(h);
    const original=revision(h,'pg'),s=await getSystem(h,'sys-a');
    await save(h,{...s,action:'saveSystem',fields:s.fields.map(f=>f.key==='hp'?{...f,max:12}:f)});
    assert.equal(revision(h,'pg'),original+1);
    await assert.rejects(()=>mutate(h.db,master,{action:'adjustResource',characterId:'pg',revision:original,fieldKey:'hp',delta:-1}),e=>e.status===409);
    await save(h,system('sys-b'));const b=await getSystem(h,'sys-b'),a=h.sqlite.prepare("SELECT revision FROM gdr_workspace_adventures WHERE id='story-a'").get();
    await save(h,{action:'assignSystem',id:'story-a',revision:a.revision,systemId:b.id,systemRevision:b.revision});
    assert.equal(revision(h,'pg'),original+2);
  }finally{h.sqlite.close();}
});
