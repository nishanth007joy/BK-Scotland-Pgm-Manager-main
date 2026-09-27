const assert = require('node:assert/strict');
const register = require('../reset-data-routes');

(async () => {
  const routes = {};
  const queries = [];
  let sessions = [];
  let fail = false;
  const admin = (req, res, next) => req.session.role === 'admin' ? next() : res.status(403).json({});
  register({ get: (path, ...handlers) => { routes.GET = handlers; }, post: (path, ...handlers) => { routes.POST = handlers; } }, {
    db: { request: () => ({ query: async query => {
      queries.push(query);
      if (fail) throw Error('Simulated SQL failure');
      return { recordset: [{ TableName: 'Contestants', RowCount: 10 }] };
    } }) }, dbReady: Promise.resolve(), requireAdmin: admin, activeSessions: { list: () => sessions },
  });
  async function call(method, req) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await routes[method][0](req, res, () => routes[method][1](req, res));
    return res;
  }
  const req = { session: { role: 'user' }, body: {} };
  assert.equal((await call('GET', req)).code, 403);
  assert.equal((await call('POST', req)).code, 403);
  assert.equal(queries.length, 0);
  req.session = { role: 'admin', accountKey: 'admin', save: callback => callback() };
  assert.equal((await call('POST', req)).code, 400);
  const preview = await call('GET', req);
  assert.equal(preview.data.tables[0].RowCount, 10);
  req.body = { token: preview.data.token, confirmation: 'wrong', backupConfirmed: true };
  assert.equal((await call('POST', req)).code, 400);
  req.body.confirmation = 'DELETE COMPETITION DATA';
  req.body.backupConfirmed = false;
  assert.equal((await call('POST', req)).code, 400);
  req.body.backupConfirmed = true;
  sessions = [{ account: 'other' }];
  assert.equal((await call('POST', req)).code, 409);
  sessions = [];
  assert.equal((await call('POST', req)).code, 200);
  const deletion = queries.at(-1);
  assert.deepEqual([...deletion.matchAll(/DELETE FROM dbo\.(\w+)/g)].map(match => match[1]),
    ['PublishedResults', 'PrePubResults', 'GroupContestants', 'EventRegistrations', 'Contestants']);
  assert.match(deletion, /BEGIN TRANSACTION/);
  assert.match(deletion, /ROLLBACK TRANSACTION/);
  assert.match(deletion, /SET XACT_ABORT ON/);
  assert.equal((await call('POST', req)).code, 400);
  req.body.token = (await call('GET', req)).data.token;
  req.session.resetData.expires = 0;
  assert.equal((await call('POST', req)).code, 400);
  req.body.token = (await call('GET', req)).data.token;
  fail = true;
  const oldError = console.error;
  console.error = () => {};
  try { assert.equal((await call('POST', req)).code, 500); } finally { console.error = oldError; }
  assert.equal(req.session.resetData, undefined);
  console.log('Reset route checks passed (simulated database; no live deletions).');
})().catch(error => { console.error(error); process.exitCode = 1; });
