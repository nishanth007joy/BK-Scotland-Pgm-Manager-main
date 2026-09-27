const element = (id) => document.getElementById(id);
let events = [];
let allEvents = [];
let contestants = [];
let saving = false;
const clean = (value) => String(value ?? '').trim();

function matchesEventAgeGroup(event, contestant) {
  if (clean(event?.IndividualGroup).toLowerCase() !== 'individual') return true;
  const ageGroup = clean(event?.EventAgeGroup).toLowerCase();
  return Boolean(ageGroup) && ageGroup === clean(contestant?.AgeGroup).toLowerCase();
}

async function readResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    throw new Error(response.status === 404
      ? 'The registration service is unavailable. Restart the application server and reload this page.'
      : `The server returned an unexpected response (HTTP ${response.status}). Please reload the page or restart the application server.`);
  }
  if (!response.ok) throw new Error(data.message || `Request failed (HTTP ${response.status}).`);
  return data;
}

function showMessage(text, type) {
  element('message').textContent = text;
  element('message').className = `alert mt-3 mb-0 alert-${type}`;
}

function updateSelection() {
  const event = events.find((row) => row.EventID === element('EventID').value);
  const contestant = contestants.find((row) => row.ContestantID === element('ContestantID').value);
  for (const field of ['EventName', 'EventAgeGroup', 'IndividualGroup', 'OnStageOffStage']) {
    element(field).value = clean(event?.[field]);
  }
  for (const field of ['ContestantFirstName', 'ContestantLastName', 'ContestantMission']) {
    element(field).value = clean(contestant?.[field]);
  }
  const stage = clean(event?.OnStageOffStage).toLowerCase().replace(/[ -]/g, '');
  const chestNo = stage === 'onstage' ? contestant?.OnStageChestNo : stage === 'offstage' ? contestant?.OffStageChestNo : '';
  element('ChestNo').value = clean(chestNo);
  let hint = 'Select an event and contestant.';
  if (event && contestant) {
    hint = !matchesEventAgeGroup(event, contestant) ? 'Individual events require the contestant to be in the same age group as the event. Choose a matching contestant.'
      : !['onstage', 'offstage'].includes(stage) ? 'This event has an unsupported stage. Update the event before registering.'
      : !clean(chestNo) ? 'This contestant has no chest number for the selected stage. Update the contestant before registering.'
      : `Using the contestant's ${stage === 'onstage' ? 'on-stage' : 'off-stage'} chest number.`;
  }
  element('selectionHint').textContent = hint;
  element('saveButton').disabled = saving || !event || !contestant || !clean(chestNo) || !matchesEventAgeGroup(event, contestant);
}

let visibleEvents = [];
let activeEvent = -1;
let eventIdCounts = new Map();

function closeEvents() {
  element('eventResults').hidden = true;
  element('eventFilter').setAttribute('aria-expanded', 'false');
  element('eventFilter').removeAttribute('aria-activedescendant');
  activeEvent = -1;
}

function chooseEvent(index) {
  const row = visibleEvents[index];
  if (!row || eventIdCounts.get(row.EventID) !== 1) return;
  element('EventID').value = row.EventID;
  element('eventFilter').value = `${clean(row.EventID)} - ${clean(row.EventName)} (${clean(row.EventAgeGroup)})`;
  element('eventFilter').setCustomValidity('');
  element('eventCount').textContent = 'Event selected. Edit the text to choose another.';
  closeEvents();
  element('ContestantID').value = '';
  element('contestantFilter').value = '';
  element('contestantFilter').setCustomValidity('');
  closeContestants();
  element('contestantCount').textContent = 'Type a name, then choose a matching contestant.';
  updateSelection();
}

function filterEvents() {
  const query = element('EventID').value ? '' : clean(element('eventFilter').value).toLocaleLowerCase();
  const matches = events.filter((row) => [row.EventID, row.EventName, row.EventAgeGroup]
    .some((value) => clean(value).toLocaleLowerCase().includes(query)));
  visibleEvents = matches.slice(0, 50);
  activeEvent = -1;
  const list = element('eventResults');
  list.replaceChildren();
  element('eventFilter').removeAttribute('aria-activedescendant');
  visibleEvents.forEach((row, index) => {
    const option = document.createElement('div');
    option.id = 'event-option-' + index;
    option.className = 'list-group-item list-group-item-action';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const duplicate = eventIdCounts.get(row.EventID) !== 1;
    option.setAttribute('aria-disabled', String(duplicate));
    option.textContent = `${clean(row.EventID)} - ${clean(row.EventName)} (${clean(row.EventAgeGroup)})${duplicate ? ' (duplicate ID)' : ''}`;
    if (duplicate) option.classList.add('disabled');
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => chooseEvent(index));
    list.append(option);
  });
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.textContent = 'No matching events.';
    list.append(empty);
  }
  element('eventCount').textContent = matches.length > 50
    ? `Showing the first 50 of ${matches.length} matches. Type more letters to narrow the list.`
    : `${matches.length} matches. Choose an event, or use the arrow keys and Enter.`;
  list.hidden = false;
  element('eventFilter').setAttribute('aria-expanded', 'true');
}

