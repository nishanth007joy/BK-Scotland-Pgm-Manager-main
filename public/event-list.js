const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let events = [];

function render() {
  const query = clean(element('filter').value).toLocaleLowerCase();
  const visible = events.filter((row) => [row.EventID, row.EventName, row.EventAgeGroup, row.IndividualGroup, row.OnStageOffStage].some((value) => clean(value).toLocaleLowerCase().includes(query)));
  const body = element('events');
  body.replaceChildren();
  const items = new Map();
  for (const row of visible) {
    const itemName = clean(row.EventName) || 'Unnamed event';
    const ageGroup = clean(row.EventAgeGroup) || 'Unspecified age group';
    if (!items.has(itemName)) items.set(itemName, new Map());
    const ageGroups = items.get(itemName);
    if (!ageGroups.has(ageGroup)) ageGroups.set(ageGroup, []);
    ageGroups.get(ageGroup).push(row);
  }
  const compareLabels = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  function appendGroupHeading(label, className) {
    const tr = document.createElement('tr');
    tr.className = className;
    const th = document.createElement('th');
    th.colSpan = 7;
    th.textContent = label;
    tr.append(th);
    body.append(tr);
  }
  for (const [itemName, ageGroups] of [...items].sort(([a], [b]) => compareLabels(a, b))) {
    appendGroupHeading(itemName, 'table-primary');
    for (const [ageGroup, rows] of [...ageGroups].sort(([a], [b]) => compareLabels(a, b))) {
      appendGroupHeading(ageGroup, 'table-secondary');
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (const field of ['EventID', 'EventName', 'EventAgeGroup', 'IndividualGroup', 'OnStageOffStage', 'Comments']) {
          const td = document.createElement('td');
          td.textContent = clean(row[field]);
          tr.append(td);
        }
        const action = document.createElement('td');
        const edit = document.createElement('a');
        edit.href = `/edit-event.html?id=${encodeURIComponent(clean(row.EventID))}`;
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit ${clean(row.EventName)}`);
        action.append(edit); tr.append(action);
        body.append(tr);
      }
    }
  }
  element('listStatus').textContent = visible.length
    ? ''
    : query ? 'No matching events.' : 'No events have been added yet.';
}
element('filter').addEventListener('input', render);

async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view events.'; return; }
  const user = await session.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('listPanel').classList.remove('d-none');
  const response = await fetch('/api/events');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load events.');
  events = data.events;
  render();
}
initialize().catch((error) => {
  if (element('listPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else { element('message').textContent = error.message; element('message').classList.remove('d-none'); element('listStatus').textContent = 'Unable to load events.'; }
});
