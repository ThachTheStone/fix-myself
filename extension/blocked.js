const element = (id) => document.getElementById(id);
const host = location.hash.slice(1);
const validHost = /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(host);
let current;
let requestingRelease = false;

function active() {
  return current?.endAt > Date.now() && current.domains.includes(host);
}

async function showAvailable() {
  element('heading').textContent = 'Site available';
  element('domain').textContent = '';
  element('time').textContent = '';
  element('next').hidden = true;
  if (validHost && !requestingRelease && element('continue').hidden) {
    requestingRelease = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'sync' });
      if (response.error) throw new Error(response.error);
      if (active()) return;
      element('continue').href = 'https://' + host;
      element('continue').hidden = false;
    } catch {
      element('domain').textContent = 'Open a new tab to try the site again.';
    } finally {
      requestingRelease = false;
    }
  }
}

function render() {
  if (!active()) {
    showAvailable();
    return;
  }
  element('heading').textContent = 'Focus in progress';
  element('continue').hidden = true;
  const seconds = Math.ceil((current.endAt - Date.now()) / 1000);
  element('domain').textContent = host + ' is blocked until your focus session ends.';
  element('time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  element('task').textContent = current.nextAction ?? 'Open Fix Myself and pick a task from Today.';
  element('next').hidden = false;
}

setInterval(render, 1000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.focus) {
    current = changes.focus.newValue;
    render();
  }
});

({ focus: current } = await chrome.storage.local.get('focus'));
// Count a blocked visit, but not a reload or a tab that was open when focus began.
const navigation = performance.getEntriesByType('navigation')[0];
if (active() && new URLSearchParams(location.search).get('from') !== 'start' && navigation?.type !== 'reload') {
  chrome.runtime.sendMessage({ type: 'attempt', host }).catch(() => {});
}
render();
