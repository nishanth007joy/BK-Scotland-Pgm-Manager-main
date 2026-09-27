const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const fields = ['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region',
  'OnStageChestNo', 'OffStageChestNo', 'Comments'];
let original = null;
let loadVersion = 0;
let admin = false;
let pendingUpdate = null;
function clearReview() {
  pendingUpdate = null;
  element('updateReview').classList.add('d-none');
}
function showReview(data, updated) {
  const details = element('reviewDetails');
  details.replaceChildren();
  function section(title, rows) {
    const heading = document.createElement('h3');
    heading.className = 'h6 mt-3';
    heading.textContent = `${title} (${rows.length})`;
    details.append(heading);
    if (!rows.length) {
      const empty = document.createElement('p'); empty.textContent = 'None'; details.append(empty); return;
    }
    const wrapper = document.createElement('div'); wrapper.className = 'table-responsive';
    const table = document.createElement('table'); table.className = 'table table-sm table-bordered';
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const head = document.createElement('thead'); const header = document.createElement('tr');
    for (const key of keys) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = key; header.append(th); }
    head.append(header); table.append(head);
    const body = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const key of keys) { const td = document.createElement('td'); td.textContent = clean(row[key]); tr.append(td); }
      body.append(tr);
    }
    table.append(body); wrapper.append(table); details.append(wrapper);
  }
  section('Changes', fields.filter(field => clean(original[field]) !== updated[field])
    .map(field => ({ Field: field, Before: clean(original[field]), After: updated[field] })));
  section('Event registrations', data.registrations);
  section('Group memberships', data.groups);
  section('Pre-publication results (including approved)', data.prepubResults);
  section('Published results', data.publishedResults);
  pendingUpdate = { ...updated, token: data.token, confirmed: true };
  element('updateReview').classList.remove('d-none');
}
element('editForm').addEventListener('input', clearReview);
element('cancelUpdate').addEventListener('click', clearReview);
element('confirmUpdate').addEventListener('click', async () => {
  if (!pendingUpdate || !original) return;
  const payload = pendingUpdate;
  if (fields.some(field => clean(element(field).value) !== payload[field])) {
    clearReview(); showMessage('Details changed. Review the changes again before confirming.', 'warning'); return;
  }
  const id = clean(original.ContestantID);
  element('confirmUpdate').disabled = true;
  element('save').disabled = true;
  element('contestantPicker').disabled = true;
  for (const field of fields) element(field).disabled = true;
  try {
    const data = await readResponse(await fetch(`/api/admin/contestants/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    await loadContestant();
    showMessage(data.message, 'success');
  } catch (error) { clearReview(); showMessage(error.message, 'danger'); }
  finally {
    element('confirmUpdate').disabled = false;
    element('save').disabled = false;
    element('contestantPicker').disabled = false;
    for (const field of fields) element(field).disabled = false;
  }
});

function showMessage(message, type) {
  element('message').textContent = message;
  element('message').className = `alert alert-${type} mt-3 mb-0`;
}
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
  return data;
}
async function loadContestant() {
  clearReview();
  const id = element('contestantPicker').value;
  const current = ++loadVersion;
  original = null;
  element('editForm').classList.add('d-none');
  element('message').classList.add('d-none');
  if (!id) return;
  try {
    const data = await readResponse(await fetch(`/api/contestants/${encodeURIComponent(id)}`));
    if (current !== loadVersion) return;
    original = data.contestant;
    element('ContestantID').value = clean(original.ContestantID);
    for (const field of fields) element(field).value = clean(original[field]);
    element('editForm').classList.remove('d-none');
    history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
  } catch (error) { if (current === loadVersion) showMessage(error.message, 'danger'); }
}
element('contestantPicker').addEventListener('change', loadContestant);
element('editForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!original || !event.currentTarget.reportValidity()) return;
  const id = clean(original.ContestantID);
  const updated = Object.fromEntries(fields.map((field) => [field, clean(element(field).value)]));
  const button = element('save');
  button.disabled = true; button.textContent = 'Saving...';
  element('contestantPicker').disabled = true;
  try {
    if (admin) {
      clearReview();
      const data = await readResponse(await fetch(`/api/admin/contestants/${encodeURIComponent(id)}`));
      if (fields.some(field => clean(data.contestant[field]) !== clean(original[field])))
        throw new Error('Contestant details changed. Select the contestant again to reload before editing.');
      showReview(data, updated);
      return;
    }
    const data = await readResponse(await fetch(`/api/contestants/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updated, Original: original }),
    }));
    original = { ...original, ...updated };
    showMessage(data.message, 'success');
  } catch (error) { showMessage(error.message, 'danger'); }
  finally { button.disabled = false; button.textContent = admin ? 'Review changes' : 'Save changes'; element('contestantPicker').disabled = false; }
});
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to edit contestants.'; return; }
  const user = await readResponse(session);
  admin = user.isAdmin === true;
  if (admin) {
    element('save').textContent = 'Review changes';
    element('updateHelp').textContent = 'Review linked event registrations, group memberships and all results before confirming an update, including approved and published entries.';
  }
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('editPanel').classList.remove('d-none');
  const data = await readResponse(await fetch('/api/contestants'));
  const picker = element('contestantPicker');
  picker.replaceChildren(new Option('Select a contestant', ''));
  data.contestants.forEach((row) => picker.add(new Option(
    `${clean(row.FirstName)} ${clean(row.LastName)} (${clean(row.ContestantID)})`, clean(row.ContestantID))));
  const id = new URLSearchParams(location.search).get('id');
  if (id && [...picker.options].some((option) => option.value === id)) {
    picker.value = id; await loadContestant();
  }
  const optional = await Promise.allSettled([
    fetch('/api/age-categories', { method: 'POST' }).then(readResponse),
    fetch('/api/missions', { method: 'POST' }).then(readResponse),
  ]);
  if (optional[0].status === 'fulfilled') optional[0].value.ageCategories.forEach((row) =>
    element('ageOptions').append(new Option(row.name, row.name)));
  if (optional[1].status === 'fulfilled') optional[1].value.missions.forEach((row) =>
    element('missionOptions').append(new Option(row.name, row.name)));
}
initialize().catch((error) => {
  if (element('editPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else showMessage(error.message, 'danger');
});
