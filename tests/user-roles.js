const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sql = require('mssql');
const routes = new Map();
const accounts = [];
const context = vm.createContext({
  crypto, sql, console, Buffer, dbReady: Promise.resolve(),
  app: { post(path, ...handlers) { routes.set(path, handlers); } },
  db: { request() {
    const inputs = {};
    return {
      input(name, type, value) { inputs[name] = value; return this; },
      async query(query) {
        if (query.startsWith('INSERT INTO dbo.users')) {
          accounts.push({ name: inputs.name, email: inputs.email, password_hash: inputs.passwordHash, role: inputs.role });
          return {};
        }
        if (inputs.account) return { recordset: accounts.filter(row => row.email === inputs.account || row.name === inputs.account) };
        return { recordset: accounts.filter(row => row.email === inputs.email) };
      },
    };
  } },
});
const source = fs.readFileSync('Server.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function hashPassword'), source.indexOf("app.get('/api/contestants'")), context);
async function call(path, session, body = {}) {
  const req = { session, body };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  const handlers = routes.get(path);
  let index = 0;
  async function next() { if (index < handlers.length) await handlers[index++](req, res, next); }
  await next();
  // Middleware returns next(), so async route completion is awaited.
  return res;
}
(async () => {
  for (const role of ['admin', 'data-entry']) {
    const created = await call('/api/users', { username: 'owner', role: 'admin' },
      { name: role, email: role + '@example.test', password: 'test-password', role });
    assert.equal(created.code, 201);
    assert.equal(accounts.at(-1).role, role);
    const session = {};
    const login = await call('/login', session, { email: role + '@example.test', password: 'test-password', role: 'admin' });
    assert.equal(login.code, 200);
    assert.equal(session.role, role);
    assert.equal(login.data.user.isAdmin, role === 'admin');
    assert.equal((await call('/api/admin/registration-access', session)).code, role === 'admin' ? 200 : 403);
  }
  assert.equal((await call('/api/users', { role: 'data-entry' }, { role: 'admin' })).code, 403);
  assert.equal((await call('/api/users', {}, { role: 'admin' })).code, 403);
  assert.equal((await call('/api/users', { role: 'admin' },
    { name: 'Invalid', email: 'invalid@example.test', password: 'test-password', role: 'owner' })).code, 400);
  assert.equal((await call('/api/users', { role: 'admin' },
    { name: 'Default', email: 'default@example.test', password: 'test-password' })).code, 201);
  assert.equal(accounts.at(-1).role, 'data-entry');
  console.log('PASS: role creation, default role, login permissions, rejected invalid roles and unauthorized creation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
