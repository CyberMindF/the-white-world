import {json,readJson} from '../auth/_shared.js';
import {masterSession,referenceBlocks} from '../gdr-powers/index.js';
import {validId,text,WorkspaceError,failure} from '../gdr-workspace/_shared.js';
import {systemFields,assertCompatibleFields,notifySystemChange} from './_shared.js';
import {recordEvent} from '../_shared/events.js';

const ids=value=>{
  if(!Array.isArray(value)||value.length>200||value.some(id=>!validId(id))||new Set(value).size!==value.length)
    throw new WorkspaceError('Selezione non valida.',400);
  return value;
};
const conflict=()=>new WorkspaceError('I dati sono cambiati. Ricarica prima di salvare; la bozza resta disponibile.',409);
const snapshotGuard=`NOT EXISTS(SELECT 1 FROM gdr_workspace_characters c JOIN gdr_workspace_adventures a ON a.id=c.adventure_id
  WHERE a.system_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.id')=c.id AND json_extract(j.value,'$.revision')=c.revision))`;
export const blocksOf=rule=>rule.type==='document' ? JSON.parse(rule.data_json) : [{type:rule.type,data:JSON.parse(rule.data_json)}];

export async function onRequestGet(context){
  try{
    await masterSession(context);
    const db=context.env.DB.withSession('first-primary');
    const [systems,rules,links,powers,powerLinks,adventures]=await Promise.all([
      db.prepare('SELECT * FROM gdr_systems ORDER BY name COLLATE NOCASE,id').all(),
      db.prepare('SELECT * FROM gdr_rule_blocks ORDER BY title COLLATE NOCASE,id').all(),
      db.prepare('SELECT * FROM gdr_system_rules ORDER BY position,rule_id').all(),
      db.prepare('SELECT id,name,kind,description FROM gdr_powers ORDER BY kind,name COLLATE NOCASE,id').all(),
      db.prepare('SELECT * FROM gdr_system_powers').all(),
      db.prepare('SELECT id,title,system_id,revision FROM gdr_workspace_adventures ORDER BY title').all(),
    ]);
    return json({
      systems:systems.results.map(s=>({id:s.id,name:s.name,description:s.description,fields:JSON.parse(s.fields_json),statBudget:s.stat_budget,revision:s.revision,
        ruleIds:links.results.filter(l=>l.system_id===s.id).map(l=>l.rule_id),powerIds:powerLinks.results.filter(l=>l.system_id===s.id).map(l=>l.power_id),
        adventureIds:adventures.results.filter(a=>a.system_id===s.id).map(a=>a.id)})),
      rules:rules.results.map(r=>({id:r.id,title:r.title,blocks:blocksOf(r),revision:r.revision,systemIds:links.results.filter(l=>l.rule_id===r.id).map(l=>l.system_id)})),
      powers:powers.results,adventures:adventures.results.map(a=>({id:a.id,title:a.title,systemId:a.system_id,revision:a.revision})),
    });
  }catch(error){return failure(error,'gdr_systems_get_error');}
}

