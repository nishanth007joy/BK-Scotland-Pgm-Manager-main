const element = id => document.getElementById(id);
const clean = value => String(value ?? '').trim();
let scrolling = true;
let loading = false;
let lastFrame = null;
let holdUntil = 0;
let position = 0;
let atBottom = false;
let nextRefresh = 0;
let refreshPending = false;
let updatesRevision = '';
let updatesStopped = false;
let knownResults = null;
const resultKey = row => JSON.stringify([clean(row.EventID), clean(row.EventAgeGroup), clean(row.ContestantID)]);

async function watchPublications() {
  if (updatesStopped) return;
  let retryDelay = 0;
  try {
    const response = await fetch(`/api/results/updates?since=${encodeURIComponent(updatesRevision)}`, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      updatesStopped = true;
      await loadResults();
      return;
    }
    if (!response.ok) throw new Error('Publication notifications unavailable.');
    const { revision } = await response.json();
    if (revision !== updatesRevision) {
      updatesRevision = revision;
      await loadResults();
    }
  } catch {
    retryDelay = 2000;
  }
  if (!updatesStopped) setTimeout(watchPublications, retryDelay);
}

function renderResults(rows, addedResults = new Set()) {
  let newResultCard = null;
  const events = new Map();
  for (const row of rows) {
    const event = clean(row.EventName) || 'Unnamed event';
    const age = clean(row.EventAgeGroup) || 'Unspecified age group';
    if (!events.has(event)) events.set(event, new Map());
    const groups = events.get(event);
    if (!groups.has(age)) groups.set(age, []);
    groups.get(age).push(row);
  }
  const fragment = document.createDocumentFragment();
  for (const [event, groups] of events) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.className = 'text-primary mb-3';
    heading.textContent = event;
    section.append(heading);
    for (const [age, results] of groups) {
      const card = document.createElement('section');
      card.className = 'result-group card border-0 shadow-sm p-3 p-md-4';
      if (!newResultCard && results.some(row => addedResults.has(resultKey(row)))) newResultCard = card;
      const title = document.createElement('h3');
      title.className = 'h4 mb-3';
      title.textContent = `${event} — ${age}`;
      const wrapper = document.createElement('div');
      wrapper.className = 'table-responsive';
      const table = document.createElement('table');
      table.setAttribute('role', 'table');
      table.className = 'table align-middle mb-0';
      const caption = document.createElement('caption');
      caption.className = 'visually-hidden';
      caption.textContent = `${event} — ${age}`;
      const head = document.createElement('thead');
      head.setAttribute('role', 'rowgroup');
      const headerRow = document.createElement('tr');
      headerRow.setAttribute('role', 'row');
      const labels = ['Place', 'Contestant / team', 'Mission', 'Chest no.', 'Age category', 'Points'];
      for (const label of labels) {
        const th = document.createElement('th');
        th.setAttribute('role', 'columnheader');
        th.scope = 'col';
        th.textContent = label;
        headerRow.append(th);
      }
      head.append(headerRow);
      const body = document.createElement('tbody');
      body.setAttribute('role', 'rowgroup');
      const rank = row => ({ First: 1, Second: 2, Third: 3 }[clean(row.Place)] || 99);
      for (const row of [...results].sort((a, b) => rank(a) - rank(b))) {
        const tr = document.createElement('tr');
        tr.setAttribute('role', 'row');
        const values = [row.Place, [clean(row.ContestantFirstName), clean(row.ContestantLastName)].filter(Boolean).join(' '),
          row.ContestantMission, row.ChestNo, age, row.Points];
        for (const [index, value] of values.entries()) {
          const td = document.createElement('td');
          td.setAttribute('role', 'cell');
          const label = document.createElement('span');
          label.className = 'mobile-label';
          label.setAttribute('aria-hidden', 'true');
          label.textContent = labels[index];
          const content = document.createElement('span');
          content.textContent = clean(value);
          td.append(label, content);
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(caption, head, body);
      wrapper.append(table);
      card.append(title, wrapper);
      section.append(card);
    }
    fragment.append(section);
  }
  element('resultGroups').replaceChildren(fragment);
  element('listStatus').textContent = rows.length
    ? `${rows.length} published results · ${events.size} events`
    : 'No results have been published yet.';
  return newResultCard;
}

async function loadResults() {
  if (loading) { refreshPending = true; return; }
  loading = true;
  element('reload').disabled = true;
  element('message').classList.add('d-none');
  try {
    const response = await fetch('/api/results/published', { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      updatesStopped = true;
      refreshPending = false;
      element('panel').classList.add('d-none');
      element('accessDenied').classList.remove('d-none');
      element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view published results.';
      return;
    }
    if (!response.ok) throw new Error('Unable to load published results. Try Refresh again.');
    const data = await response.json();
    const keys = new Set(data.results.map(resultKey));
    const added = new Set(knownResults === null ? [] : [...keys].filter(key => !knownResults.has(key)));
    const viewport = element('resultsViewport');
    const previousPosition = viewport.scrollTop;
    const newResultCard = renderResults(data.results, added);
    viewport.scrollTop = previousPosition;
    if (newResultCard) {
      viewport.scrollTop += newResultCard.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      atBottom = false;
      holdUntil = performance.now() + 10000;
    } else if (knownResults === null) {
      viewport.scrollTop = 0;
      holdUntil = performance.now() + 3000;
    }
    position = viewport.scrollTop;
    knownResults = keys;
  } catch (error) {
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Results could not be refreshed.';
  } finally {
    loading = false;
    nextRefresh = performance.now() + 30000;
    element('reload').disabled = false;
    if (refreshPending) {
      refreshPending = false;
      void loadResults();
    }
  }
}

function animate(time) {
  const elapsed = lastFrame === null ? 0 : Math.min(time - lastFrame, 100);
  lastFrame = time;
  const viewport = element('resultsViewport');
  const maximum = viewport.scrollHeight - viewport.clientHeight;
  if (scrolling && !loading && !document.hidden && maximum > 0 && time >= holdUntil) {
    if (atBottom) {
      viewport.scrollTop = position = 0;
      atBottom = false;
      holdUntil = time + 3000;
      void loadResults();
    } else {
      if (Math.abs(viewport.scrollTop - position) > 2) position = viewport.scrollTop;
      position = Math.min(maximum, position + elapsed * 0.035);
      viewport.scrollTop = position;
      if (position >= maximum) {
        atBottom = true;
        holdUntil = time + 3000;
      }
    }
  }
  // Short or empty boards still pick up new publications without needing to scroll.
  if (scrolling && !loading && !document.hidden && maximum <= 0 && time >= nextRefresh) void loadResults();
  requestAnimationFrame(animate);
}

element('toggleScroll').addEventListener('click', () => {
  scrolling = !scrolling;
  element('toggleScroll').textContent = scrolling ? 'Pause scrolling' : 'Resume scrolling';
  element('toggleScroll').setAttribute('aria-pressed', String(scrolling));
  position = element('resultsViewport').scrollTop;
  atBottom = false;
  holdUntil = performance.now() + 1000;
});
element('reload').addEventListener('click', loadResults);

async function initialize() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) {
    element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view published results.';
    return;
  }
  const user = await response.json();
  if (user.role !== 'resultboard' && clean(user.name).toLowerCase() !== 'resultboard') {
    element('homeLink').classList.remove('d-none');
  }
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  await loadResults();
  void watchPublications();
  requestAnimationFrame(animate);
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
