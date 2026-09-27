const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let reviewer = '';
let options = [];
let participants = [];
let checks = [];
let busy = false;
let version = 0;
let admin = false;
let editing = false;

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
  return data;
}
function showError(message) {
  element('message').textContent = message;
  element('message').classList.remove('d-none');
}
function updateButton() {
  let reason = '';
  if (editing) reason = 'Save or cancel the mark edit before reviewing or publishing.';
  else if (busy) reason = 'Publishing results...';
  else if (!participants.length) reason = 'Select an event with saved results.';
  else if (participants.some(row => clean(row.CheckedApproved) === 'approved'))
    reason = 'These results have already been published.';
  else if (participants.some(row => row.RegistrationCount !== 1))
    reason = 'Conflicting registrations must be corrected before publishing.';
  else if (participants.some(row => !row.ResultExists))
    reason = 'Save a result for every registered participant before publishing.';
  else if (participants.some(row => !clean(row.ScoreLastEditedBy)))
    reason = 'Some results have no entry user. Save them again on Results entry.';
  else if (participants.some(row => clean(row.ScoreLastEditedBy).toLowerCase() === clean(reviewer).toLowerCase()))
    reason = 'You entered or last edited a result in this event. A different user must sign in to review and publish it, including WalkOver results.';
  else if (checks.length !== participants.length || checks.some(box => !box.checked))
    reason = 'Tick Reviewed for every result. For WalkOver, review First place and points; no score is required.';
  element('savePublish').disabled = Boolean(reason);
  element('publishHint').textContent = reason || 'All results reviewed. Select Save publish to publish them.';
  element('event').disabled = busy || editing;
  document.querySelectorAll('[data-edit-mark]').forEach(button => { button.disabled = busy || editing; });
}
function renderRows() {
  element('participants').replaceChildren();
  checks = [];
  const published = participants.some(row => clean(row.CheckedApproved) === 'approved');
  for (const row of participants) {
    const tr = document.createElement('tr');
    const cell = (value) => { const td = document.createElement('td'); td.textContent = value; tr.append(td); return td; };
    cell(`${clean(row.ContestantFirstName)} ${clean(row.ContestantLastName)} (${clean(row.ContestantID)})`);
    cell(clean(row.ContestantMission)); cell(clean(row.ChestNo));
    cell(row.ResultExists ? clean(row.EventAttendence) : 'Not saved');
    cell(clean(row.Place) || '-');
    cell(row.Points == null ? '-' : String(row.Points));
    const scoreCell = cell(row.ResultExists ? (clean(row.EventAttendence) === 'WalkOver' ? 'Not required' : String(row.Score ?? '—')) : 'Not saved');
    if ((admin || !published) && row.ResultExists && row.RegistrationCount === 1 && clean(row.EventAttendence) === 'Completed') {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'btn btn-sm btn-outline-primary ms-2';
      edit.textContent = 'Edit mark'; edit.setAttribute('data-edit-mark', '');
      edit.addEventListener('click', () => {
        if (busy || editing) return;
        editing = true;
        checks.forEach(box => { box.checked = false; });
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '2147483647'; input.step = '0.01';
        input.className = 'form-control'; input.value = row.Score ?? '';
        input.setAttribute('aria-label', `Mark for ${clean(row.ContestantFirstName)} ${clean(row.ContestantLastName)}`);
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'btn btn-sm btn-primary mt-2'; save.textContent = 'Save mark';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'btn btn-sm btn-outline-secondary mt-2 ms-2'; cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => { editing = false; renderRows(); });
        save.addEventListener('click', async () => {
          if (busy) return;
          if (!input.value.trim() || !input.checkValidity()) {
            showError('Enter a non-negative mark with up to two decimal places.');
            input.reportValidity(); return;
          }
          const selected = options.find(item => `${item.EventID}|${item.EventAgeGroup}` === element('event').value);
          busy = true; input.disabled = save.disabled = cancel.disabled = true; updateButton();
          element('message').classList.add('d-none');
          try {
            const data = await readResponse(await fetch('/api/results', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ EventID: selected.EventID, EventAgeGroup: selected.EventAgeGroup,
                ContestantID: row.ContestantID, EventAttendence: 'Completed', Score: Number(input.value),
                OriginalScore: row.Score, OriginalAttendence: clean(row.EventAttendence) }),
            }));
            Object.assign(row, data.result);
            editing = false;
            renderRows();
            element('listStatus').textContent = 'Mark saved. A different user must review and publish this event and age group.';
          } catch (error) { showError(error.message); }
          finally {
            busy = false; input.disabled = save.disabled = cancel.disabled = false; updateButton();
          }
        });
        scoreCell.replaceChildren(input, save, cancel);
        updateButton(); input.focus();
      });
      scoreCell.append(edit);
    }
    cell(clean(row.ScoreLastEditedBy) || 'Unknown');
    const commentsCell = cell(clean(row.Comments));
    commentsCell.style.whiteSpace = 'pre-wrap';
    const td = cell('');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.className = 'form-check-input';
    box.setAttribute('aria-label', `I reviewed ${clean(row.ContestantFirstName)} ${clean(row.ContestantLastName)}'s ${clean(row.EventAttendence) === 'WalkOver' ? 'WalkOver, First place, and points' : 'attendance and score'}`);
    box.disabled = !row.ResultExists || !clean(row.ScoreLastEditedBy)
      || clean(row.CheckedApproved) === 'approved';
    box.addEventListener('change', updateButton);
    const label = document.createElement('label');
    label.className = 'd-inline-flex align-items-center gap-2';
    label.append(box, document.createTextNode('Reviewed'));
    td.append(label); checks.push(box);
    element('participants').append(tr);
  }
  updateButton();
}
async function loadRows() {
  const current = ++version;
  participants = []; checks = [];
  element('participants').replaceChildren();
  element('message').classList.add('d-none');
  updateButton();
  const selected = options.find((row) => `${row.EventID}|${row.EventAgeGroup}` === element('event').value);
  if (!selected) { element('listStatus').textContent = 'Select an event to review its results.'; return; }
  element('listStatus').textContent = 'Loading saved results...';
  try {
    const data = await readResponse(await fetch(`/api/results/participants?${new URLSearchParams({
      EventID: selected.EventID, EventAgeGroup: selected.EventAgeGroup,
    })}`));
    if (current !== version) return;
    participants = data.participants;
    renderRows();
    element('listStatus').textContent = `${participants.length} registered contestant(s). Review every saved result before publishing.`;
  } catch (error) { if (current === version) showError(error.message); }
}
async function loadOptions() {
  options = [];
  element('event').replaceChildren(new Option('Loading events...', ''));
  try {
    options = (await readResponse(await fetch('/api/results/publish-options', { cache: 'no-store' }))).events;
    element('event').replaceChildren(new Option(options.length ? 'Select an event and age group' : 'No events with saved scores', ''));
    options.forEach((row) => element('event').add(new Option(
      `${clean(row.EventName)} — ${clean(row.EventAgeGroup)} (${clean(row.EventID)})`,
      `${row.EventID}|${row.EventAgeGroup}`)));
  } catch (error) {
    element('event').replaceChildren(new Option('Unable to load events. Reload the page.', ''));
    throw error;
  }
}

