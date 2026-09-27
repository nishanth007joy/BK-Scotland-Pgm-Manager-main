const element = id => document.getElementById(id);
let token;
async function read(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}
async function load() {
  const data = await read(await fetch('/api/admin/delete-users'));
  token = data.token;
  element('user').replaceChildren(new Option('Select a user', ''));
  data.users.forEach(user => element('user').add(new Option(`${user.name} (${user.email}) - ${user.role}`, user.email)));
  element('deleteUser').disabled = true;
  element('panel').classList.remove('d-none');
}
element('user').addEventListener('change', () => { element('deleteUser').disabled = !element('user').value; });
element('deleteUser').addEventListener('click', async () => {
  const picker = element('user'); const email = picker.value;
  if (!email || !window.confirm(`Delete the login account for ${picker.selectedOptions[0].textContent}? All associated records will be retained.`)) return;
  picker.disabled = true; element('deleteUser').disabled = true;
  try {
    const data = await read(await fetch('/api/admin/delete-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token, confirmed: true }) }));
    element('message').textContent = data.message;
    await load();
  } catch (error) { element('message').textContent = error.message; }
  finally { picker.disabled = false; element('deleteUser').disabled = !picker.value; }
});
load().then(() => { element('message').textContent = ''; }).catch(error => { element('message').textContent = error.message; });
