const assert = require('node:assert/strict');
const register = require('../admin-contestant-routes');
const routes = {};
let writes = 0, commits = 0, rollbacks = 0, failure = false;
const contestant = { ContestantID: '1', FirstName: 'Ann', LastName: 'Smith', AgeGroup: '10-15', Mission: 'A', Region: 'R', OnStageChestNo: '10', OffStageChestNo: '', Comments: '' };
const registration = { ContestantID: '1', EventID: 'E1', EventName: 'Song', IndividualGroup: 'Individual', OnStageOffStage: 'On Stage' };
let sets = [[contestant], [], [registration], [{ ...registration, Score: 80, CheckedApproved: 'approved' }], [{ ...registration, Place: 'First', Points: 5 }]];
class Transaction { async begin() {} async commit() { commits++; } async rollback() { rollbacks++; } }
class Request {
  input() { return this; }
  async query(query) {
    if (query.includes('SELECT ID AS ContestantID')) return { recordsets: sets };
    if (failure) { const error = new Error('Duplicate chest number'); error.number = 51062; throw error; }
    writes++;
    for (const table of ['EventRegistrations', 'PrePubResults', 'PublishedResults']) assert.ok(query.includes(`UPDATE dbo.${table}`));
    assert.ok(!query.includes("CheckedApproved='not approved'"));
    return {};
  }
}
const type = () => ({});
register({ get: (path, ...handlers) => { routes.get = handlers; }, put: (path, ...handlers) => { routes.put = handlers; } }, {
  db: {}, dbReady: Promise.resolve(), sql: { Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 }, NVarChar: type, VarChar: type, NChar: type },
  requireAdmin: (req, res, next) => req.admin ? next() : res.status(403).json({}),
});
async function call(method, body = {}, admin = true) {
  const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await routes[method][0]({ admin, params: { id: '1' }, body }, res, () => routes[method][1]({ admin, params: { id: '1' }, body }, res));
  return res;
}
(async () => {
  assert.equal((await call('get', {}, false)).code, 403);
  assert.equal((await call('put', {}, false)).code, 403);
  assert.equal((await call('put')).code, 400);
  const preview = await call('get');
  assert.equal(preview.data.publishedResults.length, 1);
  const payload = { ...contestant, FirstName: 'Anne', token: preview.data.token, confirmed: true };
  assert.equal((await call('put', { ...payload, token: 'stale' })).code, 409);
  assert.equal(writes, 0);
  sets[3][0].Score = 90;
  assert.equal((await call('put', payload)).code, 409);
  payload.token = (await call('get')).data.token;
  assert.equal((await call('put', { ...payload, OnStageChestNo: ' ' })).code, 409);
  assert.equal(writes, 0);
  assert.equal((await call('put', payload)).code, 200);
  assert.equal(writes, 1);
  const before = commits;
  failure = true;
  assert.equal((await call('put', payload)).code, 409);
  assert.equal(commits, before);
  assert.ok(rollbacks >= 4);
  console.log('Admin contestant route checks passed: access, confirmation, stale data, chest number, approved/published updates, rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
