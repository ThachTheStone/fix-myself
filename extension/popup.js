const form = document.getElementById('pair-form');
const status = document.getElementById('status');
const feedback = document.getElementById('feedback');
const refresh = document.getElementById('refresh');

async function send(message) {
  feedback.textContent = '';
  refresh.disabled = true;
  form.querySelector('button').disabled = true;
  try {
    const { result, error } = await chrome.runtime.sendMessage(message);
    if (error) throw new Error(error);
    form.hidden = result.connected || Boolean(result.focus);
    if (result.focus) status.textContent = result.connected ? 'Focus is active.' : 'Using the saved focus session.';
    else if (result.connected) status.textContent = 'Paired. No active focus session.';
    else if (result.paired) status.textContent = 'Open Fix Myself to reconnect.';
    else status.textContent = 'Open Fix Myself → Settings → Pair Chrome.';
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    refresh.disabled = false;
    form.querySelector('button').disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = document.getElementById('token').value.trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    feedback.textContent = 'Paste the pairing code from the desktop app.';
    return;
  }
  send({ type: 'pair', token });
});

refresh.addEventListener('click', () => send({ type: 'sync' }));
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('profile-name');
chrome.storage.local.get('profileName').then(({ profileName }) => { nameInput.value = profileName ?? ''; });
nameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({ type: 'name', name: nameInput.value });
});
send({ type: 'sync' });
