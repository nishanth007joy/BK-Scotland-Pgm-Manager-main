const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();

async function loadEvents() {
  element('reload').disabled = true;
  element('message').classList.add('d-none');
  element('events').replaceChildren();
  element('listStatus').textContent = 'Loading results...';
  try {
    const response = await fetch('/api/results/published', { cache: 'no-store' });
    if (response.status === 401) throw new Error('Your session expired. Sign in again to view results.');
    if (!response.ok) throw new Error('Unable to load results. Please try again.');
    const data = await response.json();
    const groups = new Map();
    for (const row of data.results) {
      if (clean(row.ResultsPrinted).toLowerCase() !== 'no') continue;
      const event = clean(row.EventName);
      const ageGroup = clean(row.EventAgeGroup);
      const key = JSON.stringify([event, ageGroup]);
      if (!groups.has(key)) groups.set(key, { event, ageGroup, count: 0 });
      groups.get(key).count++;
    }
    const events = [...groups.values()].sort((a, b) => a.event.localeCompare(b.event)
      || a.ageGroup.localeCompare(b.ageGroup, undefined, { numeric: true }));
    for (const event of events) {
      const tr = document.createElement('tr');
      for (const value of [event.event, event.ageGroup, event.count]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      const action = document.createElement('td');
      const link = document.createElement('a');
      link.href = `/published-results.html?${new URLSearchParams({ event: event.event, ageGroup: event.ageGroup })}`;
      link.textContent = 'View / print results';
      action.append(link);
      tr.append(action);
      element('events').append(tr);
    }
    element('listStatus').textContent = events.length
      ? `${events.length} event and age group selections pending results printing.`
      : 'No published events have results marked as not printed.';
  } catch (error) {
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Unable to load results.';
  } finally { element('reload').disabled = false; }
}

element('reload').addEventListener('click', loadEvents);
async function initialize() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) {
    element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view results.';
    return;
  }
  const user = await response.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  await loadEvents();
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
