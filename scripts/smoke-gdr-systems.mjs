// API reali, browser locale e database in memoria. Nessun accesso a partite reali.
import {systemsHarness} from './gdr-systems-test-harness.mjs';
import {mutate} from './gdr-workspace-test-harness.mjs';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import assert from 'node:assert/strict';
const h=systemsHarness(),root=resolve('web/dist/web/browser'),master={id:1,role:'admin',isTest:false};
let user=1;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://test'),path=url.pathname;let body;
    if(!['GET','HEAD'].includes(req.method)){let raw='';for await(const chunk of req)raw+=chunk;body=raw?JSON.parse(raw):{};}
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    let response;
    if(path==='/api/gdr-systems')response=await h.resource('systems',req.method,body,user);
    else if(path==='/api/gdr-powers')response=await h.resource('powers',req.method,body,user);
    else if(path==='/api/gdr-powers/assignments')response=await h.resource('assignments',req.method,body,user);
    else if(path==='/api/gdr-workspace'||path==='/api/gdr-workspace/mutate')response=await h.call(user,req.method,body,url.searchParams.get('adventure')||'il-prezzo-della-verita');
    if(response){res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;}
    if(path.startsWith('/api/')){
      json(path==='/api/auth/session'?{authenticated:true,adminModeEnabled:user===1,user:{id:user,nickname:user===1?'Master':'Giocatrice',identity:user===1?'lui':'lei',role:user===1?'admin':'member',safeMode:false,isTest:false}}
        :path==='/api/world-settings'?{settings:{},values:{theme:'white-world'}}
        :path==='/api/realtime'?{enabled:false}
        :path==='/api/gdr-blocks'?{blocks:[]}
        :path==='/api/gdr/character-schema'?{fields:JSON.parse(h.sqlite.prepare('SELECT fields_json FROM gdr_adventure_schema WHERE adventure=?').get(url.searchParams.get('adventure'))?.fields_json||'[]')}
        :path==='/api/gdr/character-fields'?{values:{}}
        :path==='/api/gdr/turns'?{turns:[]}
        :path==='/api/ponti-chat'?{messages:[],unreadCount:0}
        :path==='/api/world-updates'?{updates:[]}:{});return;
    }
    let file=join(root,path),data;try{data=await readFile(file);}catch{file=join(root,'index.html');data=await readFile(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
const data=async()=>await(await h.resource()).json();
try{
  for(const width of [1280,390,320]){
    user=1;const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
    await page.addInitScript(()=>{sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));});
    try{
      await page.goto(base+'/tavolo-da-gioco/gdr/gestione');
      const managementNav=page.getByRole('navigation',{name:'Gestione GDR',exact:true});
      await managementNav.getByRole('link',{name:'Avventure',exact:true}).waitFor();
      assert.deepEqual(await managementNav.getByRole('link').allTextContents(),['Avventure','Sistemi','Regole','Abilità e magie']);
      assert.equal(await page.locator('.tavolo-hero,app-editorial-text').count(),0);
      assert.ok((await page.getByRole('heading',{name:'Gestione GDR',exact:true}).boundingBox()).height<60);
      await page.locator('.adventure-row').first().waitFor();
      await page.screenshot({path:`/tmp/gdr-management-hub-${width}.png`,fullPage:true});
      await managementNav.getByRole('link',{name:'Regole',exact:true}).click();
      await page.getByRole('button',{name:'+ Nuova regola',exact:true}).click();
      await page.getByLabel('Nome della regola',{exact:true}).fill('Regola condivisa '+width);
      await page.getByLabel('Contenuto della regola',{exact:true}).fill('## Prova\n\nTira un dado per riuscire.');
      const selectedSystems=(await data()).systems.slice(0,2);
      const systemChoices=page.getByRole('group',{name:'Sistemi che usano questa regola',exact:true});
      for(const s of selectedSystems)await systemChoices.getByRole('checkbox',{name:s.name,exact:true}).check();
      await page.getByRole('button',{name:'Salva regola',exact:true}).click();await page.getByRole('status').filter({hasText:'Regola salvata.'}).waitFor();
      const sharedRule=(await data()).rules.find(r=>r.title==='Regola condivisa '+width);
      assert.deepEqual([...sharedRule.systemIds].sort(),selectedSystems.map(s=>s.id).sort());
      await page.reload();
      await page.locator('.systems-list .list-entry').filter({hasText:'Regola condivisa '+width}).click();
      for(const s of selectedSystems)assert.equal(await systemChoices.getByRole('checkbox',{name:s.name,exact:true}).isChecked(),true);
      await systemChoices.getByRole('checkbox',{name:selectedSystems[0].name,exact:true}).uncheck();
      await page.getByRole('button',{name:'Salva regola',exact:true}).click();await page.getByRole('status').filter({hasText:'Regola salvata.'}).waitFor();
      assert.deepEqual((await data()).rules.find(r=>r.id===sharedRule.id).systemIds,[selectedSystems[1].id]);
      await page.screenshot({path:`/tmp/gdr-rule-systems-${width}.png`,fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await managementNav.getByRole('link',{name:'Sistemi',exact:true}).click();
      await page.getByRole('button',{name:'+ Nuovo sistema',exact:true}).click();
      await page.getByLabel('Nome del sistema',{exact:true}).fill('Sistema A '+width);
      await page.getByRole('button',{name:'Scheda del personaggio',exact:true}).click();
      await page.getByRole('button',{name:'+ Campo della scheda',exact:true}).click();
      const field=page.locator('.field-card').last();await field.getByLabel('Nome del campo',{exact:true}).fill('Energia');await field.getByLabel('Tipo',{exact:true}).selectOption('number');await field.getByLabel('Uso',{exact:true}).selectOption('resource');await field.getByLabel('Valore iniziale',{exact:true}).fill('6');
      await page.getByRole('button',{name:/^Regole ·/}).click();
      await page.getByRole('button',{name:'Usa Regola condivisa '+width,exact:true}).click();
      await page.getByRole('button',{name:'Salva sistema',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Sistema salvato.'}).waitFor();
      let a=(await data()).systems.find(s=>s.name==='Sistema A '+width);assert.equal(a.fields[0].role,'resource');assert.equal(a.ruleIds.length,1);
      await page.getByRole('button',{name:'Copia sistema',exact:true}).click();
      await page.getByLabel('Nome del sistema',{exact:true}).fill('Sistema B '+width);
      await page.getByRole('button',{name:'Salva sistema',exact:true}).click();await page.getByRole('status').filter({hasText:'Sistema salvato.'}).waitFor();
      let b=(await data()).systems.find(s=>s.name==='Sistema B '+width);assert.deepEqual(b.ruleIds,a.ruleIds);
      await page.getByRole('link',{name:'Modifica nella libreria',exact:true}).click();
      assert.ok(page.url().includes('/gestione/regole'));
      assert.equal(await managementNav.getByRole('link',{name:'Regole',exact:true}).getAttribute('aria-current'),'page');
      await page.getByLabel('Contenuto della regola',{exact:true}).fill('Una regola aggiornata per tutti '+width+'.');
      await page.getByRole('button',{name:'Salva regola',exact:true}).click();await page.getByRole('status').filter({hasText:'Regola salvata.'}).waitFor();
      assert.ok((await data()).rules.find(r=>r.id===a.ruleIds[0]).blocks[0].data.text.includes('aggiornata per tutti'));
      await page.getByRole('button',{name:'Crea copia indipendente',exact:true}).click();
      await page.getByLabel('Nome della regola',{exact:true}).fill('Regola indipendente '+width);
      await page.getByLabel('Contenuto della regola',{exact:true}).fill('Solo per il sistema B.');
      await page.getByRole('button',{name:'Salva regola',exact:true}).click();await page.getByRole('status').filter({hasText:'Regola salvata.'}).waitFor();
      const independentRule=(await data()).rules.find(r=>r.title==='Regola indipendente '+width);
      await managementNav.getByRole('link',{name:'Sistemi',exact:true}).click();
      await page.getByLabel('Nome del sistema',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Nome del sistema',{exact:true}).inputValue(),'Sistema B '+width);
      await page.locator('.systems-list .list-entry').filter({hasText:'Sistema B '+width}).click();
      await page.getByRole('button',{name:'Rimuovi Regola condivisa '+width+' dal sistema',exact:true}).click();
      await page.getByRole('button',{name:'Usa '+independentRule.title,exact:true}).click();
      await page.getByRole('button',{name:'Salva sistema',exact:true}).click();await page.getByRole('status').filter({hasText:'Sistema salvato.'}).waitFor();
      b=(await data()).systems.find(s=>s.id===b.id);assert.equal(b.ruleIds.length,1);assert.notEqual(b.ruleIds[0],a.ruleIds[0]);
      await page.screenshot({path:`/tmp/gdr-system-editor-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.goto(base+'/tavolo-da-gioco/gdr/gestione');
      await page.getByRole('button',{name:'Nuova avventura',exact:true}).click();await page.getByLabel('Titolo della nuova avventura',{exact:true}).fill('Partita '+width);await page.getByLabel('Sistema di gioco',{exact:true}).selectOption(a.id);await page.getByRole('button',{name:'Crea avventura',exact:true}).click();
      await page.waitForURL(url=>/\/gestione\/[a-f0-9-]{36}$/.test(url.pathname));
      await page.getByRole('heading',{name:'Partita '+width,exact:true,level:2}).waitFor();const adventureId=new URL(page.url()).pathname.split('/').pop();
      await page.getByRole('button',{name:'+ PG',exact:true}).click();
      await page.getByLabel('Avventura del personaggio',{exact:true}).selectOption(adventureId);await page.getByText('Sistema ereditato · Sistema A '+width,{exact:true}).waitFor();
      await page.getByLabel('Nome completo · facoltativo',{exact:true}).fill('Ada '+width);await page.getByRole('button',{name:'Crea PG',exact:true}).click();
      await page.getByRole('heading',{name:'Ada '+width,exact:true}).waitFor();await page.locator('.manager-tabs').getByRole('button',{name:'Scheda',exact:true}).click();
      await page.getByRole('button',{name:'Riduci Energia',exact:true}).click();
      const pg=h.sqlite.prepare('SELECT * FROM gdr_workspace_characters WHERE adventure_id=? AND kind=\'pg\'').get(adventureId);
      await page.waitForFunction(()=>document.querySelector('.resource strong')?.textContent==='5');
      assert.equal(JSON.parse(h.sqlite.prepare('SELECT fields_json FROM gdr_workspace_characters WHERE id=?').get(pg.id).fields_json)[a.fields[0].key],'5');
      await page.getByRole('combobox',{name:'Sistema dell’avventura',exact:true}).selectOption(b.id);
      assert.equal(await page.getByRole('button',{name:'Modifica scheda',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Applica sistema all’avventura',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Sistema aggiornato.'}).waitFor();
      assert.equal(JSON.parse(h.sqlite.prepare('SELECT fields_json FROM gdr_workspace_characters WHERE id=?').get(pg.id).fields_json)[a.fields[0].key],'5');
      await page.screenshot({path:`/tmp/gdr-systems-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await mutate(h.db,master,{action:'grant',characterId:pg.id,revision:h.sqlite.prepare('SELECT revision FROM gdr_workspace_characters WHERE id=?').get(pg.id).revision,userId:2,canSpeak:true,canEditSheet:true,canInventory:false});
      h.sqlite.prepare('UPDATE gdr_workspace_adventures SET published=1 WHERE id=?').run(adventureId);
      for(const [id,name,components] of [['spell-'+width,'Magia con componenti '+width,'VS'],['empty-spell-'+width,'Magia senza componenti '+width,'']]){
        const created=await h.resource('powers','POST',{id,name,kind:'spell',description:'Componenti condivise nella scheda.',effects:[],components,revision:null,systemIds:[b.id]});
        assert.equal(created.status,201);
      }
      assert.equal((await h.resource('assignments','PUT',{characterId:pg.id,revision:h.sqlite.prepare('SELECT revision FROM gdr_workspace_characters WHERE id=?').get(pg.id).revision,powerIds:['spell-'+width,'empty-spell-'+width]})).status,200);
      user=2;await page.evaluate(()=>sessionStorage.setItem('gdr-test-user','2'));await page.goto(base+'/tavolo-da-gioco/gdr/gioca/'+adventureId);
      await page.getByRole('button',{name:'Scheda',exact:true}).click();
      await page.getByRole('tab',{name:/Regole/}).click();await page.getByText('Solo per il sistema B.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Gestisci sistema'}).count(),0);
      await page.getByRole('tab',{name:/Personaggio/}).click();await page.getByRole('button',{name:'Riduci Energia',exact:true}).waitFor();
      await page.getByRole('tab',{name:/Abilità e incantesimi/}).click();
      const spell=page.locator('app-gdr-powers .catalog-power').filter({hasText:'Magia con componenti '+width});
      await spell.locator('abbr').waitFor();assert.equal(await spell.locator('abbr').innerText(),'VS');
      assert.equal(await page.locator('app-gdr-powers .catalog-power').filter({hasText:'Magia senza componenti '+width}).locator('abbr').count(),0);
      await page.screenshot({path:`/tmp/gdr-spell-components-sheet-${width}.png`,fullPage:true});
      assert.deepEqual(errors,[]);
    }catch(error){await page.screenshot({path:`/tmp/gdr-systems-error-${width}.png`,fullPage:true});console.error('Browser errors',errors);throw error;}finally{await context.close();}
  }
  console.log('PASS sistemi: creazione/copia, regole condivise e indipendenti, campo risorsa, nuova avventura, PG, cambio sistema senza perdita dei valori e scheda giocatrice a 1280/390/320px.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.sqlite.close();}