let visibleContestants = [];
let activeContestant = -1;
let contestantIdCounts = new Map();

function closeContestants() {
  element('contestantResults').hidden = true;
  element('contestantFilter').setAttribute('aria-expanded', 'false');
  element('contestantFilter').removeAttribute('aria-activedescendant');
  activeContestant = -1;
}

function chooseContestant(index) {
  const row = visibleContestants[index];
  if (!row || contestantIdCounts.get(row.ContestantID) !== 1) return;
  element('ContestantID').value = row.ContestantID;
  element('contestantFilter').value = clean(row.ContestantFirstName) + ' ' + clean(row.ContestantLastName) + ' - ' + clean(row.ContestantID) + ' (' + clean(row.ContestantMission) + ')';
  element('contestantFilter').setCustomValidity('');
  element('contestantCount').textContent = 'Contestant selected. Edit the name to choose someone else.';
  closeContestants();
  updateSelection();
}

function filterContestants() {
  const event = events.find((row) => row.EventID === element('EventID').value);
  const prefix = element('ContestantID').value ? '' : clean(element('contestantFilter').value).toLocaleLowerCase();
  const matches = contestants.filter((row) => {
    if (!matchesEventAgeGroup(event, row)) return false;
    const first = clean(row.ContestantFirstName).toLocaleLowerCase();
    const last = clean(row.ContestantLastName).toLocaleLowerCase();
    return first.startsWith(prefix) || last.startsWith(prefix) || (first + ' ' + last).startsWith(prefix);
  });
  // Keep the dropdown responsive when the contestant list is large.
  visibleContestants = matches.slice(0, 50);
  activeContestant = -1;
  const list = element('contestantResults');
  list.replaceChildren();
  element('contestantFilter').removeAttribute('aria-activedescendant');
  visibleContestants.forEach((row, index) => {
    const option = document.createElement('div');
    option.id = 'contestant-option-' + index;
    option.className = 'list-group-item list-group-item-action';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const duplicate = contestantIdCounts.get(row.ContestantID) !== 1;
    option.setAttribute('aria-disabled', String(duplicate));
    option.textContent = clean(row.ContestantFirstName) + ' ' + clean(row.ContestantLastName) + ' - ' + clean(row.ContestantID) + ' (' + clean(row.ContestantMission) + ')' + (duplicate ? ' (duplicate ID)' : '');
    if (duplicate) option.classList.add('disabled');
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => chooseContestant(index));
    list.append(option);
  });
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.textContent = clean(event?.IndividualGroup).toLowerCase() === 'individual'
      ? `No matching contestants in age group ${clean(event.EventAgeGroup)}.`
      : 'No matching contestants.';
    list.append(empty);
  }
  element('contestantCount').textContent = matches.length > 50
    ? 'Showing the first 50 of ' + matches.length + ' matches. Type more letters to narrow the list.'
    : matches.length + ' matches. Choose a contestant, or use the arrow keys and Enter.';
  list.hidden = false;
  element('contestantFilter').setAttribute('aria-expanded', 'true');
}

async function verifySession() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) {
    element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to register for events.';
    return;
  }
  const session = await readResponse(response);
  element('signedInAs').textContent = `Signed in as ${session.name}`;
  if (session.isAdmin) element('adminLink').classList.remove('d-none');
  element('accessDenied').classList.replace('d-flex', 'd-none');
  element('entryPanel').classList.remove('d-none');
  try {
    const response = await fetch('/api/event-registration-options');
    const data = await readResponse(response);
    allEvents = data.events;
    events = allEvents.filter((row) => clean(row.IndividualGroup).toLowerCase() === 'individual');
    eventIdCounts = new Map();
    for (const row of allEvents) eventIdCounts.set(row.EventID, (eventIdCounts.get(row.EventID) || 0) + 1);
    contestants = data.contestants;
    // Servers started before AgeGroup was added to registration options may
    // still serve the old response while serving this updated browser script.
    if (contestants.some((row) => !Object.prototype.hasOwnProperty.call(row, 'AgeGroup'))) {
      const details = await readResponse(await fetch('/api/contestants'));
      const ages = new Map(details.contestants.map((row) => [clean(row.ContestantID), row.AgeGroup]));
      contestants = contestants.map((row) => Object.prototype.hasOwnProperty.call(row, 'AgeGroup')
        ? row : { ...row, AgeGroup: ages.get(clean(row.ContestantID)) });
      if (contestants.some((row) => row.AgeGroup === undefined)) {
        throw new Error('Unable to load contestant age groups. Restart the application server and reload this page.');
      }
    }
    element('eventFilter').disabled = events.length === 0;
    element('contestantFilter').disabled = false;
    contestantIdCounts = new Map();
    for (const row of contestants) contestantIdCounts.set(row.ContestantID, (contestantIdCounts.get(row.ContestantID) || 0) + 1);
    if (!events.length || !contestants.length) showMessage('Add at least one Individual event and contestant before creating a registration.', 'warning');
    updateSelection();
  } catch (error) { showMessage(error.message, 'danger'); }
}

