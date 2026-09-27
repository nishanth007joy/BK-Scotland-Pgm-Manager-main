const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function node() {
  return { children: [], value: '', disabled: false, style: {}, listeners: {},
    classList: { add() {}, remove() {} }, setAttribute() {},
    add(option) { this.children.push(option); }, append(...children) { this.children.push(...children); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    checkValidity() { return true; }, reportValidity() {},
  };
}
const source = fs.readFileSync('public/results.js', 'utf8');
function setup({ single = true, published = false, admin = false, saved = false } = {}) {
  const elements = {};
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id] ||= node(), createElement: node },
    Option: function (text, value) { this.text = text; this.value = value; },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ result: { Score: null, EventAttendence: 'WalkOver',
        Place: 'First', Points: 5, ScoreLastEditedBy: 'entry-user', CheckedApproved: 'not approved' } }) };
    },
  });
  vm.runInContext(source.slice(0, source.indexOf('async function loadParticipants()')), context);
  context.row = { ContestantID: 'c1', ContestantFirstName: 'Test', ContestantLastName: 'User',
    RegistrationCount: 1, Score: null, EventAttendence: saved ? 'WalkOver' : null,
    ResultExists: saved ? 1 : 0, ScoreLastEditedBy: saved ? 'entry-user' : null, Place: saved ? 'First' : null, Points: saved ? 5 : null };
  vm.runInContext(`addParticipant(row, {EventID:'e1', EventAgeGroup:'8-10'}, ${published}, ${admin}, ${single})`, context);
  const cells = elements.participants.children[0].children;
  return { cells, requests, button: cells[5].children[3], score: cells[5].children[0], attendance: cells[4].children[0] };
}
(async () => {
  const single = setup();
  assert.equal(single.button.disabled, false);
  single.button.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(single.requests.length, 1);
  assert.equal(single.requests[0].body.EventAttendence, 'WalkOver');
  assert.equal(single.requests[0].body.Score, null);
  assert.equal(single.score.disabled, true);
  assert.equal(single.attendance.value, 'WalkOver');
  assert.match(single.cells[8].textContent, /First place, 5 points/);
  assert.equal(single.button.disabled, true);
  assert.equal(setup({ single: false }).button.disabled, true);
  assert.equal(setup({ published: true }).button.disabled, true);
  assert.equal(setup({ published: true, admin: true }).button.disabled, false);
  const saved = setup({ saved: true });
  assert.equal(saved.score.disabled, true);
  assert.equal(saved.attendance.value, 'WalkOver');
  assert.equal(saved.button.disabled, true);
  console.log('PASS: WalkOver button eligibility, null-score submission, saved state, and admin permissions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
