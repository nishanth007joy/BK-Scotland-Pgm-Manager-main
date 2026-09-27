const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let events = [];
let selectionVersion = 0;
let activeSaves = 0;
let participants = [];
let participantsLoaded = false;
const dirtyRows = new Set();

function populateEvents() {
  element('event').replaceChildren(new Option(events.length ? 'Select an event' : 'No events awaiting results', ''));
  const seen = new Set();
  events.forEach((row) => {
    if (seen.has(row.EventID)) return;
    seen.add(row.EventID);
    const ageGroups = [...new Set(events.filter(event => event.EventID === row.EventID).map(event => clean(event.EventAgeGroup)))].filter(Boolean);
    element('event').add(new Option(`${clean(row.EventName)} (${ageGroups.join(', ')})`, row.EventID));
  });
}

function removeCompletedSelection() {
  if (activeSaves || dirtyRows.size || !participantsLoaded || !participants.length
    || !participants.every(row => row.ResultExists && clean(row.ScoreLastEditedBy)
      && ((clean(row.EventAttendence) === 'Completed' && row.Score != null)
        || ['NoShow', 'WalkOver'].includes(clean(row.EventAttendence))))) return;
  const eventId = element('event').value;
  const ageGroup = element('ageGroup').value;
  events = events.filter(row => String(row.EventID) !== eventId || clean(row.EventAgeGroup) !== ageGroup);
  ++selectionVersion;
  participants = [];
  participantsLoaded = false;
  element('participants').replaceChildren();
  populateEvents();
  populateAgeGroups();
  lockSelection();
  element('listStatus').textContent = events.length
    ? 'All results saved for this event and age group. Choose another event above.'
    : 'All results have been entered. No events are awaiting results.';
}

