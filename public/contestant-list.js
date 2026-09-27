const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let contestants = [];

function render() {
  const query = clean(element('filter').value).toLocaleLowerCase();
  const visible = contestants.filter((row) => [row.ContestantID, row.FirstName,
    row.LastName, row.AgeGroup, row.Mission].some((value) => clean(value).toLocaleLowerCase().includes(query)));
  const compare = (a, b) => clean(a).localeCompare(clean(b), undefined, { numeric: true, sensitivity: 'base' });
  visible.sort((a, b) => compare(a.AgeGroup, b.AgeGroup) || compare(a.FirstName, b.FirstName));
  const body = element('contestants');
  body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    for (const field of ['ContestantID', 'FirstName', 'LastName', 'AgeGroup', 'Mission',
      'Region', 'OnStageChestNo', 'OffStageChestNo', 'Comments']) {
      const td = document.createElement('td');
      td.textContent = clean(row[field]);
      tr.append(td);
    }
    const action = document.createElement('td');
    const edit = document.createElement('a');
    edit.href = `/edit-contestant.html?id=${encodeURIComponent(clean(row.ContestantID))}`;
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${clean(row.FirstName)} ${clean(row.LastName)}`);
    action.append(edit); tr.append(action);
    body.append(tr);
  }
  element('listStatus').textContent = query
    ? `${visible.length} of ${contestants.length} contestants shown.`
    : `${contestants.length} contestants.`;
}
element('filter').addEventListener('input', render);

async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view contestants.'; return; }
  const user = await session.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('listPanel').classList.remove('d-none');
  const response = await fetch('/api/contestants');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load contestants.');
  contestants = data.contestants;
  render();
}
initialize().catch((error) => {
  if (element('listPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else { element('message').textContent = error.message; element('message').classList.remove('d-none'); element('listStatus').textContent = 'Unable to load contestants.'; }
});
