const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const express = require('express');
const createRegistry = require('../single-session');
let now = 0;
const registry = createRegistry(100, () => now);
assert.ok(registry.claim('user', 'first'));
assert.ok(!registry.claim('user', 'second'));
now = 90;
assert.ok(registry.touch('user', 'first'));
now = 150;
assert.ok(!registry.claim('user', 'second'));
now = 191;
assert.ok(registry.claim('user', 'second'));
assert.ok(!registry.touch('user', 'first'));
registry.release('user', 'first');
assert.ok(!registry.claim('user', 'third'));
registry.release('user', 'second');
assert.ok(registry.claim('user', 'third'));
const salt = 'test-salt';
const user = { name: 'Tester', email: 'tester@example.test', role: 'admin',
  password_hash: 'scrypt$' + salt + '$' + crypto.scryptSync('test-password', salt, 64).toString('hex') };
let app;
const fakeSql = { NVarChar: () => {}, ConnectionPool: class {
  async connect() { return this; }
  request() { return { account: '', input(key, type, value) { if (key === 'account') this.account = value; return this; }, async query(text) {
    if (text.includes('password_hash') && this.account === 'resultboard') return { recordset: [{ name: 'resultboard', email: 'board@example.test', role: 'resultboard' }] };
    return { recordset: text.includes('password_hash') ? [this.account === 'Member' ? { ...user, name: 'Member', email: 'member@example.test', role: 'data-entry' } : user] : [] };
  } }; }
} };
const fakeExpress = () => { app = express(); app.listen = () => {}; return app; };
Object.assign(fakeExpress, express);
vm.runInNewContext(fs.readFileSync(require.resolve('../Server'), 'utf8'), {
  require(name) {
    if (name === 'express') return fakeExpress;
    if (name === 'mssql') return fakeSql;
    if (name.startsWith('./')) return require('../' + name.slice(2));
    return require(name);
  },
  __dirname: require('path').resolve(__dirname, '..'),
  process: { env: { DB_PASSWORD: 'test', SESSION_SECRET: 'test-session-secret' }, loadEnvFile() {}, exit() { throw Error('Unexpected exit'); } },
  console, Buffer, Promise,
});
(async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function post(path, cookie, body) {
    return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
  }
  const credentials = { username: 'Tester', password: 'test-password' };
  try {
    const boards = await Promise.all([post('/login', '', { username: 'resultboard' }), post('/login', '', { username: 'resultboard' })]);
    assert.ok(boards.every(response => response.status === 200), 'board accepts concurrent passwordless logins');
    const boardCookies = boards.map(response => response.headers.get('set-cookie').split(';')[0]);
    for (const boardCookie of boardCookies) {
      assert.equal((await post('/api/session', boardCookie)).status, 200);
      assert.equal((await post('/api/results', boardCookie, {})).status, 403);
    }
    assert.equal((await post('/logout', boardCookies[0])).status, 200);
    assert.equal((await post('/api/session', boardCookies[1])).status, 200, 'other board session survives logout');
    assert.equal((await post('/login', '', { username: 'Tester' })).status, 401, 'normal accounts still require passwords');
    const responses = await Promise.all([post('/login', '', credentials), post('/login', '', { ...credentials, username: user.email })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = responses.find(r => r.status === 200);
    const cookie = winner.headers.get('set-cookie').split(';')[0];
    assert.equal((await post('/api/session', cookie)).status, 200);
    assert.equal((await post('/login', cookie, credentials)).status, 200);
    assert.equal((await post('/login', '', { ...credentials, password: 'wrong' })).status, 401);
    const memberLogin = await post('/login', '', { ...credentials, username: 'Member' });
    const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/admin/sessions')).status, 403);
    assert.equal((await fetch(base + '/api/admin/sessions', { headers: { Cookie: memberCookie } })).status, 403);
    const list = await (await fetch(base + '/api/admin/sessions', { headers: { Cookie: cookie } })).json();
    const target = list.sessions.find(entry => entry.account === 'member@example.test');
    assert.ok(target && !target.token);
    assert.equal((await post('/api/admin/sessions/release', memberCookie, target)).status, 403);
    assert.equal((await post('/api/admin/sessions/release', cookie, { ...target, id: 'stale' })).status, 409);
    assert.equal((await post('/api/admin/sessions/release', cookie, target)).status, 200);
    assert.equal((await post('/api/session', memberCookie)).status, 401);
    assert.equal((await post('/login', '', { ...credentials, username: 'Member' })).status, 200);
    assert.equal((await post('/api/admin/sessions/release', cookie, target)).status, 409);
    assert.equal((await post('/api/admin/sessions/release', cookie, list.sessions.find(entry => entry.current))).status, 400);
    assert.equal((await post('/logout', cookie)).status, 200);
    assert.equal((await post('/api/session', cookie)).status, 401);
    assert.equal((await post('/login', '', credentials)).status, 200);
    console.log('PASS: concurrent username/email logins, existing session, invalid password, logout, re-login, inactivity expiry, admin-only release, stale release protection, revoked access, and immediate re-login.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