element('event').addEventListener('change', loadRows);
window.addEventListener('beforeunload', event => {
  if (editing || busy) { event.preventDefault(); event.returnValue = ''; }
});
element('savePublish').addEventListener('click', async () => {
  if (element('savePublish').disabled) return;
  const selected = options.find((row) => `${row.EventID}|${row.EventAgeGroup}` === element('event').value);
  busy = true; updateButton(); element('message').classList.add('d-none');
  try {
    const data = await readResponse(await fetch('/api/results/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EventID: selected.EventID, EventAgeGroup: selected.EventAgeGroup,
        ReviewedResults: participants.map((row) => ({ ContestantID: row.ContestantID,
          EventAttendence: clean(row.EventAttendence), Score: row.Score, Place: row.Place, Points: row.Points })) }),
    }));
    element('listStatus').textContent = `${data.publishedCount} top place(s) published. Scores are locked.`;
  } catch (error) {
    showError(error.message);
    element('listStatus').textContent = 'Select an event to review its results.';
  } finally {
    ++version;
    participants = []; checks = [];
    element('participants').replaceChildren();
    try { await loadOptions(); }
    catch (error) {
      const previous = element('message').classList.contains('d-none') ? '' : `${element('message').textContent} `;
      showError(`${previous}Unable to refresh events: ${error.message} Reload the page to try again.`);
    }
    busy = false; updateButton();
  }
});
async function initialize() {
  const session = await fetch('/api/session', { method: 'POST' });
  if (!session.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to publish results.'; return; }
  const user = await readResponse(session);
  reviewer = clean(user.name);
  admin = user.isAdmin === true;
  element('signedInAs').textContent = `Signed in as ${reviewer}`;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  try {
    await loadOptions();
    updateButton();
  } catch (error) { showError(error.message); }
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
