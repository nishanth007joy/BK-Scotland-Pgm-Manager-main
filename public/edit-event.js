const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
const fields = ['EventName', 'EventAgeGroup', 'IndividualGroup', 'OnStageOffStage', 'Comments'];
let original = null;
let loadVersion = 0;
let ageCategories = [];
let events = [];

function eventLabel(row) {
  return `${clean(row.EventName)} - ${clean(row.EventAgeGroup)} (${clean(row.EventID)}) - ${clean(row.IndividualGroup)} - ${clean(row.OnStageOffStage)}`;
}
function selectedEvent() {
  const value = clean(element('eventPicker').value);
  return events.find(row => eventLabel(row) === value);
}
function refreshEventOptions() {
  element('eventOptions').replaceChildren(...events.map(row => new Option(eventLabel(row), eventLabel(row))));
}

function showMessage(message, type) {
  element('message').textContent = message;
  element('message').className = `alert alert-${type} mt-3 mb-0`;
}
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
  return data;
}
async function loadEvent() {
  const selected = selectedEvent();
  const id = selected ? clean(selected.EventID) : '';
  if (id && original && clean(original.EventID) === id) return;
  const current = ++loadVersion;
  original = null;
  element('editForm').classList.add('d-none');
  element('message').classList.add('d-none');
  if (!id) return;
  try {
    const data = await readResponse(await fetch(`/api/events/${encodeURIComponent(id)}`));
    if (current !== loadVersion) return;
    original = data.event;
    element('EventID').value = clean(original.EventID);
    const ageSelect = element('EventAgeGroup');
    ageSelect.replaceChildren(new Option('Select an age range', ''));
    ageCategories.forEach(name => ageSelect.add(new Option(name, name)));
    for (const field of fields) {
      if (field === 'EventAgeGroup' && ![...element(field).options].some(option => option.value === clean(original[field]))) element(field).add(new Option(clean(original[field]), clean(original[field])));
      element(field).value = clean(original[field]);
    }
    element('editForm').classList.remove('d-none');
    history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
  } catch (error) { if (current === loadVersion) showMessage(error.message, 'danger'); }
}
element('eventPicker').addEventListener('input', loadEvent);
element('eventPicker').addEventListener('change', loadEvent);
element('editForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!original || !event.currentTarget.reportValidity()) return;
  const id = clean(original.EventID);
  const updated = Object.fromEntries(fields.map((field) => [field, clean(element(field).value)]));
  const button = element('save');
  element('eventPicker').disabled = true;
  button.disabled = true; button.textContent = 'Saving...';
  try {
    const data = await readResponse(await fetch(`/api/events/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updated, Original: original }),
    }));
    original = { ...original, ...updated };
    events = events.map(row => clean(row.EventID) === id ? { ...row, ...updated } : row);
    refreshEventOptions();
    element('eventPicker').value = eventLabel(original);
    showMessage(data.message, 'success');
  } catch (error) { showMessage(error.message, 'danger'); }
  finally { element('eventPicker').disabled = false; button.disabled = false; button.textContent = 'Save changes'; }
});
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to edit events.'; return; }
  const user = await readResponse(session);
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('editPanel').classList.remove('d-none');
  const categories = await readResponse(await fetch('/api/age-categories', { method: 'POST' }));
  ageCategories = categories.ageCategories.map(row => row.name);
  const data = await readResponse(await fetch('/api/events'));
  const picker = element('eventPicker');
  events = data.events;
  refreshEventOptions();
  picker.disabled = false;
  const id = new URLSearchParams(location.search).get('id');
  const selected = events.find(row => clean(row.EventID) === id);
  if (selected) {
    picker.value = eventLabel(selected); await loadEvent();
  }
}
initialize().catch((error) => {
  if (element('editPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else showMessage(error.message, 'danger');
});
