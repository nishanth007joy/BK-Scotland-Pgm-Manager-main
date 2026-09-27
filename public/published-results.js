const element = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').trim();
let results = [];
let exporting = false;
let loaded = false;
let printing = false;
let pendingPrintRows = null;
let initialSelection = new URLSearchParams(window.location.search);

function visibleResults() {
  return results.filter(row => (!element('event').value || clean(row.EventName) === element('event').value)
    && (!element('ageGroup').value || clean(row.EventAgeGroup) === element('ageGroup').value));
}

async function printCertificate() {
  if (element('printCertificate').disabled || exporting) return;
  const rows = visibleResults();
  const row = { EventName: element('event').value, EventAgeGroup: element('ageGroup').value };
  exporting = true;
  render();
  element('message').classList.add('d-none');
  try {
    const response = await fetch('/api/results/certificate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || 'Unable to export the certificate.');
    }
    const data = await response.json();
    rows.forEach(item => { item.CertificatePrinted = 'Yes'; });
    element('message').textContent = `Certificate Excel file saved to ${data.filePath}`;
    element('message').classList.remove('d-none', 'alert-danger');
    element('message').classList.add('alert-success');
  } catch (error) {
    element('message').classList.remove('alert-success');
    element('message').classList.add('alert-danger');
    element('message').textContent = `${error.message} Refresh the list to check the certificate status before retrying.`;
    element('message').classList.remove('d-none');
  } finally { exporting = false; render(); }
}

