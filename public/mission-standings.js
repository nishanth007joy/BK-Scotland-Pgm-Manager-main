const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let missions = [];

function render() {
  const search = clean(element('filter').value).toLowerCase();
  const visible = missions.filter(row => ['Mission']
    .some(field => clean(row[field]).toLowerCase().includes(search)));
  const body = element('missions');
  body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    for (const field of ['Place', 'Mission', 'IndividualPoints', 'GroupPoints', 'TotalPoints']) {
      const td = document.createElement('td');
      td.textContent = clean(row[field]);
      tr.append(td);
    }
    body.append(tr);
  }
  element('listStatus').textContent = !missions.length ? 'No missions are available yet.'
    : `${visible.length} of ${missions.length} missions shown.`;
}

async function loadReport() {
  element('reload').disabled = element('filter').disabled = true;
  element('message').classList.add('d-none');
  element('missions').replaceChildren();
  element('listStatus').textContent = 'Loading mission standings...';
  try {
    const response = await fetch('/api/reports/mission-standings', { cache: 'no-store' });
    if (response.status === 401) throw new Error('Your session expired. Sign in again to view reports.');
    if (!response.ok) throw new Error('Unable to load the report. Restart the server if this report was recently added, then try again.');
    const data = await response.json();
    missions = data.missions;
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