element('eventFilter').addEventListener('input', () => {
  element('EventID').value = '';
  element('eventFilter').setCustomValidity('Choose an event from the matching events.');
  element('ContestantID').value = '';
  element('contestantFilter').value = '';
  element('contestantFilter').setCustomValidity('');
  closeContestants();
  updateSelection();
  filterEvents();
});
element('eventFilter').addEventListener('focus', filterEvents);
element('eventFilter').addEventListener('click', filterEvents);
element('eventFilter').addEventListener('blur', closeEvents);
element('eventFilter').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeEvents(); return; }
  if (event.key === 'Enter' && !element('eventResults').hidden) {
    event.preventDefault();
    chooseEvent(activeEvent);
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  if (element('eventResults').hidden) filterEvents();
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  let next = activeEvent < 0 && direction === -1 ? 0 : activeEvent;
  for (let tries = 0; tries < visibleEvents.length; tries++) {
    next = (next + direction + visibleEvents.length) % visibleEvents.length;
    if (eventIdCounts.get(visibleEvents[next].EventID) === 1) { activeEvent = next; break; }
  }
  Array.from(element('eventResults').children).forEach((option, index) => {
    option.classList.toggle('active', index === activeEvent);
    option.setAttribute('aria-selected', String(index === activeEvent));
  });
  if (activeEvent >= 0) {
    const option = element('event-option-' + activeEvent);
    element('eventFilter').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }
});
element('ContestantID').addEventListener('change', updateSelection);
element('contestantFilter').addEventListener('input', () => {
  element('ContestantID').value = '';
  element('contestantFilter').setCustomValidity('Choose a contestant from the matching names.');
  updateSelection();
  filterContestants();
});
element('contestantFilter').addEventListener('focus', filterContestants);
element('contestantFilter').addEventListener('click', filterContestants);
element('contestantFilter').addEventListener('blur', closeContestants);
element('contestantFilter').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeContestants(); return; }
  if (event.key === 'Enter' && !element('contestantResults').hidden) {
    event.preventDefault();
    chooseContestant(activeContestant);
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  if (element('contestantResults').hidden) filterContestants();
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  let next = activeContestant < 0 && direction === -1 ? 0 : activeContestant;
  for (let tries = 0; tries < visibleContestants.length; tries++) {
    next = (next + direction + visibleContestants.length) % visibleContestants.length;
    if (contestantIdCounts.get(visibleContestants[next].ContestantID) === 1) {
      activeContestant = next;
      break;
    }
  }
  Array.from(element('contestantResults').children).forEach((option, index) => {
    option.classList.toggle('active', index === activeContestant);
    option.setAttribute('aria-selected', String(index === activeContestant));
  });
  if (activeContestant >= 0) {
    const option = element('contestant-option-' + activeContestant);
    element('contestantFilter').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }
});
element('registrationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || !event.currentTarget.reportValidity() || element('saveButton').disabled) return;
  const data = { EventID: element('EventID').value, ContestantID: element('ContestantID').value, Comments: element('Comments').value };
  saving = true;
  updateSelection();
  element('saveButton').textContent = 'Saving...';
  try {
    const response = await fetch('/api/event-registrations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await readResponse(response);
    showMessage(result.message, 'success');
    element('registrationForm').reset();
    element('EventID').value = '';
    element('eventFilter').setCustomValidity('');
    element('eventCount').textContent = 'Type to find an event, then choose a match.';
    closeEvents();
    element('ContestantID').value = '';
    element('contestantFilter').setCustomValidity('');
    element('contestantCount').textContent = 'Type a name, then choose a matching contestant.';
    closeContestants();
    element('eventFilter').focus();
  } catch (error) { showMessage(error.message || 'Unable to contact the server.', 'danger'); }
  finally {
    saving = false;
    element('saveButton').textContent = 'Save registration';
    updateSelection();
  }
});
verifySession().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Please reload the page.'; });
