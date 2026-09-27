const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();
let events = [], pending = null;
const label = row => `${clean(row.EventName)} - ${clean(row.EventAgeGroup)} (${clean(row.EventID)})`;
const selected = () => events.find(row => label(row) === element('eventPicker').value);
function clearReview() { pending = null; element('review').classList.add('d-none'); }
function busy(value) {
  for (const id of ['eventPicker', 'eventName', 'reviewButton', 'confirmButton', 'cancelButton']) element(id).disabled = value;
}
async function read(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to complete request.');
  return data;
}
function options() { element('eventOptions').replaceChildren(...events.map(row => new Option(label(row), label(row)))); }
function section(title, rows) {
  const heading = document.createElement('h3'); heading.className = 'h5 mt-3'; heading.textContent = `${title} (${rows.length})`;
  element('details').append(heading);
  if (!rows.length) { const p = document.createElement('p'); p.textContent = 'None'; element('details').append(p); return; }
  const wrapper = document.createElement('div'); wrapper.className = 'table-responsive';
  const table = document.createElement('table'); table.className = 'table table-sm table-bordered';
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const head = document.createElement('thead'); const tr = document.createElement('tr');
  keys.forEach(key => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = key; tr.append(th); });
  head.append(tr); table.append(head);
  const body = document.createElement('tbody');
  rows.forEach(row => { const tr = document.createElement('tr'); keys.forEach(key => { const td = document.createElement('td'); td.textContent = clean(row[key]); tr.append(td); }); body.append(tr); });
  table.append(body); wrapper.append(table); element('details').append(wrapper);
}
element('eventPicker').addEventListener('input', () => {
  clearReview(); const row = selected();
  element('eventName').value = row ? clean(row.EventName) : '';
  element('eventName').disabled = !row; element('reviewButton').disabled = !row;
  element('message').textContent = '';
});
element('eventName').addEventListener('input', clearReview);
element('cancelButton').addEventListener('click', clearReview);
element('renameForm').addEventListener('submit', async event => {
  event.preventDefault(); const row = selected(); const name = clean(element('eventName').value);
  if (!row || !name) return;
  clearReview(); busy(true); element('message').textContent = '';
  try {
    const data = await read(await fetch(`/api/admin/event-names/${encodeURIComponent(clean(row.EventID))}`));
    element('details').replaceChildren();
    element('changeSummary').textContent = `Change “${clean(data.event.EventName)}” to “${name}” for event ${clean(row.EventID)}.`;
    section('Event details', [data.event]);
    section('Registered contestants', data.registrations);
    section('Group registrations and participants', data.groups);
    section('Pre-publication results (including approved)', data.prepubResults);
    section('Published results', data.publishedResults);
    pending = { id: clean(row.EventID), EventName: name, token: data.token, confirmed: true };
    element('review').classList.remove('d-none');
  } catch (error) { element('message').textContent = error.message; }
  finally { busy(false); }
});
element('confirmButton').addEventListener('click', async () => {
  if (!pending) return;
  const payload = pending; busy(true);
  try {
    const data = await read(await fetch(`/api/admin/event-names/${encodeURIComponent(payload.id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    events = events.map(row => clean(row.EventID) === payload.id ? { ...row, EventName: payload.EventName } : row);
    options(); element('eventPicker').value = label(events.find(row => clean(row.EventID) === payload.id));
    element('message').textContent = data.message;
  } catch (error) { element('message').textContent = error.message; }
  finally { clearReview(); busy(false); }
});
(async () => {
  const user = await read(await fetch('/api/session', { method: 'POST' }));
  if (!user.isAdmin) throw new Error('Administrator access is required.');
  events = (await read(await fetch('/api/events'))).events;
  options(); element('eventPicker').disabled = false;
  element('panel').classList.remove('d-none'); element('accessMessage').textContent = `Signed in as ${user.name}`;
})().catch(error => { element('accessMessage').textContent = error.message; });
