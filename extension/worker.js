// Chrome half of the block rules (BLK-03 to BLK-07). The extension keeps the
// last rule set the desktop app published and evaluates the shared schedule
// itself, so rules keep applying while the desktop app is closed or offline.
import { activeRules, effectiveRules } from './block-schedule.js';

const desktopOrigin = 'http://127.0.0.1:42631';
const endpoint = desktopOrigin + '/v1/focus';
const KEEP_DAYS = 35;
const refreshAlarm = 'refresh-focus';
const endAlarm = 'end-focus';
const passAlarm = 'end-pass';
// Focus outranks Block, and Block outranks Pause (BLK-05).
const PRIORITY = { pause: 1, block: 2, focus: 3 };
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

const emptyPlan = () => ({ rules: [], pendingChanges: [], timeZone: null, mission: '', nextAction: '' });

// The bridge validates the payload before it reaches Chrome; this check keeps a
// broken or unexpected response from replacing a working rule set.
function planOf(value) {
  if (!value || typeof value !== 'object') return null;
  const { rules, pendingChanges, timeZone, mission, nextAction } = value;
  if (!Array.isArray(rules) || !Array.isArray(pendingChanges)) return null;
  const sound = rules.every((rule) => rule && typeof rule.id === 'string' && typeof rule.name === 'string'
    && Array.isArray(rule.domains) && rule.domains.every((domain) => typeof domain === 'string')
    && (rule.strength === 'block' || rule.strength === 'pause'));
  if (!sound) return null;
  if (!pendingChanges.every((change) => change && typeof change.id === 'string' && change.change)) return null;
  if (timeZone !== null && timeZone !== undefined && typeof timeZone !== 'string') return null;
  if (typeof mission !== 'string' || typeof nextAction !== 'string') return null;
  return { rules, pendingChanges, timeZone: timeZone ?? null, mission, nextAction };
}

function focusOf(value) {
  if (value === null || value === undefined) return { ok: true, focus: null };
  const sound = Number.isSafeInteger(value.endAt) && Array.isArray(value.domains)
    && value.domains.every((domain) => typeof domain === 'string');
  return { ok: sound, focus: sound ? value : null };
}

async function readDesktop(token) {
  const response = await fetch(endpoint, {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error('Pairing code was rejected or the desktop app is unavailable.');
  const body = await response.json();
  const { focus, ok } = focusOf(body?.focus);
  const plan = planOf(body?.plan);
  if (!ok || !plan) throw new Error('Unexpected desktop response.');
  return { focus, plan };
}

// Passes that are still valid at `now`, for pause rules only (BLK-04).
const livePasses = (passes, now) => (Array.isArray(passes) ? passes : []).filter((pass) => pass
  && typeof pass.ruleId === 'string' && typeof pass.host === 'string' && pass.until > now.getTime());

// Which sites are covered right now and why. Focus wins, then Block, then
// Pause, and a live pass releases a paused site until it expires (BLK-04, BLK-05).
function coverageOf(plan, focus, passes, now) {
  const targets = [];
  const add = (target) => {
    const existing = targets.find((item) => item.domain === target.domain);
    if (!existing) targets.push(target);
    else if (PRIORITY[target.mode] > PRIORITY[existing.mode]) Object.assign(existing, target);
  };
  if (focus?.endAt > now.getTime()) {
    for (const domain of focus.domains) add({ domain, mode: 'focus', ruleId: null });
  }
  const { rules } = effectiveRules(plan.rules, plan.pendingChanges, now);
  for (const { rule } of activeRules(rules, now, plan.timeZone)) {
    for (const domain of rule.domains) {
      const passed = rule.strength === 'pause'
        && passes.some((pass) => pass.ruleId === rule.id && pass.host === domain);
      if (!passed) add({ domain, mode: rule.strength, ruleId: rule.id });
    }
  }
  return targets.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
}

function blockedUrl(target, fromStart = false) {
  if (target.mode === 'focus') {
    return chrome.runtime.getURL('blocked.html') + (fromStart ? '?from=start' : '') + '#' + target.domain;
  }
  const query = new URLSearchParams({ mode: target.mode, rule: target.ruleId ?? '' });
  if (fromStart) query.set('from', 'start');
  return chrome.runtime.getURL('blocked.html') + '?' + query.toString() + '#' + target.domain;
}

async function syncRules(targets) {
  const rules = targets.map((target, index) => ({
    id: index + 1,
    priority: PRIORITY[target.mode],
    action: { type: 'redirect', redirect: { url: blockedUrl(target) } },
    condition: { requestDomains: [target.domain], resourceTypes: ['main_frame'] }
  }));
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const unchanged = current.length === rules.length && rules.every((rule, index) => {
    const installed = current[index];
    return installed.id === rule.id && installed.priority === rule.priority
      && installed.condition.requestDomains?.[0] === targets[index].domain
      && installed.action.redirect?.url === rule.action.redirect.url;
  });
  if (unchanged) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: rules
  });
}

