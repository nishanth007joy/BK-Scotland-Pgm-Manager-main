const assert = require('node:assert/strict');
const express = require('express');
const { restrictResultboard, isResultboard } = require('../resultboard-access');
const fs = require('node:fs');
const vm = require('node:vm');

async function accessTests() {
  const app = express();
  app.use((req, res, next) => {
    req.session = { username: req.headers['x-user'] || 'viewer', role: req.headers['x-role'] || 'resultboard' };
    next();
  });
  app.use(restrictResultboard);
  app.use((req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [method, path, status] of [
      ['GET', '/results-display.html', 200], ['GET', '/results-display.js', 200],
      ['GET', '/api/results/published', 200], ['GET', '/api/current-event', 200],
      ['POST', '/api/session', 200], ['POST', '/logout', 200],
      ['GET', '/home.html', 302], ['GET', '/contestants.html', 302],
      ['GET', '/published-results.html', 302], ['GET', '/api/contestants', 403],
      ['POST', '/api/results', 403], ['POST', '/api/users', 403],
      ['POST', '/api/results/certificate', 403], ['PUT', '/api/current-event', 403],
      ['GET', '/api/admin/sessions', 403], ['POST', '/api/results/published', 403],
    ]) {
      const response = await fetch(base + path, { method, redirect: 'manual' });
      assert.equal(response.status, status, `${method} ${path}`);
      if (status === 302) assert.equal(response.headers.get('location'), '/results-display.html');
    }
    assert.equal((await fetch(base + '/api/contestants', {headers: {'x-role': 'admin', 'x-user': 'ResultBoard'}})).status, 403);
    for (const role of ['admin', 'data-entry']) {
      assert.equal((await fetch(base + '/home.html', {headers: {'x-role': role}})).status, 200);
    }
    assert.equal(isResultboard({ username: ' resultboard ', role: 'data-entry' }), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
}

async function scrollingTests() {
  class Element {
    constructor() { this.children = []; this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 400; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute() {}
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  let requests = 0, fail = false, now = 0;
  const context = vm.createContext({
    document: {getElementById: get, createElement: () => new Element(), createDocumentFragment: () => new Element(), hidden: false},
    performance: {now: () => now}, requestAnimationFrame() {},
    fetch: async path => {
      if (path === '/api/session') return new Promise(() => {});
      requests++;
      return {ok: !fail, status: fail ? 500 : 200, json: async () => ({results: [{EventName: 'Song', EventAgeGroup: 'Junior', Place: 'First'}]})};
    },
  });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync('public/results-display.js', 'utf8'));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  get('resultsViewport').scrollTop = 599;
  run('position = 599; animate(0); animate(100)');
  assert.equal(get('resultsViewport').scrollTop, 600);
  assert.equal(requests, 0);
  run('animate(3099)'); assert.equal(requests, 0);
  now = 3100; run('animate(3100); animate(3101)'); await flush();
  assert.equal(requests, 1, 'one refresh at bottom');
  assert.equal(get('resultsViewport').scrollTop, 0);
  get('toggleScroll').listeners.click();
  now = 40000; run('animate(40000)'); assert.equal(requests, 1, 'paused board does not refresh');
  get('toggleScroll').listeners.click();
  get('resultsViewport').scrollHeight = 200;
  run('animate(40001)'); await flush(); assert.equal(requests, 2, 'short board refreshes');
  fail = true; now = 71000; run('animate(71000)'); await flush();
  assert.equal(requests, 3);
  assert.match(get('message').textContent, /Unable to load/);
  run('animate(71001)'); await flush(); assert.equal(requests, 3, 'failed refresh does not loop requests');
  assert.equal(get('resultGroups').children[0].children.length, 1, 'existing results retained on failure');
}

(async () => {
  await accessTests();
  await scrollingTests();
  console.log('PASS: results-board restrictions, normal user access, scrolling refresh, pause, short boards and retry delay.');
})().catch(error => { console.error(error); process.exitCode = 1; });
