const assert = require('node:assert/strict');
const express = require('express');
const registerResults = require('../results-routes');
const sql = require('mssql');
(async () => {
  const app = express();
  app.use(express.json());
  let fail = false;
  const authMiddleware = (req, res, next) => { req.session = {username: 'reviewer'}; next(); };
  registerResults(app, {sql, authMiddleware, isAdmin: () => false, dbReady: Promise.resolve(), db: {request() {
    return {input() {return this;}, async query() {if (fail) throw Object.assign(new Error('Scores changed'), {number:51047}); return {recordset:[{PublishedCount:1}]};}};
  }}});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const publish = () => fetch(base + '/api/results/approve', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({EventID:'song',EventAgeGroup:'Junior',ReviewedResults:[{ContestantID:'one',EventAttendence:'Completed',Score:10}]})});
  try {
    const initial = await (await fetch(base+'/api/results/updates')).json();
    assert.ok(initial.revision);
    const pending = fetch(base+'/api/results/updates?since='+initial.revision, {signal:AbortSignal.timeout(3000)});
    assert.equal((await publish()).status,200);
    const notification = await (await pending).json();
    assert.notEqual(notification.revision,initial.revision);
    fail = true;
    assert.equal((await publish()).status,409);
    const afterFailure = await (await fetch(base+'/api/results/updates')).json();
    assert.equal(afterFailure.revision,notification.revision);
    const reconnect = await (await fetch(base+'/api/results/updates?since=old-server-revision')).json();
    assert.equal(reconnect.revision,notification.revision);
    console.log('PASS: publication wakes waiting board, rejected publication does not notify, reconnect catches missed updates.');
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
