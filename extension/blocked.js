// The intervention page for a focus session and for block rules (BLK-03,
// BLK-04). The worker decides why this site is covered, so this page never
// guesses and never offers a way around a Block rule.
const element = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const host = params.get('host') ?? location.hash.slice(1);
const validHost = /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(host);
const openedAt = Date.now();
let view = null;
let asking = false;

function send(message) {
  return chrome.runtime.sendMessage(message).then((answer = {}) => {
    if (answer.error) throw new Error(answer.error);
    return answer.result;
  });
}

const clock = (stamp) => new Date(stamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function countdown(seconds) {
  const left = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// Seconds left before the pause page offers a pass.
function pauseLeft() {
  if (view?.mode !== 'pause' || !view.countdownSeconds) return 0;
  return Math.max(0, view.countdownSeconds - Math.floor((Date.now() - openedAt) / 1000));
}

async function showAvailable() {
  element('heading').textContent = 'Site available';
  element('rule').hidden = true;
  element('domain').textContent = '';
  element('time').textContent = '';
  element('mission').hidden = true;
  element('next').hidden = true;
  element('pause').hidden = true;
  element('open-today').hidden = true;
  element('feedback').textContent = '';
  if (!validHost || asking || !element('continue').hidden) return;
  asking = true;
  try {
    await send({ type: 'sync' });
    await load();
    if (view?.mode) {
      render();
      return;
    }
    element('continue').href = 'https://' + host;
    element('continue').hidden = false;
  } catch {
    element('domain').textContent = 'Open a new tab to try the site again.';
  } finally {
    asking = false;
  }
}

function render() {
  if (!view) return;
  const mode = view.mode;
  if (!mode) {
    showAvailable();
    return;
  }
  element('continue').hidden = true;
  element('rule').hidden = !view.ruleName;
  element('rule').textContent = view.ruleName;
  element('open-today').hidden = false;
  element('mission').hidden = !view.mission;
  element('mission-text').textContent = view.mission;
  element('next').hidden = !view.nextAction;
  element('task').textContent = view.nextAction;
  if (mode === 'focus') {
    element('heading').textContent = 'Focus in progress';
    element('domain').textContent = host + ' is blocked until your focus session ends.';
    element('time').textContent = countdown((view.until - Date.now()) / 1000);
    element('pause').hidden = true;
    return;
  }
  if (mode === 'block') {
    element('heading').textContent = 'This site is blocked';
    element('domain').textContent = view.until
      ? `${host} is blocked until ${clock(view.until)}.`
      : `${host} is blocked while this rule is on.`;
    element('time').textContent = view.until ? clock(view.until) : '';
    element('pause').hidden = true;
    return;
  }
  const left = pauseLeft();
  element('heading').textContent = 'Paused for a moment';
  element('domain').textContent = view.until
    ? `${host} is paused until ${clock(view.until)}.`
    : `${host} is paused while this rule is on.`;
  element('time').textContent = left > 0 ? countdown(left) : '';
  element('pause').hidden = left > 0;
  element('continue-pass').textContent = view.passMinutes
    ? `Continue for ${view.passMinutes} minute${view.passMinutes === 1 ? '' : 's'}`
    : 'Continue';
}

async function load() {
  if (!validHost) return;
  try {
    view = await send({ type: 'intervention', host });
  } catch {
    view = { mode: null, host };
  }
}

element('open-today').addEventListener('click', async () => {
  element('feedback').textContent = '';
  try {
    await send({ type: 'show' });
    element('feedback').textContent = 'Fix Myself is open on your desktop.';
  } catch {
    element('feedback').textContent = 'Open Fix Myself from your desktop taskbar.';
  }
});

element('continue-pass').addEventListener('click', async () => {
  if (!view?.ruleId) return;
  element('feedback').textContent = '';
  element('continue-pass').disabled = true;
  try {
    await send({ type: 'pass', ruleId: view.ruleId, host, reason: element('reason').value });
    location.replace('https://' + host);
  } catch (error) {
    element('feedback').textContent = error.message;
    element('continue-pass').disabled = false;
  }
});

setInterval(render, 1000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.focus || changes.plan || changes.passes)) return;
  load().then(render).catch(() => {});
});

await load();
// Count a blocked visit, but not a reload or a tab that was open when the
// session or the rule started.
const navigation = performance.getEntriesByType('navigation')[0];
if (view?.mode === 'focus' && params.get('from') !== 'start' && navigation?.type !== 'reload') {
  send({ type: 'attempt', host }).catch(() => {});
}
render();
