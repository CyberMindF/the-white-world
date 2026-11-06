import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Only explicit, closed narrative blocks are candidates. Prose is never interpreted.
export function resolveLegacyCharacter(roster,name,image='',npc=false) {
 const candidates=roster.filter(c=>!npc||c.kind==='png');
 const norm=s=>s.trim().toLocaleLowerCase('it');
 const n=norm(name);
 const exact=candidates.filter(c=>norm(c.name)===n||norm([c.name,c.surname].filter(Boolean).join(' '))===n);
 if(exact.length===1)return exact[0];
 const pictures=candidates.filter(c=>image&&(npc?c.photo:c.portrait)===image);
 if(pictures.length===1&&(!exact.length||exact.includes(pictures[0])))return pictures[0];
 if(exact.length)return;
 const prefix=candidates.filter(c=>n&&norm(c.name).startsWith(n+' '));
 if(prefix.length===1)return prefix[0];
}
export function linkSource(source,roster,report=[]) {
 return source.replace(/^::: (dialogo|npc(?: full)?|callout)([^\r\n]*)(\r?\n)([\s\S]*?)^:::[ \t]*(?=\r?$)/gm,(whole,type,header,nl,body)=>{
  if(type==='callout')return whole;
  if(type==='dialogo') {
   const [name='',portrait='',id='']=header.trim().split('|').map(v=>v.trim());
   if(id)return whole;
   const c=resolveLegacyCharacter(roster,name,portrait);
   report.push({type,name,id:c?.id??null});
   return c?whole.replace(/^(::: dialogo)[^\r\n]*/,`$1 ${name} | ${portrait} | ${c.id}`):whole;
  }
  return whole.replace(/^-\s*image:[^\r\n]*(?:\r?\n(?!- |:::)[^\r\n]*)*/gm,entry=>{
   if(/^\s*characterId:/m.test(entry))return entry;
   const field=k=>entry.match(new RegExp('^\\s*(?:-\\s*)?'+k+':[ \\t]*(.*)$','m'))?.[1].trim()??'';
   const c=resolveLegacyCharacter(roster,field('name'),field('image'),true);
   report.push({type:'npc',name:field('name'),id:c?.id??null});
   return c?entry.replace(/(?:\r?\n)*$/,`${nl}  characterId: ${c.id}${entry.endsWith(nl)?nl:''}`):entry;
  });
 });
}
export function plan(snapshot) {
 const rows=Object.fromEntries(snapshot[0].results.map(r=>[r.kind,JSON.parse(r.data)]));
 const changes=[],report=[];
 const roster=a=>rows.characters.filter(c=>c.adventure===a);
 const add=(table,column,row,before,after)=>{if(before!==after)changes.push({table,column,id:row.id,before,after});};
 for(const row of rows.turns)add('gdr_turns','body',row,row.body,linkSource(row.body,roster(row.adventure),report));
 for(const row of rows.adventures)add('gdr_workspace_adventures','source',row,row.source,linkSource(row.source,roster(row.id),report));
 for(const row of rows.blocks) {
  const adventure=row.document.startsWith('casa-')?'la-casa-che-trattiene-il-respiro':'il-prezzo-della-verita';
  const data=JSON.parse(row.data),before=JSON.stringify(data);
  if(row.type==='paragraph'&&data.format==='gdr-narrative')data.text=linkSource(data.text,roster(adventure),report);
  if(row.type==='npc_grid')for(const entry of data.entries) {
   if(entry.characterId)continue;
   const c=resolveLegacyCharacter(roster(adventure),entry.name,entry.image,true);
   report.push({type:'npc_grid',name:entry.name,id:c?.id??null});
   if(c)entry.characterId=c.id;
  }
  if(before!==JSON.stringify(data))add('gdr_blocks','data',row,row.data,JSON.stringify(data));
 }
 return {changes,report};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const result=plan(JSON.parse(readFileSync(process.argv[2],'utf8')));
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 writeFileSync(process.argv[3],result.changes.map(c=>`UPDATE ${c.table} SET ${c.column}=${quote(c.after)} WHERE id=${quote(c.id)} AND ${c.column}=${quote(c.before)};`).join('\n')+'\n');
 writeFileSync(process.argv[3]+'.audit.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({changedRows:result.changes.length,blocks:result.report},null,2));
}
