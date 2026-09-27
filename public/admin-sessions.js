const element = id => document.getElementById(id);
function message(text, error = false) {
  element('message').textContent = text;
  element('message').className = 'alert mt-3 mb-0 ' + (error ? 'alert-danger' : 'alert-success');
}
async function loadSessions() {
  element('reload').disabled = true;
  try {
    const response = await fetch('/api/admin/sessions', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    element('sessions').replaceChildren();
    for (const session of data.sessions) {
      const row = document.createElement('tr');
      for (const value of [session.account, new Date(session.lastActive).toLocaleString(), new Date(session.expires).toLocaleString()]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      const cell = document.createElement('td');
      const button = document.createElement('button');
      button.className = 'btn btn-sm btn-outline-danger';
      button.textContent = session.current ? 'Your session' : 'Release session';
      button.disabled = session.current;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const response = await fetch('/api/admin/sessions/release', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: session.account, id: session.id }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message);
          message(data.message);
          await loadSessions();
        } catch (error) { message(error.message, true); button.disabled = false; }
      });
      cell.append(button); row.append(cell); element('sessions').append(row);
    }
    element('listStatus').textContent = data.sessions.length + ' active sessions.';
  } catch (error) { message(error.message, true); }
  finally { element('reload').disabled = false; }
}
element('reload').addEventListener('click', loadSessions);
(async () => {
  const response = await fetch('/api/session', { method: 'POST' });
  const user = await response.json();
  if (!response.ok || !user.isAdmin) {
    element('accessMessage').textContent = 'Sign in as an administrator to manage sessions.';
    return;
  }
  element('signedInAs').textContent = 'Signed in as ' + user.name;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  await loadSessions();
})().catch(() => { element('accessMessage').textContent = 'Unable to verify your session.'; });
