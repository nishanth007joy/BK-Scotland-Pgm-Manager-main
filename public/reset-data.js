const element = id => document.getElementById(id);
let token;
let busy = false;
async function readResponse(response) {
  if (response.status === 404) {
    throw new Error('The running server has not loaded the delete feature. Restart the application, sign in again, then reopen this page.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The server returned an unexpected response. Refresh the page or restart the application.');
  }
  return response.json();
}
function updateButton() {
  element('deleteButton').disabled = busy || !token || !element('backup').checked
    || element('confirmation').value !== 'DELETE COMPETITION DATA';
}
element('backup').addEventListener('change', updateButton);
element('confirmation').addEventListener('input', updateButton);
element('resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (element('deleteButton').disabled) return;
  busy = true;
  updateButton();
  element('message').textContent = 'Deleting competition data...';
  try {
    const response = await fetch('/api/admin/reset-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, confirmation: element('confirmation').value, backupConfirmed: element('backup').checked }),
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.message);
    element('message').textContent = data.message;
    element('resetForm').hidden = true;
    element('counts').querySelectorAll('tr').forEach(row => { row.lastElementChild.textContent = '0'; });
  } catch (error) {
    element('message').textContent = `${error.message || 'Unable to confirm deletion.'} Reload this page to check current counts before retrying.`;
  } finally {
    token = null;
    busy = false;
    updateButton();
  }
});
(async () => {
  const sessionResponse = await fetch('/api/session', { method: 'POST' });
  const session = await readResponse(sessionResponse);
  if (!sessionResponse.ok || !session.isAdmin) {
    element('accessHeading').textContent = sessionResponse.status === 401 ? 'Sign-in required' : 'Administrator access required';
    element('accessMessage').textContent = 'Sign in as an administrator to delete competition data.';
    return;
  }
  const response = await fetch('/api/admin/reset-data', { cache: 'no-store' });
  const data = await readResponse(response);
  if (!response.ok) throw new Error(data.message);
  token = data.token;
  for (const table of data.tables) {
    const row = document.createElement('tr');
    for (const value of [table.TableName, table.RowCount]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    element('counts').append(row);
  }
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
})().catch(error => {
  element('accessHeading').textContent = 'Unable to load delete page';
  element('accessMessage').textContent = error.message || 'Unable to load reset details.';
});
