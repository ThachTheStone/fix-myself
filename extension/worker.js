const endpoint = 'http://127.0.0.1:42631/v1/focus';
const refreshAlarm = 'refresh-focus';
const endAlarm = 'end-focus';
let pending = Promise.resolve();

function serialized(operation) {
  const running = pending.then(operation);
  pending = running.catch(console.error);
  return running;
}

function matchDomain(url, domains) {
  if (!url) return null;
  let site;
  try {
    site = new URL(url);
  } catch {
    return null;
  }
  if (site.protocol !== 'https:' && site.protocol !== 'http:') return null;
  return domains.find((domain) => site.hostname === domain || site.hostname.endsWith('.' + domain)) ?? null;
}

async function applyFocus(focus, previous) {
  const current = focus?.endAt > Date.now() ? focus : null;
  const domains = current?.domains ?? [];
  const rules = domains.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { url: chrome.runtime.getURL('blocked.html#' + domain) } },
    condition: { requestDomains: [domain], resourceTypes: ['main_frame'] }
  }));
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (oldRules.length !== rules.length
      || oldRules.some((rule, index) => rule.condition.requestDomains?.[0] !== domains[index])) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldRules.map((rule) => rule.id),
      addRules: rules
    });
  }
  if (current) {
    await chrome.alarms.create(endAlarm, { when: current.endAt });
    if (current.endAt !== previous?.endAt || JSON.stringify(domains) !== JSON.stringify(previous?.domains)) {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.map((tab) => {
        const domain = matchDomain(tab.pendingUrl ?? tab.url, domains);
        if (domain && tab.id !== undefined) {
          return chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('blocked.html#' + domain) });
        }
      }));
    }
  } else {
    await chrome.alarms.clear(endAlarm);
  }
}

async function readDesktop(token) {
  const response = await fetch(endpoint, {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error('Pairing code was rejected or the desktop app is unavailable.');
  const { focus } = await response.json();
  if (focus !== null && (!Number.isSafeInteger(focus?.endAt) || !Array.isArray(focus.domains)
      || !focus.domains.every((domain) => typeof domain === 'string'))) {
    throw new Error('Unexpected desktop response.');
  }
  return focus;
}

async function sync(tokenOverride) {
  const { token, focus: previous } = await chrome.storage.local.get(['token', 'focus']);
  const candidate = tokenOverride ?? token;
  let focus = previous?.endAt > Date.now() ? previous : null;
  let connected = false;
  if (candidate) {
    try {
      focus = await readDesktop(candidate);
      connected = true;
    } catch (error) {
      if (tokenOverride) throw error;
    }
  }
  if (!candidate) focus = null;
  if (focus?.endAt <= Date.now()) focus = null;
  await chrome.storage.local.set({ token: tokenOverride ?? token ?? '', focus, connected });
  await applyFocus(focus, previous);
  return { paired: Boolean(candidate), connected, focus };
}

async function startup() {
  if (!(await chrome.alarms.get(refreshAlarm))) {
    await chrome.alarms.create(refreshAlarm, { periodInMinutes: 0.5 });
  }
  return sync();
}

chrome.runtime.onInstalled.addListener(() => { serialized(startup).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { serialized(startup).catch(console.error); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === refreshAlarm || alarm.name === endAlarm) serialized(sync).catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let operation;
  if (message?.type === 'sync') operation = startup;
  if (message?.type === 'pair' && /^[a-f0-9]{64}$/.test(message.token)) {
    operation = async () => {
      const { focus } = await chrome.storage.local.get('focus');
      if (focus?.endAt > Date.now()) throw new Error('Change pairing after the focus session ends.');
      await startup();
      return sync(message.token);
    };
  }
  if (!operation) return false;
  serialized(operation).then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message })
  );
  return true;
});
