const element = id => document.getElementById(id);
function message(text, error = false) {
  element('message').textContent = text;
  element('message').className = 'alert mt-3 mb-0 ' + (error ? 'alert-danger' : 'alert-success');
}
function showName(name) {
  element('currentEventName').value = name;
  element('eventLabel').textContent = name;
  document.title = 'Current event name | ' + name;
}
element('eventForm').addEventListener('submit', async event => {
  event.preventDefault();
  const currentEventName = element('currentEventName').value.trim();
  if (!currentEventName) {
    message('Enter a current event name.', true);
    element('currentEventName').focus();
    return;
  }
  element('save').disabled = true;
  element('currentEventName').disabled = true;
  try {
    const response = await fetch('/api/current-event', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentEventName }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to save current event name.');
    showName(data.currentEventName);
    message(data.message);
  } catch (error) { message(error.message, true); }
  finally {
    element('save').disabled = false;
    element('currentEventName').disabled = false;
  }
});
(async () => {
  const response = await fetch('/api/session', { method: 'POST' });
  const user = await response.json();
  if (!response.ok || !user.isAdmin) {
    element('accessMessage').textContent = 'Sign in as an administrator to change the current event name.';
    return;
  }
  element('signedInAs').textContent = 'Signed in as ' + user.name;
  element('accessDenied').classList.add('d-none');
  element('panel').classList.remove('d-none');
  try {
    const response = await fetch('/api/current-event', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load current event name.');
    showName(data.currentEventName);
    element('message').textContent = '';
    element('save').disabled = false;
    element('currentEventName').disabled = false;
  } catch (error) { message(error.message + ' Reload the page to try again.', true); }
})().catch(() => { element('accessMessage').textContent = 'Unable to verify your session. Reload the page to try again.'; });
