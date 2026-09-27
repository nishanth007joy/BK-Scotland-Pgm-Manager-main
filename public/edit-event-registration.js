const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();
let registrations = [], contestants = [], events = [], original = null;
function message(text, type) {
  element('message').textContent = text;
  element('message').className = `alert alert-${type} mt-3`;
}
async function read(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to complete the request.');
  return data;
}
function populateContestants(selected = '') {
  const event = events.find(row => row.EventID === element('EventID').value);
  const eligible = contestants.filter(row => event && (clean(event.IndividualGroup).toLowerCase() !== 'individual' || clean(row.AgeGroup).toLowerCase() === clean(event.EventAgeGroup).toLowerCase()));
  element('ContestantID').replaceChildren(new Option('Select a contestant', ''));
  eligible.forEach(row => element('ContestantID').add(new Option(`${row.ContestantFirstName} ${row.ContestantLastName} - ${row.ContestantMission} (${row.ContestantID})`, row.ContestantID)));
  if (eligible.some(row => row.ContestantID === selected)) element('ContestantID').value = selected;
}
async function loadRegistrations() {
  registrations = (await read(await fetch('/api/event-registrations'))).registrations;
  element('registrationPicker').value = '';
  element('registrationPicker').placeholder = 'Select or type to filter registrations';
  element('registrationPicker').disabled = false;
  closeRegistrations();
}
let activeRegistration = -1;
function registrationLabel(row) {
  return row.EventName + ' (' + row.EventAgeGroup + ') - ' + row.ContestantFirstName + ' ' + row.ContestantLastName + ' - ' + row.ContestantMission + ' (' + row.EventID + ' / ' + row.ContestantID + ')';
}
function closeRegistrations() {
  element('registrationResults').hidden = true;
  element('registrationPicker').setAttribute('aria-expanded', 'false');
  element('registrationPicker').removeAttribute('aria-activedescendant');
  activeRegistration = -1;
}
function renderRegistrations() {
  const picker = element('registrationPicker');
  if (picker.disabled) return;
  const list = element('registrationResults');
  const query = original ? '' : clean(picker.value).toLocaleLowerCase();
  list.replaceChildren();
  activeRegistration = -1;
  picker.removeAttribute('aria-activedescendant');
  registrations.forEach((row, index) => {
    const label = registrationLabel(row);
    if (!label.toLocaleLowerCase().includes(query)) return;
    const option = document.createElement('button');
    option.type = 'button';
    option.id = 'registration-option-' + index;
    option.className = 'list-group-item list-group-item-action';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(row === original));
    option.tabIndex = -1;
    option.textContent = label;
    option.addEventListener('mousedown', event => event.preventDefault());
    option.addEventListener('click', () => {
      original = row;
      picker.value = label;
      element('editForm').classList.remove('d-none');
      element('EventID').value = row.EventID;
      populateContestants(row.ContestantID);
      element('Comments').value = clean(row.Comments);
      picker.focus();
      closeRegistrations();
    });
    list.append(option);
  });
  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.setAttribute('role', 'status');
    empty.textContent = registrations.length ? 'No matching registrations' : 'No registrations available';
    list.append(empty);
  }
  list.hidden = false;
  picker.setAttribute('aria-expanded', 'true');
}
element('registrationPicker').addEventListener('input', () => {
  original = null;
  element('editForm').classList.add('d-none');
  renderRegistrations();
});
element('registrationPicker').addEventListener('focus', renderRegistrations);
element('registrationPicker').addEventListener('click', renderRegistrations);
element('registrationPicker').addEventListener('blur', closeRegistrations);
element('registrationPicker').addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key === 'Tab') { closeRegistrations(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  if (event.key === 'Enter') {
    if (activeRegistration >= 0) {
      event.preventDefault();
      element('registrationResults').querySelectorAll('[role="option"]')[activeRegistration]?.click();
    }
    return;
  }
  event.preventDefault();
  if (element('registrationResults').hidden) renderRegistrations();
  const options = element('registrationResults').querySelectorAll('[role="option"]');
  if (!options.length) return;
  activeRegistration = activeRegistration < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
    : (activeRegistration + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle('active', index === activeRegistration));
  element('registrationPicker').setAttribute('aria-activedescendant', options[activeRegistration].id);
  options[activeRegistration].scrollIntoView({ block: 'nearest' });
});

element('EventID').addEventListener('change', () => populateContestants(element('ContestantID').value));
element('editForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!original || !event.currentTarget.reportValidity()) return;
  closeRegistrations();
  const fields = ['registrationPicker', 'EventID', 'ContestantID', 'Comments', 'save'];
  fields.forEach(field => { element(field).disabled = true; });
  try {
    const result = await read(await fetch('/api/event-registrations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EventID: element('EventID').value, ContestantID: element('ContestantID').value, Comments: element('Comments').value, Original: original }),
    }));
    original = null;
    element('editForm').classList.add('d-none');
    message(result.message, 'success');
    await loadRegistrations();
  } catch (error) { message(error.message, 'danger'); }
  finally { fields.forEach(field => { element(field).disabled = false; }); }
});
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to edit registrations.'; return; }
  const user = await read(session);
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('editPanel').classList.remove('d-none');
  const options = await read(await fetch('/api/event-registration-options'));
  events = options.events; contestants = options.contestants;
  element('EventID').add(new Option('Select an event', ''));
  events.forEach(row => element('EventID').add(new Option(`${row.EventName} - ${row.EventAgeGroup} (${row.EventID})`, row.EventID)));
  await loadRegistrations();
}
initialize().catch(error => {
  if (element('editPanel').classList.contains('d-none')) element('accessMessage').textContent = error.message;
  else message(error.message, 'danger');
});
