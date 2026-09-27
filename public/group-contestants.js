const element = id => document.getElementById(id);
const memberFields = ['GroupLeaderID', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}ID`)];
let allContestants = [], ageCategories = [], groupEvents = [];
const editing = location.pathname.endsWith('/edit-group-registration.html');
let originalGroup = null, savedGroups = [];
let visibleEvents = [], activeEvent = -1;
let visibleLeaders = [], activeLeader = -1;
function closeLeaders() {
  element('leaderResults').hidden = true;
  element('leaderFilter').setAttribute('aria-expanded', 'false');
  element('leaderFilter').removeAttribute('aria-activedescendant');
  activeLeader = -1;
}
function chooseLeader(index) {
  const option = visibleLeaders[index];
  if (!option) return;
  element('GroupLeaderID').value = option.value;
  element('leaderFilter').value = option.textContent;
  element('leaderFilter').setCustomValidity('');
  element('leaderCount').textContent = 'Group leader selected. Edit the text to choose someone else.';
  closeLeaders();
  updateGroupName();
}
function filterLeaders() {
  const query = element('GroupLeaderID').value ? '' : element('leaderFilter').value.trim().toLocaleLowerCase();
  const matches = Array.from(element('GroupLeaderID').options).filter(option => option.value &&
    option.textContent.toLocaleLowerCase().includes(query));
  visibleLeaders = matches.slice(0, 50);
  activeLeader = -1;
  const list = element('leaderResults');
  list.replaceChildren();
  element('leaderFilter').removeAttribute('aria-activedescendant');
  visibleLeaders.forEach((leader, index) => {
    const option = document.createElement('div');
    option.id = `leader-option-${index}`;
    option.className = 'list-group-item list-group-item-action';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = leader.textContent;
    option.addEventListener('mousedown', action => action.preventDefault());
    option.addEventListener('click', () => chooseLeader(index));
    list.append(option);
  });
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.textContent = 'No matching eligible group leaders.';
    list.append(empty);
  }
  element('leaderCount').textContent = matches.length > 50
    ? `Showing the first 50 of ${matches.length} matches. Type more letters to narrow the list.`
    : `${matches.length} matches. Choose a group leader, or use the arrow keys and Enter.`;
  list.hidden = false;
  element('leaderFilter').setAttribute('aria-expanded', 'true');
}
function closeEvents() {
  element('eventResults').hidden = true;
  element('eventFilter').setAttribute('aria-expanded', 'false');
  element('eventFilter').removeAttribute('aria-activedescendant');
  activeEvent = -1;
}
function chooseEvent(index) {
  const selected = visibleEvents[index];
  if (!selected) return;
  element('EventID').value = selected.EventID;
  element('eventFilter').value = `${selected.EventName} - ${selected.EventAgeGroup} (${selected.EventID})`;
  element('eventFilter').setCustomValidity('');
  element('eventCount').textContent = 'Group event selected. Edit the text to choose another.';
  closeEvents();
  element('EventID').dispatchEvent(new Event('change'));
}
function filterEvents() {
  const query = element('EventID').value ? '' : element('eventFilter').value.trim().toLocaleLowerCase();
  const matches = groupEvents.filter(event => [event.EventName, event.EventAgeGroup, event.EventID]
    .some(value => String(value ?? '').toLocaleLowerCase().includes(query)));
  visibleEvents = matches.slice(0, 50);
  activeEvent = -1;
  const list = element('eventResults');
  list.replaceChildren();
  element('eventFilter').removeAttribute('aria-activedescendant');
  visibleEvents.forEach((event, index) => {
    const option = document.createElement('div');
    option.id = `event-option-${index}`;
    option.className = 'list-group-item list-group-item-action';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = `${event.EventName} - ${event.EventAgeGroup} (${event.EventID})`;
    option.addEventListener('mousedown', action => action.preventDefault());
    option.addEventListener('click', () => chooseEvent(index));
    list.append(option);
  });
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.textContent = 'No matching group events.';
    list.append(empty);
  }
  element('eventCount').textContent = matches.length > 50
    ? `Showing the first 50 of ${matches.length} matches. Type more letters to narrow the list.`
    : `${matches.length} matches. Choose a group event, or use the arrow keys and Enter.`;
  list.hidden = false;
  element('eventFilter').setAttribute('aria-expanded', 'true');
}
function updateGroupName() {
  const name = element('GroupLeaderID').selectedOptions[0]?.dataset.name;
  element('GroupName').value = name ? `${name} & Team` : '';
}
function filterMembers() {
  const selectedEvent = groupEvents.find(event => event.EventID === element('EventID').value);
  for (const field of memberFields) {
    const select = element(field);
    const previous = select.value;
    select.replaceChildren(new Option(field === 'GroupLeaderID' ? 'Select a group leader' : 'None', ''));
    allContestants.filter(contestant => groupEligibility.eligible(contestant,
      element('Mission').value, element('AgeGroup').value, ageCategories, field === 'GroupLeaderID', selectedEvent?.EventName))
      .forEach(contestant => {
        const name = `${contestant.FirstName.trim()} ${contestant.LastName.trim()}`;
        const option = new Option(`${name} (${contestant.ContestantID}) - ${contestant.AgeGroup}`, contestant.ContestantID);
        option.dataset.name = name;
        select.add(option);
      });
    select.value = Array.from(select.options).some(option => option.value === previous) ? previous : '';
    select.disabled = !element('Mission').value || !element('AgeGroup').value;
  }
  updateGroupName();
  if (element('leaderFilter')) {
    const selected = element('GroupLeaderID').selectedOptions[0];
    element('leaderFilter').value = selected?.value ? selected.textContent : '';
    element('leaderFilter').disabled = element('GroupLeaderID').disabled;
    element('leaderFilter').setCustomValidity('');
    element('leaderCount').textContent = selected?.value
      ? 'Group leader selected. Edit the text to choose someone else.'
      : 'Type to find a group leader, then choose a match.';
    closeLeaders();
  }
}
function showMessage(message, type) {
  element('message').textContent = message;
  element('message').className = `alert mt-3 alert-${type}`;
}
async function getData(url, method = 'GET') {
  const response = await fetch(url, { method });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to load group entry options.');
  return data;
}
async function initialize() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) { element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to add group contestants.'; return; }
  const user = await response.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  if (user.isAdmin) element('adminLink').classList.remove('d-none');
  element('accessDenied').classList.replace('d-flex', 'd-none');
  element('entryPanel').classList.remove('d-none');
  try {
    const [missions, ages, contestants, events] = await Promise.all([
      getData('/api/missions', 'POST'), getData('/api/age-categories', 'POST'), getData('/api/contestants'),
      getData('/api/group-contestant-events'),
    ]);
    allContestants = contestants.contestants;
    ageCategories = ages.ageCategories.map(age => age.name);
    groupEvents = events.events;
    element('EventID').add(new Option('Select a group event', ''));
    events.events.forEach(event => element('EventID').add(new Option(
      `${event.EventName} - ${event.EventAgeGroup} (${event.EventID})`, event.EventID)));
    if (!events.events.length) throw new Error('No Group events are available. Add a Group event first, then reload this page.');
    element('Mission').add(new Option('Select a mission', ''));
    missions.missions.forEach(mission => {
      const option = new Option(mission.name, mission.name);
      option.dataset.region = mission.region ?? '';
      element('Mission').add(option);
    });
    filterMembers();
    element('groupFields').disabled = false;
    if (editing) {
      await loadGroups();
      element('groupFields').disabled = true;
    }
  } catch (error) { showMessage(error.message, 'danger'); }
}
async function loadGroups() {
  savedGroups = (await getData('/api/group-contestants')).groups;
  element('groupPicker').replaceChildren(new Option('Select a group registration', ''));
  savedGroups.forEach((group, index) => element('groupPicker').add(new Option(`${group.GroupName} - ${group.EventName || 'Unassigned event'} (${group.ID})`, String(index))));
}
if (editing) element('groupPicker').addEventListener('change', () => {
  originalGroup = element('groupPicker').value === '' ? null : savedGroups[Number(element('groupPicker').value)];
  element('groupFields').disabled = !originalGroup;
  element('groupForm').reset();
  if (!originalGroup) { filterMembers(); return; }
  for (const field of ['EventID', 'Mission', 'Region', 'ChestNo', 'Comments']) element(field).value = originalGroup[field]?.trim() ?? '';
  element('AgeGroup').value = groupEvents.find(event => event.EventID === element('EventID').value)?.EventAgeGroup.trim() ?? '';
  filterMembers();
  let missing = false;
  for (const field of memberFields) {
    const value = originalGroup[field]?.trim() ?? '';
    if (Array.from(element(field).options).some(option => option.value === value)) element(field).value = value;
    else { element(field).value = ''; missing = true; }
  }
  updateGroupName();
  if (missing) showMessage('Some saved members no longer meet the current eligibility rules. Review the participant selections before saving.', 'warning');
});
element('Mission').addEventListener('change', () => {
  element('Region').value = element('Mission').selectedOptions[0]?.dataset.region ?? '';
  filterMembers();
});
element('EventID').addEventListener('change', () => {
  element('AgeGroup').value = groupEvents.find(event => event.EventID === element('EventID').value)?.EventAgeGroup.trim() ?? '';
  filterMembers();
});
if (element('eventFilter')) {
  element('eventFilter').addEventListener('input', () => {
    element('EventID').value = '';
    element('eventFilter').setCustomValidity('Choose a group event from the matching events.');
    element('EventID').dispatchEvent(new Event('change'));
    filterEvents();
  });
  element('eventFilter').addEventListener('focus', filterEvents);
  element('eventFilter').addEventListener('click', filterEvents);
  element('eventFilter').addEventListener('blur', closeEvents);
  element('eventFilter').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeEvents(); return; }
    if (event.key === 'Enter' && !element('eventResults').hidden) {
      event.preventDefault();
      chooseEvent(activeEvent);
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (element('eventResults').hidden) filterEvents();
    if (!visibleEvents.length) return;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    activeEvent = (activeEvent + direction + visibleEvents.length) % visibleEvents.length;
    Array.from(element('eventResults').children).forEach((option, index) => {
      option.classList.toggle('active', index === activeEvent);
      option.setAttribute('aria-selected', String(index === activeEvent));
    });
    const option = element(`event-option-${activeEvent}`);
    element('eventFilter').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  });
}
element('GroupLeaderID').addEventListener('change', updateGroupName);
if (element('leaderFilter')) {
  element('leaderFilter').addEventListener('input', () => {
    element('GroupLeaderID').value = '';
    element('leaderFilter').setCustomValidity('Choose a group leader from the matching names.');
    updateGroupName();
    filterLeaders();
  });
  element('leaderFilter').addEventListener('focus', filterLeaders);
  element('leaderFilter').addEventListener('click', filterLeaders);
  element('leaderFilter').addEventListener('blur', closeLeaders);
  element('leaderFilter').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeLeaders(); return; }
    if (event.key === 'Enter' && !element('leaderResults').hidden) {
      event.preventDefault();
      chooseLeader(activeLeader);
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (element('leaderResults').hidden) filterLeaders();
    if (!visibleLeaders.length) return;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    activeLeader = (activeLeader + direction + visibleLeaders.length) % visibleLeaders.length;
    Array.from(element('leaderResults').children).forEach((option, index) => {
      option.classList.toggle('active', index === activeLeader);
      option.setAttribute('aria-selected', String(index === activeLeader));
    });
    const option = element(`leader-option-${activeLeader}`);
    element('leaderFilter').setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  });
}
element('groupForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (editing && !originalGroup) return;
  const fields = ['EventID', 'GroupName', 'AgeGroup', 'Mission', 'Region', 'ChestNo', 'Comments', ...memberFields];
  const data = Object.fromEntries(fields.map(field => [field, element(field).value.trim()]));
  if (editing) data.Original = originalGroup;
  const members = memberFields.map(field => data[field]).filter(Boolean);
  if (new Set(members).size !== members.length) { showMessage('Select each contestant only once, including the group leader.', 'danger'); return; }
  element('groupFields').disabled = true;
  if (editing) element('groupPicker').disabled = true;
  element('saveButton').textContent = 'Saving...';
  try {
    const response = await fetch('/api/group-contestants', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save the group contestant.');
    element('groupForm').reset();
    if (element('eventFilter')) {
      element('EventID').value = '';
      element('eventFilter').setCustomValidity('');
      element('eventCount').textContent = 'Type to find a group event, then choose a match.';
      closeEvents();
    }
    filterMembers();
    if (element('leaderFilter')) {
      element('leaderFilter').setCustomValidity('');
      element('leaderCount').textContent = 'Type to find a group leader, then choose a match.';
      closeLeaders();
    }
    if (editing) { originalGroup = null; await loadGroups(); }
    showMessage(result.message, 'success');
  } catch (error) { showMessage(error.message || 'Unable to contact the server.', 'danger'); }
  finally {
    element('groupFields').disabled = editing && !originalGroup;
    if (editing) element('groupPicker').disabled = false;
    element('saveButton').textContent = editing ? 'Save changes' : 'Save group contestant';
  }
});
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session.'; });
