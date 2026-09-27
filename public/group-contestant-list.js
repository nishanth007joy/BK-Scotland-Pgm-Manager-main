const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();
let groups = [];
function render() {
  const query = clean(element('filter').value).toLocaleLowerCase();
  const visible = groups.filter(row => Object.values(row).some(value => clean(value).toLocaleLowerCase().includes(query)));
  const body = element('contestants');
  body.replaceChildren();
  const events = new Map();
  for (const row of visible) {
    const eventName = clean(row.EventName) || 'Unnamed event';
    const ageGroup = clean(row.AgeGroup) || 'Unspecified age group';
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
    th.colSpan = 11;
    th.textContent = label;
    tr.append(th);
    body.append(tr);
  }
  for (const [eventName, ageGroups] of [...events].sort(([a], [b]) => compareLabels(a, b))) {
    appendGroupHeading(eventName, 'table-primary');
    for (const [ageGroup, rows] of [...ageGroups].sort(([a], [b]) => compareLabels(a, b))) {
      appendGroupHeading(`${ageGroup} (${rows.length} ${rows.length === 1 ? 'group' : 'groups'})`, 'table-secondary');
      for (const row of rows) {
        const tr = document.createElement('tr');
        const participants = Array.from({ length: 9 }, (_, i) => {
          const name = clean(row[`Participant${i + 1}`]);
          const id = clean(row[`Participant${i + 1}ID`]);
          return name || id ? `${name}${id ? ` (${id})` : ''}` : '';
        }).filter(Boolean).join('; ');
        for (const value of [row.ID, row.GroupName, row.EventName, row.EventID, row.AgeGroup,
          row.Mission, row.Region, row.ChestNo,
          `${clean(row.GroupLeader)} (${clean(row.GroupLeaderID)})`, participants, row.Comments]) {
          const td = document.createElement('td');
          td.textContent = clean(value);
          tr.append(td);
        }
        body.append(tr);
      }
    }
  }
  element('listStatus').textContent = query
    ? `${visible.length} of ${groups.length} groups shown.`
    : groups.length ? `${groups.length} groups.` : 'No group contestants have been added yet.';
}
element('filter').addEventListener('input', render);
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view group contestants.'; return; }
  const user = await session.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('listPanel').classList.remove('d-none');
  const response = await fetch('/api/group-contestants');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load group contestants.');
  groups = data.groups;
  render();
}
initialize().catch(error => {
  if (element('listPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else {
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Unable to load group contestants.';
  }
});