function nextSelection() {
  const selections = [];
  events.forEach((row) => {
    const selection = { EventID: String(row.EventID), EventAgeGroup: clean(row.EventAgeGroup) };
    if (!selections.some((item) => item.EventID === selection.EventID && item.EventAgeGroup === selection.EventAgeGroup)) selections.push(selection);
  });
  const index = selections.findIndex((row) => row.EventID === element('event').value && row.EventAgeGroup === element('ageGroup').value);
  return index < 0 ? null : selections[index + 1];
}

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401
    ? 'Your session expired. Sign in again in another tab, then retry saving.'
    : data.message || 'Request failed. Please try again.');
  return data;
}
function showMessage(text) {
  element('message').textContent = text;
  element('message').className = 'alert alert-danger mt-3 mb-0';
}
function lockSelection() {
  const blocked = activeSaves > 0 || dirtyRows.size > 0;
  element('event').disabled = blocked || !events.length;
  element('ageGroup').disabled = blocked || !element('event').value;
  element('reload').disabled = blocked || !element('ageGroup').value;
  const next = nextSelection();
  element('nextEvent').disabled = blocked || !participantsLoaded || !next;
  const complete = participantsLoaded && participants.length > 0 && participants.every((row) => row.ResultExists);
  element('navigationStatus').textContent = activeSaves ? 'Saving results...'
    : dirtyRows.size ? 'Save or undo unsaved changes to move to another event.'
    : !participantsLoaded ? ''
    : `${complete ? 'All participant results are saved. ' : ''}${next ? 'Continue to the next event / age group, or choose one above.' : 'This is the last event / age group. You can choose another event above.'}`;
}
function addParticipant(row, selected, published, canEditPublished, singleParticipant) {
  const tr = document.createElement('tr');
  const name = `${clean(row.ContestantFirstName)} ${clean(row.ContestantLastName)} (${clean(row.ContestantID)})`;
  const cell = (text = '') => { const td = document.createElement('td'); td.textContent = text; tr.append(td); return td; };
  cell(clean(row.ContestantFirstName)); cell(clean(row.ContestantLastName));
  cell(clean(row.ContestantMission)); cell(clean(row.ChestNo));
  const attendanceCell = cell();
  const attendance = document.createElement('select');
  attendance.className = 'form-select';
  attendance.setAttribute('aria-label', `Event attendance for ${name}`);
  attendance.add(new Option('Completed', 'Completed'));
  attendance.add(new Option('NoShow', 'NoShow'));
  if (singleParticipant || clean(row.EventAttendence) === 'WalkOver') {
    const option = new Option('WalkOver', 'WalkOver');
    option.disabled = !singleParticipant;
    attendance.add(option);
  }
  attendance.value = ['NoShow', 'WalkOver'].includes(clean(row.EventAttendence)) ? clean(row.EventAttendence) : 'Completed';
  attendanceCell.append(attendance);
  const scoreCell = cell();
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.max = '2147483647'; input.step = '0.01';
  input.className = 'form-control'; input.style.minWidth = '7rem';
  input.setAttribute('aria-label', `Score for ${name}`);
  input.value = row.Score ?? '';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'btn btn-sm btn-primary mt-2';
  button.textContent = row.ResultExists && !clean(row.ScoreLastEditedBy) ? 'Save and record scorer' : 'Save result';
  button.setAttribute('aria-label', `Save result for ${name}`);
  const undo = document.createElement('button');
  undo.type = 'button'; undo.className = 'btn btn-sm btn-outline-secondary mt-2 ms-1'; undo.textContent = 'Undo';
  undo.setAttribute('aria-label', `Undo unsaved result for ${name}`);
  scoreCell.append(input, button, undo);
  const walkOver = document.createElement('button');
  walkOver.type = 'button'; walkOver.className = 'btn btn-sm btn-outline-primary mt-2 ms-1';
  walkOver.textContent = 'WalkOver';
  walkOver.title = 'Available only when exactly one participant is registered. No score is required.';
  walkOver.setAttribute('aria-label', `Record WalkOver for ${name}`);
  if (singleParticipant) scoreCell.append(walkOver);
  const scorer = cell(clean(row.ScoreLastEditedBy) || 'Unknown');
  const approval = cell(clean(row.CheckedApproved) || 'not approved');
  const status = cell(row.ResultExists ? 'Saved' : 'Not entered'); status.setAttribute('role', 'status');
  if (clean(row.EventAttendence) === 'WalkOver') status.textContent = `WalkOver: ${clean(row.Place)} place, ${row.Points} points.`;
  let savedScore = row.Score;
  let savedAttendance = row.EventAttendence ? clean(row.EventAttendence) : null;
  let resultExists = Boolean(row.ResultExists);
  let saving = false;
  const locked = (published && !canEditPublished) || row.RegistrationCount !== 1;
  if (published && !canEditPublished) status.textContent = 'Published. Only an administrator can edit.';
  function updateControls() {
    attendance.disabled = button.disabled = undo.disabled = locked || saving;
    input.disabled = locked || saving || attendance.value !== 'Completed';
    walkOver.disabled = locked || saving || !singleParticipant || (savedAttendance === 'WalkOver' && !dirtyRows.has(tr));
  }
  updateControls();
  if (row.RegistrationCount !== 1) status.textContent = 'Conflicting registrations. Correct them before scoring.';
  function markDirty() {
    const changed = attendance.value !== (['NoShow', 'WalkOver'].includes(savedAttendance) ? savedAttendance : 'Completed')
      || (attendance.value === 'Completed' && input.value !== String(savedScore ?? ''));
    if (changed) { dirtyRows.add(tr); status.textContent = 'Unsaved'; }
    else { dirtyRows.delete(tr); status.textContent = resultExists ? 'Saved' : 'Not entered'; }
    lockSelection();
    updateControls();
  }
  async function save() {
    if (saving || locked || (!dirtyRows.has(tr) && resultExists && clean(row.ScoreLastEditedBy))) return;
    if (attendance.value === 'Completed' && (!input.value.trim() || !input.checkValidity())) {
      status.textContent = 'Enter a non-negative score with up to two decimal places for Completed, or select NoShow.';
      input.reportValidity(); return;
    }
    saving = true; activeSaves++; updateControls(); lockSelection(); status.textContent = 'Saving...';
    try {
      const data = await readResponse(await fetch('/api/results', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selected, ContestantID: row.ContestantID,
          EventAttendence: attendance.value, Score: attendance.value !== 'Completed' ? null : Number(input.value),
          OriginalScore: savedScore, OriginalAttendence: savedAttendance }),
      }));
      savedScore = data.result.Score; savedAttendance = data.result.EventAttendence; resultExists = true;
      attendance.value = savedAttendance; input.value = savedScore ?? '';
      approval.textContent = data.result.CheckedApproved;
      row.ScoreLastEditedBy = data.result.ScoreLastEditedBy;
      row.ResultExists = 1;
      row.Score = savedScore;
      row.EventAttendence = savedAttendance;
      scorer.textContent = clean(row.ScoreLastEditedBy);
      button.textContent = 'Save result';
      dirtyRows.delete(tr); status.textContent = published ? 'Saved. Published places and points updated.' : 'Saved';
      if (savedAttendance === 'WalkOver') status.textContent = `WalkOver saved: ${data.result.Place} place, ${data.result.Points} points.${published ? ' Published results updated.' : ' Ready for review on Approve and Publish Results.'}`;
    } catch (error) { status.textContent = error.message; }
    finally { saving = false; activeSaves--; updateControls(); lockSelection(); removeCompletedSelection(); }
  }
  attendance.addEventListener('change', () => {
    if (attendance.value !== 'Completed') input.value = '';
    else if (savedAttendance === 'Completed') input.value = savedScore ?? '';
    updateControls(); markDirty();
  });
  input.addEventListener('input', markDirty);
  input.addEventListener('change', save);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } });
  button.addEventListener('click', save);
  walkOver.addEventListener('click', () => {
    if (walkOver.disabled) return;
    attendance.value = 'WalkOver'; input.value = '';
    markDirty();
    save();
  });
  undo.addEventListener('click', () => {
    attendance.value = ['NoShow', 'WalkOver'].includes(savedAttendance) ? savedAttendance : 'Completed';
    input.value = savedScore ?? ''; updateControls(); markDirty();
  });
  element('participants').append(tr);
}
async function loadParticipants() {
  const version = ++selectionVersion;
  participants = [];
  participantsLoaded = false;
  element('participants').replaceChildren();
  element('message').classList.add('d-none');
  lockSelection();
  if (!element('ageGroup').value) { element('listStatus').textContent = 'Choose an event and age group.'; return; }
  const selected = { EventID: element('event').value, EventAgeGroup: element('ageGroup').value };
  element('listStatus').textContent = 'Loading contestants and teams...';
  try {
    const data = await readResponse(await fetch(`/api/results/participants?${new URLSearchParams(selected)}`));
    if (version !== selectionVersion) return;
    participants = data.participants;
    participantsLoaded = true;
    const published = data.participants.some((row) => clean(row.CheckedApproved) === 'approved');
    data.participants.forEach((row) => addParticipant(row, selected, published, data.canEditPublished === true, data.participants.length === 1));
    lockSelection();
    element('listStatus').textContent = data.participants.length ? `${data.participants.length} registered contestants or teams` : 'No contestants or teams registered for this selection.';
    removeCompletedSelection();
  } catch (error) { if (version === selectionVersion) { element('listStatus').textContent = 'Unable to load contestants.'; showMessage(error.message); } }
}
function populateAgeGroups() {
  const groups = [...new Set(events.filter((row) => String(row.EventID) === element('event').value).map((row) => clean(row.EventAgeGroup)))];
  element('ageGroup').replaceChildren(new Option('Select an age group', ''));
  groups.forEach((group) => element('ageGroup').add(new Option(group, group)));
  if (groups.length === 1) element('ageGroup').value = groups[0];
}
element('event').addEventListener('change', () => {
  populateAgeGroups();
  loadParticipants();
});
element('nextEvent').addEventListener('click', () => {
  if (activeSaves || dirtyRows.size || !participantsLoaded) return;
  const next = nextSelection();
  if (!next) return;
  element('event').value = next.EventID;
  populateAgeGroups();
  element('ageGroup').value = next.EventAgeGroup;
  loadParticipants();
});
element('ageGroup').addEventListener('change', loadParticipants);
element('reload').addEventListener('click', loadParticipants);
window.addEventListener('beforeunload', (event) => {
  if (dirtyRows.size || activeSaves) { event.preventDefault(); event.returnValue = ''; }
});
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to enter results.'; return; }
  const user = await readResponse(session);
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none'); element('entryPanel').classList.remove('d-none');
  try {
    events = (await readResponse(await fetch('/api/results/options'))).events;
    populateEvents();
    if (!events.length) element('listStatus').textContent = 'No events are awaiting results.';
    lockSelection();
  } catch (error) { showMessage(error.message); }
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
