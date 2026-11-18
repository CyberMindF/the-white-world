import {readFileSync} from 'node:fs';
import {apiHarness} from './gdr-workspace-test-harness.mjs';
const source=path=>readFileSync(path,'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
export function systemsHarness(options={}){
  const h=apiHarness({linkedSystems:true,...options}),events=[];
  const json=(data,status=200)=>Response.json(data,{status});
  const helpers=new Function('json','hasPermission',source('functions/api/gdr-workspace/_shared.js')+';return {WorkspaceError,isMaster,validId,text,failure};')(json,role=>role==='admin');
  const normalize=new Function(source('functions/api/gdr-blocks/_shared.js')+';return {normalizeType,normalizeData};')();
  const session=async request=>{
    const id=Number(request.headers.get('x-user')??1);
    return id?{user:{id,role:id===1?'admin':'member',isTest:request.headers.has('x-test'),safeMode:request.headers.has('x-safe')},adminModeEnabled:!request.headers.has('x-no-admin')}:null;
  };
  const recordEvent=async()=>{};
  const notifyRealtime=async(env,event)=>events.push(event);
  const catalog=new Function('getAuthenticatedSession','json','readJson',...Object.keys(helpers),...Object.keys(normalize),'recordEvent','notifyRealtime',source('functions/api/gdr-powers/index.js')+';return {onRequestGet,onRequestPost,masterSession,referenceBlocks};')(
    session,json,request=>request.json(),...Object.values(helpers),...Object.values(normalize),recordEvent,notifyRealtime,
  );
  const systemHelpers=new Function('WorkspaceError','notifyRealtime',source('functions/api/gdr-systems/_shared.js')+';return {systemFields,assertCompatibleFields,notifySystemChange};')(helpers.WorkspaceError,notifyRealtime);
  const systems=new Function('json','readJson','masterSession','referenceBlocks',...Object.keys(helpers),...Object.keys(systemHelpers),'recordEvent',source('functions/api/gdr-systems/index.js')+';return {onRequestGet,onRequestPost};')(
    json,request=>request.json(),catalog.masterSession,catalog.referenceBlocks,...Object.values(helpers),...Object.values(systemHelpers),recordEvent,
  );
  const assignments=new Function('json','readJson','masterSession',...Object.keys(helpers),'recordEvent','notifyRealtime',source('functions/api/gdr-powers/assignments.js')+';return onRequestPut;')(
    json,request=>request.json(),catalog.masterSession,...Object.values(helpers),recordEvent,notifyRealtime,
  );
  const call=async(resource='systems',method='GET',body,user=1,headers={})=>{
    const pending=[],fn=resource==='systems'?systems['onRequest'+(method==='GET'?'Get':'Post')]:resource==='powers'?catalog['onRequest'+(method==='GET'?'Get':'Post')]:assignments;
    const response=await fn({env:{DB:h.db},waitUntil:p=>pending.push(p),request:new Request('https://test/api/gdr-'+resource,{method,headers:{'x-user':String(user),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})});
    await Promise.all(pending);return response;
  };
  return {...h,resource:call,events};
}