// Tabs already open on a site that just became covered go to the intervention
// page (BLK-07). A site counts as new when the previous check did not cover it,
// so a reload or a running rule leaves the reader where they are.
async function coverTabs(fresh) {
  if (fresh.length === 0) return;
  const domains = fresh.map((target) => target.domain);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => {
    const domain = matchDomain(tab.pendingUrl ?? tab.url, domains);
    const target = fresh.find((item) => item.domain === domain);
    return target && tab.id !== undefined
      ? chrome.tabs.update(tab.id, { url: blockedUrl(target, true) })
      : null;
  }));
}

async function applyPlan(plan, focus, passes, previous) {
  const now = new Date();
  const targets = coverageOf(plan, focus, passes, now);
  await syncRules(targets);
  const before = new Set((previous ?? []).map((item) => item?.domain));
  await coverTabs(targets.filter((target) => !before.has(target.domain)));
  const coverage = targets.map(({ domain, mode, ruleId }) => ({ domain, mode, ruleId }));
  await chrome.storage.local.set({ coverage });
  if (focus?.endAt > now.getTime()) await chrome.alarms.create(endAlarm, { when: focus.endAt });
  else await chrome.alarms.clear(endAlarm);
  const nextPass = passes.reduce((soonest, pass) => Math.min(soonest, pass.until), Infinity);
  if (Number.isFinite(nextPass)) await chrome.alarms.create(passAlarm, { when: nextPass });
  else await chrome.alarms.clear(passAlarm);
  return coverage;
}


function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function recentDays(list) {
  return [...new Set(list)].sort().slice(-KEEP_DAYS);
}

async function profile() {
  let { profileId, profileName, activeDays = [], attempts = {} } = await chrome.storage.local.get(
    ['profileId', 'profileName', 'activeDays', 'attempts']);
  if (!profileId) {
    profileId = crypto.randomUUID();
    await chrome.storage.local.set({ profileId });
  }
  const today = localDay();
  if (!activeDays.includes(today)) {
    activeDays = recentDays([...activeDays, today]);
    await chrome.storage.local.set({ activeDays });
  }
  return { profileId, profileName: profileName ?? '', activeDays, attempts };
}

// The desktop app receives the profile name, the blocked visit counts per
// domain and the days Chrome was running.
async function report(token) {
  const { profileId, profileName, activeDays, attempts } = await profile();
  const keep = new Set(recentDays(Object.keys(attempts)));
  const recent = Object.fromEntries(Object.entries(attempts).filter(([day]) => keep.has(day)));
  await fetch(desktopOrigin + '/v1/report', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, profileName, activeDays, attempts: recent }),
    cache: 'no-store',
    signal: AbortSignal.timeout(2500)
  });
}

async function recordAttempt(host) {
  const { focus, attempts = {} } = await chrome.storage.local.get(['focus', 'attempts']);
  if (!(focus?.endAt > Date.now()) || !focus.domains.includes(host)) return;
  const today = localDay();
  const day = { ...attempts[today], [host]: (attempts[today]?.[host] ?? 0) + 1 };
  const keep = new Set(recentDays([...Object.keys(attempts), today]));
  const next = Object.fromEntries(Object.entries({ ...attempts, [today]: day }).filter(([key]) => keep.has(key)));
  await chrome.storage.local.set({ attempts: next });
}

// Reads the desktop plan, keeps the last one when the app is closed, then
// re-applies everything the rules say (BLK-06, BLK-07).
async function refresh(tokenOverride) {
  const stored = await chrome.storage.local.get(['token', 'focus', 'plan', 'passes', 'coverage']);
  const candidate = tokenOverride ?? stored.token;
  let focus = stored.focus?.endAt > Date.now() ? stored.focus : null;
  let plan = planOf(stored.plan) ?? emptyPlan();
  let connected = false;
  if (candidate) {
    try {
      const snapshot = await readDesktop(candidate);
      focus = snapshot.focus;
      plan = snapshot.plan;
      connected = true;
      await report(candidate).catch(console.error);
    } catch (error) {
      if (tokenOverride) throw error;
    }
  }
  if (!candidate) focus = null;
  const now = new Date();
  if (!(focus?.endAt > now.getTime())) focus = null;
  let passes = livePasses(stored.passes, now);
  // A focus session never starts or extends a pass for its own sites (BLK-05).
  if (focus) passes = passes.filter((pass) => !focus.domains.includes(pass.host));
  if (passes.length !== (stored.passes ?? []).length) await chrome.storage.local.set({ passes });
  await chrome.storage.local.set({ token: tokenOverride ?? stored.token ?? '', focus, plan, connected });
  const coverage = await applyPlan(plan, focus, passes, stored.coverage);
  return { paired: Boolean(candidate), connected, focus, coverage };
}

