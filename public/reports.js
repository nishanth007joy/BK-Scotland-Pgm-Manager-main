const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let records = [];

function render() {
  const search = clean(element('filter').value).toLowerCase();
  const visible = records.filter(row => ['EventID', 'EventName', 'EventAgeGroup', 'IndividualGroup', 'OnStageOffStage', 'ContestantID', 'ContestantFirstName', 'ContestantLastName', 'ContestantMission', 'ChestNo', 'EventAttendence']
    .some(field => clean(row[field]).toLowerCase().includes(search)));
  const body = element('events');
  body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    for (const field of ['EventName', 'EventAgeGroup', 'EventID', 'IndividualGroup', 'OnStageOffStage', 'ContestantID', 'ContestantFirstName', 'ContestantLastName', 'ContestantMission', 'ChestNo', 'EventAttendence']) {
      const td = document.createElement('td');
      td.textContent = clean(row[field]);
      tr.append(td);
    }
    body.append(tr);
  }
  element('listStatus').textContent = !records.length ? 'No records without score were found.'
    : `${visible.length} of ${records.length} records without score shown.`;
}

async function loadReport() {
  element('reload').disabled = element('filter').disabled = true;
  element('message').classList.add('d-none');
  element('events').replaceChildren();
  element('listStatus').textContent = 'Loading records without score...';
  try {
    const response = await fetch('/api/reports/records-without-score', { cache: 'no-store' });
    if (response.status === 401) throw new Error('Your session expired. Sign in again to view reports.');
    if (!response.ok) throw new Error('Unable to load the report. Restart the server if this report was recently added, then try again.');
    const data = await response.json();
    records = data.records;
    render();
    element('filter').disabled = false;
  } catch (error) {
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Unable to load report.';
  } finally { element('reload').disabled = false; }
}

element('filter').addEventListener('input', render);
element('reload').addEventListener('click', loadReport);
async function initialize() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) {
    element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view reports.';
    return;
  }
  const user = await response.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  await loadReport();
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
