import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const loadSource = file => readFileSync(new URL('../functions/api/gdr-workspace/'+file,import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
const permissions=new Function(loadSource('../_shared/permissions.js')+';return {hasPermission};')();
const helpers=new Function('json','hasPermission',loadSource('./_shared.js')+';return {WorkspaceError,requireMaster,isMaster,validId,text,portrait,inventory,profile,readLimited,failure,characterView};')((body,status=200)=>Response.json(body,{status}),permissions.hasPermission);
export const {characterView}=helpers;
const legacy=new Function('WorkspaceError',loadSource('./legacy.js')+';return {syncLegacy,characterFields,validateCharacterFields};')(helpers.WorkspaceError);
export const mutate=new Function(...Object.keys(legacy),...Object.keys(helpers),loadSource('./mutate.js')+';return mutate;')(...Object.values(legacy),...Object.values(helpers));

export function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,nickname TEXT,is_test INTEGER DEFAULT 0); INSERT INTO users VALUES(1,\'Master\',0),(2,\'Giocatrice\',0),(3,\'Altra persona\',0); CREATE TABLE gdr_turns(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO gdr_turns VALUES(1,\'Turno originale\');');
  sqlite.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'; UPDATE users SET role='admin' WHERE id=1;");
  sqlite.exec(readFileSync(new URL('../migrations/0133_add_gdr_workspace.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0134_add_gdr_character_profiles.sql',import.meta.url),'utf8'));
  sqlite.exec("CREATE TABLE gdr_character_schema(adventure TEXT PRIMARY KEY,fields_json TEXT); CREATE TABLE gdr_character_fields(adventure TEXT,field_key TEXT,value TEXT); CREATE TABLE gdr_blocks(id INTEGER PRIMARY KEY,document_key TEXT,type TEXT,data TEXT,position INTEGER);");
  sqlite.exec(readFileSync(new URL('../migrations/0145_unify_gdr_character_sheets.sql',import.meta.url),'utf8'));
  const db={async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},withSession(){return this;},prepare(sql){return{bind(...values){return{async run(){const r=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(r.changes)}};},async first(){return sqlite.prepare(sql).get(...values) ?? null;},async all(){return{results:sqlite.prepare(sql).all(...values)};}};},async all(){return{results:sqlite.prepare(sql).all()};}};}};
  return {sqlite,db};
}

export function apiHarness() {
  const {db,sqlite}=fixture();
  const session=async request=>{const id=Number(request.headers.get('x-user') || 1);return id?{user:{id,nickname:id===1?'Master':'Giocatrice',role:id===1?'admin':'member',isTest:request.headers.has('x-test')}}:null;};
  const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const get=new Function('getAuthenticatedSession','json',...Object.keys(helpers),loadSource('./index.js')+';return onRequestGet;')(session,json,...Object.values(helpers));
  const post=new Function('getAuthenticatedSession','json',...Object.keys(legacy),...Object.keys(helpers),loadSource('./mutate.js')+';return onRequestPost;')(session,json,...Object.values(legacy),...Object.values(helpers));
  const call=(user=1,method='GET',body,adventure='il-prezzo-della-verita',extra={})=>(method==='GET'?get:post)({env:{DB:db},request:new Request('https://test/api/gdr-workspace?adventure='+adventure,{method,headers:{'x-user':String(user),...extra},body:body===undefined?undefined:JSON.stringify(body)})});
  const media=new Map();
  const bucket={async put(key,data,options){media.set(key,{data:new Uint8Array(data),type:options.httpMetadata.contentType});}};
  const mediaPost=new Function('getAuthenticatedSession','json',...Object.keys(helpers),loadSource('./media.js')+';return onRequestPost;')(session,json,...Object.values(helpers));
  const upload=(user,characterId,slot,body,extra={})=>mediaPost({env:{DB:db,MEDIA:bucket},request:new Request(`https://test/api/gdr-workspace/media?character=${characterId}&slot=${slot}`,{method:'POST',headers:{'x-user':String(user),'Content-Type':'image/webp',...extra},body})});
  const oldGet=new Function('getAuthenticatedSession','json',...Object.keys(helpers),loadSource('../gdr/character-fields.js')+';return onRequestGet;')(session,json,...Object.values(helpers));
  const oldPost=new Function('getAuthenticatedSession','json',...Object.keys(helpers),loadSource('../gdr/character-fields.js')+';return onRequestPost;')(session,json,...Object.values(helpers));
  const oldFields=(user,key,value)=>{const form=new FormData();form.set('adventure','il-prezzo-della-verita');if(key){form.set('fieldKey',key);form.set('value',value);}return (key?oldPost:oldGet)({env:{DB:db},request:new Request('https://test/api/gdr/character-fields?adventure=il-prezzo-della-verita',{method:key?'POST':'GET',headers:{'x-user':String(user)},...(key?{body:form}:{})})});};
  return {db,sqlite,call,upload,media,oldFields};
}