// A pass is granted only by the pause page, for a site the rule covers right
// now, and never while a focus session blocks that site (BLK-04, BLK-05).
async function grantPass(ruleId, host, reason) {
  const { plan: storedPlan, focus } = await chrome.storage.local.get(['plan', 'focus']);
  const plan = planOf(storedPlan) ?? emptyPlan();
  const now = new Date();
  const { rules } = effectiveRules(plan.rules, plan.pendingChanges, now);
  const entry = activeRules(rules, now, plan.timeZone).find((item) => item.rule.id === ruleId) ?? null;
  if (!entry || entry.rule.strength !== 'pause') throw new Error('This rule no longer offers a pass.');
  if (!entry.rule.domains.includes(host)) throw new Error('The rule does not cover this site.');
  if (focus?.endAt > now.getTime() && focus.domains.includes(host)) {
    throw new Error('Your focus session is blocking this site.');
  }
  const stored = await chrome.storage.local.get('passes');
  const kept = livePasses(stored.passes, now).filter((pass) => !(pass.ruleId === ruleId && pass.host === host));
  const pass = {
    ruleId,
    host,
    until: now.getTime() + entry.rule.passMinutes * 60_000,
    reason: String(reason ?? '').trim().slice(0, 200),
    takenAt: now.toISOString()
  };
  await chrome.storage.local.set({ passes: [...kept, pass] });
  await refresh();
  return { pass, until: pass.until };
}

// What the intervention page shows (BLK-03, BLK-04).
async function describe(host) {
  const { plan: storedPlan, focus, passes } = await chrome.storage.local.get(['plan', 'focus', 'passes']);
  const plan = planOf(storedPlan) ?? emptyPlan();
  const now = new Date();
  const started = focus?.endAt > now.getTime() ? focus : null;
  const target = coverageOf(plan, started, livePasses(passes, now), now)
    .find((item) => item.domain === host) ?? null;
  if (!target) return { mode: null, host };
  if (target.mode === 'focus') {
    return {
      mode: 'focus', host, ruleId: null, ruleName: '',
      until: started.endAt, mission: plan.mission, nextAction: started.nextAction ?? '',
      countdownSeconds: null, passMinutes: null
    };
  }
  const { rules } = effectiveRules(plan.rules, plan.pendingChanges, now);
  const entry = activeRules(rules, now, plan.timeZone).find((item) => item.rule.id === target.ruleId) ?? null;
  return {
    mode: target.mode, host, ruleId: target.ruleId, ruleName: entry?.rule.name ?? '',
    until: entry?.until ?? null, mission: plan.mission, nextAction: plan.nextAction,
    countdownSeconds: entry?.rule.countdownSeconds ?? null, passMinutes: entry?.rule.passMinutes ?? null
  };
}

async function showToday() {
  const { token } = await chrome.storage.local.get('token');
  if (!token) throw new Error('Pair Chrome with Fix Myself first.');
  const response = await fetch(desktopOrigin + '/v1/show', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error('Open Fix Myself from your desktop.');
}

async function startup() {
  if (!(await chrome.alarms.get(refreshAlarm))) {
    await chrome.alarms.create(refreshAlarm, { periodInMinutes: 0.5 });
  }
  await profile();
  return refresh();
}

chrome.runtime.onInstalled.addListener(() => { serialized(startup).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { serialized(startup).catch(console.error); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === refreshAlarm || alarm.name === endAlarm || alarm.name === passAlarm) {
    serialized(refresh).catch(console.error);
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  let operation;
  if (message?.type === 'sync') operation = startup;
  if (message?.type === 'attempt' && typeof message.host === 'string') operation = () => recordAttempt(message.host);
  if (message?.type === 'intervention' && typeof message.host === 'string') operation = () => describe(message.host);
  if (message?.type === 'show') operation = () => showToday().then(() => null);
  if (message?.type === 'pass' && typeof message.ruleId === 'string' && typeof message.host === 'string') {
    operation = () => grantPass(message.ruleId, message.host, message.reason);
  }
  if (message?.type === 'name' && typeof message.name === 'string') {
    operation = async () => {
      await chrome.storage.local.set({ profileName: message.name.trim().slice(0, 60) });
      return startup();
    };
  }
  if (message?.type === 'pair' && /^[a-f0-9]{64}$/.test(message.token)) {
    operation = async () => {
      const { focus } = await chrome.storage.local.get('focus');
      if (focus?.endAt > Date.now()) throw new Error('Change pairing after the focus session ends.');
      await startup();
      return refresh(message.token);
    };
  }
  if (!operation) return false;
  serialized(operation).then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message })
  );
  return true;
});
