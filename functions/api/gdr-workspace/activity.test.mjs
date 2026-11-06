import test from 'node:test';
import assert from 'node:assert/strict';
import { apiHarness } from '../../../scripts/gdr-workspace-test-harness.mjs';

test('il log GDR descrive una mutazione riuscita, senza contenuti privati o eventi per richieste rifiutate', async()=>{
 const h=apiHarness();
 try {
  const payload={action:'createAdventure',id:'activity-test',title:'Avventura',source:'Testo privato'};
  assert.equal((await h.call(2,'POST',payload)).status,403);
  assert.equal(h.events.length,0);
  assert.equal((await h.call(1,'POST',payload)).status,200);
  assert.equal(h.events.length,1);
  const event=h.events[0];
  assert.equal(event.actor.userId,1);
  assert.equal(event.eventType,'gdr_workspace_changed');
  assert.equal(event.metadata.action,'createAdventure');
  assert.equal(event.metadata.adventure,'activity-test');
  assert.ok(!JSON.stringify(event).includes('Testo privato'));
 } finally {h.sqlite.close();}
});
