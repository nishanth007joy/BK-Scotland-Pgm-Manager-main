const element = id => document.getElementById(id);
let token;
async function readResponse(response) {
  if (response.status === 404) throw new Error('Restart the application and sign in again to load the password reset feature.');
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected server response. Refresh the page.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to complete the request.');
  return data;
}
(async () => {
  const data = await readResponse(await fetch('/api/admin/password-users', { cache: 'no-store' }));
  token = data.token;
  for (const user of data.users) {
    const option = document.createElement('option');
    option.value = user.email;
    option.textContent = `${user.name} (${user.email})`;
    element('user').append(option);
  }
  element('status').textContent = data.users.length ? 'Select another user to reset their password.' : 'There are no other users.';
  if (data.users.length) element('resetForm').classList.remove('d-none');
})().catch(error => { element('status').textContent = error.message; });
element('resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (element('resetButton').disabled) return;
  if (element('password').value !== element('confirmPassword').value) {
    element('status').textContent = 'Passwords do not match.';
    return;
  }
  element('resetButton').disabled = true;
  element('status').textContent = 'Resetting password...';
  try {
    const data = await readResponse(await fetch('/api/admin/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: element('user').value, password: element('password').value, token }),
    }));
    element('status').textContent = data.message;
    element('resetForm').reset();
  } catch (error) {
    element('status').textContent = error.message;
  } finally {
    element('password').value = '';
    element('confirmPassword').value = '';
    element('resetButton').disabled = false;
  }
});
