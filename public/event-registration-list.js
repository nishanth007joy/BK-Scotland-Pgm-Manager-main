const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();
let registrations = [];
function render() {
  const query = clean(element('filter').value).toLocaleLowerCase();
  const visible = registrations.filter(row => Object.values(row).some(value => clean(value).toLocaleLowerCase().includes(query)));
  const body = element('contestants');
  body.replaceChildren();
  const events = new Map();
  for (const row of visible) {
    const eventName = clean(row.EventName) || 'Unnamed event';
    const ageGroup = clean(row.EventAgeGroup) || 'Unspecified age group';
    if (!events.has(eventName)) events.set(eventName, new Map());
    const ageGroups = events.get(eventName);
    if (!ageGroups.has(ageGroup)) ageGroups.set(ageGroup, []);
    ageGroups.get(ageGroup).push(row);
  }
  const compareLabels = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  function appendGroupHeading(label, className) {
    const tr = document.createElement('tr');
    tr.className = className;
    const th = document.createElement('th');
    th.colSpan = 9;
    th.textContent = label;
    tr.append(th);
    body.append(tr);
  }
  for (const [eventName, ageGroups] of [...events].sort(([a], [b]) => compareLabels(a, b))) {
    appendGroupHeading(eventName, 'table-primary');
    for (const [ageGroup, rows] of [...ageGroups].sort(([a], [b]) => compareLabels(a, b))) {
      appendGroupHeading(`${ageGroup} (${rows.length} ${rows.length === 1 ? 'registration' : 'registrations'})`, 'table-secondary');
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (const value of [row.EventID, row.EventName, row.EventAgeGroup, row.ContestantID,
          row.ContestantFirstName, row.ContestantLastName, row.ContestantMission, row.ChestNo, row.Comments]) {
          const td = document.createElement('td');
          td.textContent = clean(value);
          tr.append(td);
        }
        body.append(tr);
      }
    }
  }
  element('listStatus').textContent = query
    ? `${visible.length} of ${registrations.length} registrations shown.`
    : registrations.length ? `${registrations.length} registrations.` : 'No single event registrations have been added yet.';
}
element('filter').addEventListener('input', render);
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view single event registrations.'; return; }
  const user = await session.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('listPanel').classList.remove('d-none');
  const response = await fetch('/api/event-registrations');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load single event registrations.');
  registrations = data.registrations;
  render();
}
initialize().catch(error => {
  if (element('listPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else {
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Unable to load single event registrations.';
  }
});
