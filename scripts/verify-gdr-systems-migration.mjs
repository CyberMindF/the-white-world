// Verifica locale della migrazione su uno snapshot JSON prodotto da /tmp/cruciverba-systems-snapshot.sql.
// Lo snapshot contiene dati privati e resta fuori dal repository.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixture} from './gdr-workspace-test-harness.mjs';
const path=process.argv[2];if(!path)throw new Error('Passa il percorso dello snapshot JSON.');
const raw=readFileSync(path,'utf8');
const snapshot=JSON.parse(raw.slice(raw.indexOf('[')));
const tables=['gdr_workspace_adventures','gdr_character_schema','gdr_workspace_characters','gdr_powers','gdr_power_adventures','gdr_character_powers'];
const h=fixture({systems:false});
try{
  h.sqlite.exec('DELETE FROM gdr_character_powers;DELETE FROM gdr_power_adventures;DELETE FROM gdr_powers;DELETE FROM gdr_workspace_grants;DELETE FROM gdr_workspace_story_links;DELETE FROM gdr_workspace_characters;DELETE FROM gdr_workspace_adventures;DELETE FROM gdr_character_schema;');
  const insert=(table,rows)=>{
    if(table==='gdr_workspace_characters')rows=[...rows].sort((a,b)=>(a.kind==='pg'?0:1)-(b.kind==='pg'?0:1));
    for(const row of rows){
      for(const key of ['created_by','updated_by'])if(row[key])h.sqlite.prepare("INSERT OR IGNORE INTO users(id,nickname) VALUES(?,'Snapshot')").run(row[key]);
      const keys=Object.keys(row),known=h.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
      for(const key of keys)if(!known.includes(key)){assert.equal(table,'gdr_character_schema');assert.ok(['updated_by','updated_at'].includes(key));h.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${key} TEXT`);}
      h.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
    }
  };
  for(const [i,table]of tables.entries())insert(table,snapshot[i].results);
  const characters=JSON.stringify(h.sqlite.prepare('SELECT * FROM gdr_workspace_characters ORDER BY id').all());
  h.sqlite.exec(readFileSync('migrations/0163_add_gdr_systems.sql','utf8'));
  const after=h.sqlite.prepare('SELECT * FROM gdr_workspace_characters ORDER BY id').all().map(({stat_budget_override,...row})=>row);
  assert.equal(JSON.stringify(after),characters);
  for(const a of snapshot[0].results){
    const current=h.sqlite.prepare('SELECT * FROM gdr_workspace_adventures WHERE id=?').get(a.id),{system_id,...preserved}=current;
    assert.deepEqual(JSON.parse(JSON.stringify(preserved)),a);assert.equal(system_id,a.id);
    const rules=h.sqlite.prepare('SELECT r.type,r.data_json FROM gdr_system_rules sr JOIN gdr_rule_blocks r ON r.id=sr.rule_id WHERE sr.system_id=? ORDER BY sr.position,sr.rule_id').all(system_id).map(r=>({type:r.type,data:JSON.parse(r.data_json)}));
    assert.deepEqual(rules,JSON.parse(a.rules_json));
  }
  for(const [index,table]of [[3,'gdr_powers'],[4,'gdr_power_adventures'],[5,'gdr_character_powers']]){
    const current=h.sqlite.prepare(`SELECT * FROM ${table}`).all().map(r=>JSON.parse(JSON.stringify(r))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(current,[...snapshot[index].results].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  const availability=h.sqlite.prepare('SELECT * FROM gdr_power_availability ORDER BY power_id,adventure_id').all().map(r=>({...r}));assert.deepEqual(availability,snapshot[4].results);
  assert.deepEqual(h.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  console.log(JSON.stringify({ok:true,systems:h.sqlite.prepare('SELECT count(*) n FROM gdr_systems').get().n,rules:h.sqlite.prepare('SELECT count(*) n FROM gdr_rule_blocks').get().n,characters:after.length,powers:snapshot[3].results.length,assignments:snapshot[5].results.length}));
}finally{h.sqlite.close();}
