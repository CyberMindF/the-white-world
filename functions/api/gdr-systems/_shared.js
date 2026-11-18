import { notifyRealtime } from '../_shared/realtime.js';
import { WorkspaceError } from '../gdr-workspace/_shared.js';

export function systemFields(value) {
  if (!Array.isArray(value) || value.length > 100 || JSON.stringify(value).length > 20000)
    throw new WorkspaceError('La scheda può contenere al massimo 100 campi.',400);
  const keys=new Set();
  return value.map(field=>{
    if (!field || typeof field.key!=='string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(field.key) ||
        ['__proto__','constructor','prototype'].includes(field.key) || keys.has(field.key) ||
        typeof field.label!=='string' || !field.label.trim() || field.label.length>160 ||
        !['text','number'].includes(field.type) || !['field','stat','resource'].includes(field.role ?? 'field'))
      throw new WorkspaceError('Controlla nomi, etichette e tipi dei campi della scheda.',400);
    keys.add(field.key);
    const role=field.role ?? 'field';
    if (role!=='field' && field.type!=='number') throw new WorkspaceError('Caratteristiche e risorse devono essere numeri.',400);
    const result={key:field.key,label:field.label.trim(),type:field.type,role,long:field.long===true};
    if(field.type==='number'){
      if(!Number.isSafeInteger(field.min)||!Number.isSafeInteger(field.max)||field.min>field.max||Math.abs(field.min)>99999||Math.abs(field.max)>99999)
        throw new WorkspaceError('Controlla i limiti numerici della scheda.',400);
      const number=Number(field.default ?? field.min);
      if(!Number.isSafeInteger(number)||number<field.min||number>field.max)throw new WorkspaceError('Valore iniziale fuori dai limiti.',400);
      Object.assign(result,{min:field.min,max:field.max,default:number});
    } else {
      if(typeof (field.default ?? '')!=='string'||(field.default ?? '').length>4000)throw new WorkspaceError('Valore iniziale non valido.',400);
      result.default=field.default ?? '';
    }
    return result;
  });
}
export function statFields(fields) {
  return fields.filter(f=>f.type==='number' && (f.role==='stat' || (f.role===undefined && ['statMente','statCuore','statCorpo','statMagia'].includes(f.key))));
}
export function assertCompatibleFields(fields, characters, statBudget) {
  for(const c of characters){
    const values=JSON.parse(c.fields_json);
    const stats=statFields(fields),budget=c.stat_budget_override?c.stats_budget:statBudget;
    if(stats.length && budget!==undefined && (stats.reduce((n,f)=>n+f.min,0)>budget || stats.reduce((n,f)=>n+f.max,0)<budget))
      throw new WorkspaceError(`I punti personalizzati di «${c.name}» non sono compatibili con le caratteristiche del sistema.`,409);
    for(const field of fields){
      if(field.type!=='number' || values[field.key]===undefined)continue;
      const value=Number(values[field.key]);
      if(!String(values[field.key]).trim()||!Number.isSafeInteger(value)||value<field.min||value>field.max)
        throw new WorkspaceError(`Il campo «${field.label}» non è compatibile con i valori di «${c.name}». Adegua i valori o i limiti prima di cambiare la scheda.`,409);
    }
  }
}
export async function notifySystemChange(context,systemIds,action='system_updated') {
  const ids=[...new Set(systemIds)];
  if(!ids.length)return;
  const rows=(await context.env.DB.prepare('SELECT id FROM gdr_workspace_adventures WHERE system_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results;
  await Promise.all(rows.map(a=>notifyRealtime(context.env,{type:'gdr-story:changed',action,adventure:a.id})));
}
