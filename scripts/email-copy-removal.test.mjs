import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('rimozione copie: conserva il flag email, le ricevute e la coda originale', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,is_test INTEGER DEFAULT 0,admin_email_updates INTEGER DEFAULT 0);
      INSERT INTO users VALUES(1,'author@example.test',0,1);
      CREATE TABLE world_updates(id INTEGER PRIMARY KEY,created_by INTEGER,safe INTEGER);
      INSERT INTO world_updates VALUES(133,1,0);`);
    sql.exec(readFileSync('migrations/0156_world_update_email_queue.sql', 'utf8'));
    sql.exec(readFileSync('migrations/0158_notification_email_copies.sql', 'utf8'));
    sql.prepare(`INSERT INTO world_update_emails(update_id,state,payload,sent_at)
      VALUES(133,'sent',?,'2026-11-09T12:11:19Z')`).run(JSON.stringify({to:'recipient@example.test',subject:'Titolo',html:'<p>Testo originale</p>'}));
    sql.prepare(`INSERT INTO notification_email_copies(id,recipient_id,state,payload,sent_at)
      VALUES('world-update/133/copy/1',1,'sent',?,'2026-11-11T17:25:46Z')`).run(JSON.stringify({to:'author@example.test',subject:'Titolo',html:'<p>Testo originale</p>'}));
    const original = sql.prepare('SELECT * FROM world_update_emails').get();
    const receipt = sql.prepare('SELECT * FROM notification_email_copies').get();
    sql.exec(readFileSync('migrations/0159_remove_notification_email_copies.sql', 'utf8'));
    assert.equal(sql.prepare('SELECT admin_email_updates FROM users WHERE id=1').get().admin_email_updates, 1);
    assert.equal(sql.prepare("SELECT count(*) n FROM pragma_table_info('users') WHERE name='notify_email_copies'").get().n, 0);
    assert.deepEqual(sql.prepare('SELECT * FROM notification_email_copy_history').get(), receipt);
    assert.deepEqual(sql.prepare('SELECT * FROM world_update_emails').get(), original);
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('queue_world_update_email_copy','notification_email_copies')").get().n, 0);
    sql.exec('INSERT INTO world_updates VALUES(134,1,0)');
    assert.equal(sql.prepare('SELECT state FROM world_update_emails WHERE update_id=134').get().state, 'pending');
    assert.equal(sql.prepare('SELECT count(*) n FROM notification_email_copy_history').get().n, 1);
  } finally {
    sql.close();
  }
});