export async function onRequestPost(context){
  try{
    const session=await masterSession(context),p=await readJson(context.request),db=context.env.DB.withSession('first-primary');
    if(!p||!validId(p.id))throw new WorkspaceError('Identificativo non valido.',400);
    let affected=[];
    if(p.action==='saveRule'){
      const title=text(p.title,160).trim(),blocks=referenceBlocks(p.blocks);
      if(!blocks.length)throw new WorkspaceError('Scrivi almeno un blocco per la regola.',400);
      if(p.revision===null){
        const result=await db.prepare("INSERT INTO gdr_rule_blocks(id,title,type,data_json,created_by) VALUES(?,?,'document',?,?) ON CONFLICT(id) DO NOTHING").bind(p.id,title,JSON.stringify(blocks),session.user.id).run();
        if(!result.meta.changes)throw conflict();
      }else{
        if(!Number.isSafeInteger(p.revision))throw conflict();
        const result=await db.prepare("UPDATE gdr_rule_blocks SET title=?,type='document',data_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?").bind(title,JSON.stringify(blocks),new Date().toISOString(),p.id,p.revision).run();
        if(!result.meta.changes)throw conflict();
      }
      affected=(await db.prepare('SELECT system_id FROM gdr_system_rules WHERE rule_id=?').bind(p.id).all()).results.map(r=>r.system_id);
    }else if(p.action==='saveSystem'){
      const name=text(p.name,160).trim(),description=text(p.description??'',6000,true),fields=systemFields(p.fields),ruleIds=ids(p.ruleIds),powerIds=ids(p.powerIds);
      if(!Number.isSafeInteger(p.statBudget)||p.statBudget<4||p.statBudget>20)throw new WorkspaceError('Usa un totale da 4 a 20 punti.',400);
      const stats=fields.filter(f=>f.role==='stat');
      if(stats.length && (stats.reduce((n,f)=>n+f.min,0)>p.statBudget||stats.reduce((n,f)=>n+f.max,0)<p.statBudget))
        throw new WorkspaceError('Il totale dei punti deve essere distribuibile tra le caratteristiche.',400);
      const previous=await db.prepare('SELECT * FROM gdr_systems WHERE id=?').bind(p.id).first();
      const creating=p.revision===null;
      if(creating?!!previous:(!Number.isSafeInteger(p.revision)||previous?.revision!==p.revision))throw conflict();
      const existingRules=(await db.prepare('SELECT id FROM gdr_rule_blocks WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(ruleIds)).all()).results;
      const existingPowers=(await db.prepare('SELECT id FROM gdr_powers WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(powerIds)).all()).results;
      if(existingRules.length!==ruleIds.length||existingPowers.length!==powerIds.length)throw new WorkspaceError('Una delle voci selezionate non esiste più.',400);
      const chars=(await db.prepare('SELECT c.* FROM gdr_workspace_characters c JOIN gdr_workspace_adventures a ON a.id=c.adventure_id WHERE a.system_id=?').bind(p.id).all()).results;
      assertCompatibleFields(fields,chars,p.statBudget);
      const fieldsChanged=previous?.fields_json!==JSON.stringify(fields);
      const revision=creating?1:p.revision;
      const guard=`EXISTS(SELECT 1 FROM gdr_systems WHERE id=? AND revision=?)
        AND NOT EXISTS(SELECT 1 FROM gdr_character_powers cp JOIN gdr_workspace_characters c ON c.id=cp.character_id JOIN gdr_workspace_adventures a ON a.id=c.adventure_id
          WHERE a.system_id=? AND cp.power_id NOT IN(SELECT value FROM json_each(?)))`+(fieldsChanged?` AND ${snapshotGuard}`:'');
      const bindings=[p.id,revision,p.id,JSON.stringify(powerIds),...(fieldsChanged?[p.id,JSON.stringify(chars.map(c=>({id:c.id,revision:c.revision})))]:[])];
      const statements=[];
      if(creating)statements.push(db.prepare('INSERT INTO gdr_systems(id,name,description,fields_json,stat_budget,created_by) VALUES(?,?,?,?,?,?)').bind(p.id,name,description,JSON.stringify(fields),p.statBudget,session.user.id));
      statements.push(
        db.prepare(`DELETE FROM gdr_system_rules WHERE system_id=? AND ${guard}`).bind(p.id,...bindings),
        db.prepare(`INSERT INTO gdr_system_rules(system_id,rule_id,position) SELECT ?,value,CAST(key AS INTEGER) FROM json_each(?) WHERE ${guard}`).bind(p.id,JSON.stringify(ruleIds),...bindings),
        // Il catalogo dei poteri controlla la sua revisione anche se cambia la disponibilità dal sistema.
        db.prepare(`UPDATE gdr_powers SET revision=revision+1 WHERE id IN(SELECT power_id FROM gdr_system_powers WHERE system_id=? UNION SELECT value FROM json_each(?)) AND ${guard}`).bind(p.id,JSON.stringify(powerIds),...bindings),
        db.prepare(`DELETE FROM gdr_system_powers WHERE system_id=? AND ${guard}`).bind(p.id,...bindings),
        db.prepare(`INSERT INTO gdr_system_powers(system_id,power_id) SELECT ?,value FROM json_each(?) WHERE ${guard}`).bind(p.id,JSON.stringify(powerIds),...bindings),
        db.prepare(`UPDATE gdr_systems SET name=?,description=?,fields_json=?,stat_budget=?,revision=revision+1,updated_at=? WHERE id=? AND ${guard}`).bind(name,description,JSON.stringify(fields),p.statBudget,new Date().toISOString(),p.id,...bindings),
      );
      const results=await db.batch(statements);
      if(!results.at(-1).meta.changes)throw new WorkspaceError('Il sistema o le assegnazioni sono cambiati. Prima di togliere un potere, rimuovilo dai personaggi che lo usano. Ricarica per aggiornare i dati; la bozza resta disponibile.',409);
      affected=[p.id];
    }else if(p.action==='assignSystem'){
      if(!validId(p.systemId)||!Number.isSafeInteger(p.revision)||!Number.isSafeInteger(p.systemRevision))throw new WorkspaceError('Seleziona un sistema valido.',400);
      const target=await db.prepare('SELECT * FROM gdr_systems WHERE id=? AND revision=?').bind(p.systemId,p.systemRevision).first();
      if(!target)throw conflict();
      const chars=(await db.prepare('SELECT * FROM gdr_workspace_characters WHERE adventure_id=?').bind(p.id).all()).results;
      assertCompatibleFields(JSON.parse(target.fields_json),chars,target.stat_budget);
      const result=await db.prepare(`UPDATE gdr_workspace_adventures SET system_id=?,revision=revision+1 WHERE id=? AND revision=?
        AND EXISTS(SELECT 1 FROM gdr_systems WHERE id=? AND revision=?)
        AND NOT EXISTS(SELECT 1 FROM gdr_character_powers cp JOIN gdr_workspace_characters c ON c.id=cp.character_id WHERE c.adventure_id=?
          AND NOT EXISTS(SELECT 1 FROM gdr_system_powers sp WHERE sp.system_id=? AND sp.power_id=cp.power_id))
        AND NOT EXISTS(SELECT 1 FROM gdr_workspace_characters c WHERE c.adventure_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.id')=c.id AND json_extract(j.value,'$.revision')=c.revision))`)
        .bind(p.systemId,p.id,p.revision,p.systemId,p.systemRevision,p.id,p.systemId,p.id,JSON.stringify(chars.map(c=>({id:c.id,revision:c.revision})))).run();
      if(!result.meta.changes)throw new WorkspaceError('Non è stato possibile cambiare sistema: controlla che includa le abilità e magie dei personaggi e ricarica i dati aggiornati.',409);
      affected=[p.systemId];
    }else throw new WorkspaceError('Operazione non valida.',400);
    context.waitUntil(recordEvent(context.env,{userId:session.user.id,sessionId:session.sessionId},{section:'gdr',eventType:'content_updated',metadata:{resource:p.action,id:p.id}}));
    context.waitUntil(notifySystemChange(context,affected));
    return json({saved:true,id:p.id});
  }catch(error){return failure(error,'gdr_systems_save_error');}
}
