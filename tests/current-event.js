const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('Server.js', 'utf8');
let handlers, savedName, writes = 0, fail = false;
const context = vm.createContext({
  app: { put(path, ...middleware) { assert.equal(path, '/api/current-event'); handlers = middleware; } },
  dbReady: Promise.resolve(), sql: { NVarChar: size => size },
  console: { error() {} },
  db: { request() { return {
    input(key, size, value) { assert.equal(key, 'currentEventName'); assert.equal(size, 200); savedName = value; return this; },
    async query(query) {
      assert.match(query, /SET CurrentEventName = @currentEventName/);
      assert.match(query, /WHERE ID = 1/);
      if (fail) throw new Error('Database unavailable');
      writes++;
      return { recordset: [{ CurrentEventName: savedName }] };
    },
  }; } },
});
vm.runInContext(source.slice(source.indexOf('function isAdmin('), source.indexOf("app.post('/login'")), context);
vm.runInContext(source.slice(source.indexOf("app.put('/api/current-event'"), source.indexOf("app.post('/api/missions'")), context);
async function call(role, currentEventName) {
  const req = { session: { role }, body: { currentEventName } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handlers[0](req, res, () => handlers[1](req, res));
  return res;
}
(async () => {
  for (const role of [undefined, 'data-entry']) assert.equal((await call(role, 'New event')).code, 403);
  for (const value of [undefined, null, 12, {}, '', '   ', 'a'.repeat(201)]) assert.equal((await call('admin', value)).code, 400);
  assert.equal(writes, 0);
  const saved = await call('admin', "  Scotland's event 2027  ");
  assert.equal(saved.code, 200);
  assert.equal(saved.data.currentEventName, "Scotland's event 2027");
  assert.equal(writes, 1);
  assert.equal((await call('admin', 'a'.repeat(200))).code, 200);
  fail = true;
  assert.equal((await call('admin', 'New event')).code, 500);
  console.log('PASS: current event admin access, validation, trimmed parameterized save, and database failure. No live data changed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