function populateFilter(id, values, label) {
  const select = element(id);
  const previous = select.value;
  select.replaceChildren(new Option(label, ''));
  [...new Set(values.map(clean))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach((value) => select.add(new Option(value, value)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function updateAgeGroups() {
  const selected = element('event').value;
  populateFilter('ageGroup', results.filter((row) => !selected || clean(row.EventName) === selected)
    .map((row) => row.EventAgeGroup), 'All age groups');
}

function render() {
  const visible = visibleResults();
  element('printSelection').textContent = `${element('event').value || 'All events'} | ${element('ageGroup').value || 'All age groups'}`;
  element('printEventResults').disabled = exporting || printing || !loaded || !visible.length;
  element('printPublicResults').disabled = element('printEventResults').disabled;
  const body = element('publishedResults');
  body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    for (const field of ['EventName', 'EventAgeGroup', 'EventID', 'IndividualGroup', 'OnStageOffStage',
      'Place', 'ContestantFirstName', 'ContestantLastName', 'ContestantMission', 'ChestNo', 'Score', 'Points']) {
      const td = document.createElement('td');
      td.textContent = field === 'Score' && row.IsWalkOver ? 'WalkOver' : clean(row[field]);
      tr.append(td);
    }
    const status = document.createElement('td');
    status.textContent = clean(row.CertificatePrinted);
    tr.append(status);
    const resultsStatus = document.createElement('td');
    resultsStatus.textContent = clean(row.ResultsPrinted) || 'No';
    tr.append(resultsStatus);
    body.append(tr);
  }
  element('listStatus').textContent = !results.length ? 'No results have been published yet.'
    : !visible.length ? 'No published results match these filters.'
    : `${visible.length} of ${results.length} published results shown.`;
  element('reload').disabled = exporting || printing;
  element('event').disabled = element('ageGroup').disabled = exporting || printing || !loaded || !results.length;
  element('printCertificate').disabled = exporting || printing || !loaded || !element('event').value || !element('ageGroup').value
    || !visible.some(row => clean(row.CertificatePrinted).toLowerCase() === 'no');
  element('printCertificate').textContent = exporting ? 'Exporting...' : 'Print Certificate';
}

async function loadResults() {
  if (exporting || printing) return;
  loaded = false;
  element('printEventResults').disabled = true;
  element('printPublicResults').disabled = true;
  element('printCertificate').disabled = true;
  element('reload').disabled = true;
  element('event').disabled = element('ageGroup').disabled = true;
  element('message').classList.add('d-none');
  element('publishedResults').replaceChildren();
  element('listStatus').textContent = 'Loading published results...';
  try {
    const response = await fetch('/api/results/published', { cache: 'no-store' });
    if (response.status === 401) throw new Error('Your session expired. Sign in again to view published results.');
    if (!response.ok) throw new Error('Unable to load published results. Restart the server if this page was recently added, then try again.');
    const data = await response.json();
    results = data.results;
    loaded = true;
    populateFilter('event', results.map((row) => row.EventName), 'All events');
    if (initialSelection?.has('event')) element('event').value = initialSelection.get('event');
    updateAgeGroups();
    if (initialSelection?.has('ageGroup')) element('ageGroup').value = initialSelection.get('ageGroup');
    initialSelection = null;
    render();
    element('event').disabled = element('ageGroup').disabled = !results.length;
  } catch (error) {
    element('message').classList.remove('alert-success');
    element('message').classList.add('alert-danger');
    element('message').textContent = error.message;
    element('message').classList.remove('d-none');
    element('listStatus').textContent = 'Unable to load published results.';
  } finally { element('reload').disabled = false; }
}

element('event').addEventListener('change', () => { updateAgeGroups(); render(); });
element('ageGroup').addEventListener('change', render);
element('reload').addEventListener('click', loadResults);
element('printCertificate').addEventListener('click', printCertificate);
window.addEventListener('beforeprint', () => {
  element('printDateTime').textContent = `Timestamp: ${new Date().toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
  })}`;
});
function renderPublicPrint(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([clean(row.EventName), clean(row.EventAgeGroup)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const container = element('publicPrintResults');
  container.replaceChildren();
  const compare = (a, b) => clean(a).localeCompare(clean(b), undefined, { numeric: true });
  const ordered = [...groups.values()].sort((a, b) => compare(a[0].EventName, b[0].EventName)
    || compare(a[0].EventAgeGroup, b[0].EventAgeGroup));
  for (const group of ordered) {
    const section = document.createElement('section');
    section.className = 'public-result-group';
    const heading = document.createElement('h2');
    heading.textContent = document.querySelector('.print-heading h2').textContent;
    const title = document.createElement('h3');
    const age = clean(group[0].EventAgeGroup) || 'Unspecified age group';
    title.textContent = `${clean(group[0].EventName) || 'Unnamed event'} — ${age}`;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    for (const label of ['Place', 'Contestant / team', 'Mission', 'Chest no.', 'Age category', 'Points']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      header.append(th);
    }
    head.append(header);
    const body = document.createElement('tbody');
    const rank = row => ({ First: 1, Second: 2, Third: 3 }[clean(row.Place)] || 99);
    for (const row of [...group].sort((a, b) => rank(a) - rank(b))) {
      const tr = document.createElement('tr');
      for (const value of [row.Place,
        [clean(row.ContestantFirstName), clean(row.ContestantLastName)].filter(Boolean).join(' '),
        row.ContestantMission, row.ChestNo, age, row.Points]) {
        const td = document.createElement('td');
        td.textContent = clean(value);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(head, body);
    section.append(heading, title, table);
    container.append(section);
  }
}

function printResults(publicFormat = false) {
  if (element('printEventResults').disabled || !loaded || !visibleResults().length) return;
  pendingPrintRows = [...visibleResults()];
  if (publicFormat) renderPublicPrint(pendingPrintRows);
  document.body.classList.toggle('public-results-print', publicFormat);
  printing = true;
  render();
  window.print();
}

element('printEventResults').addEventListener('click', () => printResults());
element('printPublicResults').addEventListener('click', () => printResults(true));

function confirmResultsPrinted() {
  const dialog = element('printConfirmation');
  dialog.returnValue = 'no';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true });
    dialog.showModal();
  });
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('public-results-print');
  if (!pendingPrintRows) return;
  const rows = pendingPrintRows;
  pendingPrintRows = null;
  setTimeout(async () => {
    try {
      if (!await confirmResultsPrinted()) return;
      const response = await fetch('/api/results/printed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ EventID, EventAgeGroup, ContestantID }) => ({ EventID, EventAgeGroup, ContestantID })) }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Unable to save results printed status.');
      }
      rows.forEach(row => { row.ResultsPrinted = 'Yes'; });
      element('message').textContent = 'Results marked as printed.';
      element('message').classList.remove('d-none', 'alert-danger');
      element('message').classList.add('alert-success');
    } catch (error) {
      element('message').textContent = error.message;
      element('message').classList.remove('d-none', 'alert-success');
      element('message').classList.add('alert-danger');
    } finally { printing = false; render(); }
  }, 0);
});

async function initialize() {
  const response = await fetch('/api/session', { method: 'POST' });
  if (!response.ok) {
    element('accessMessage').innerHTML = 'Please <a href="/">sign in</a> to view published results.';
    return;
  }
  const user = await response.json();
  element('signedInAs').textContent = `Signed in as ${user.name}`;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  await loadResults();
}
initialize().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page.'; });
