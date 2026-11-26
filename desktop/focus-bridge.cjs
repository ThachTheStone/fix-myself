const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const PORT = 42631;
const MAX_REPORT_BYTES = 65_536;
const MAX_PLAN_BYTES = 16_384;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROFILE = /^[a-f0-9-]{36}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_REPORT_DAYS = 40;
const MAX_REPORT_HOSTS = 100;
const MAX_PASS_REASONS = 20;
const MAX_REASON_LENGTH = 200;
const RULE_KINDS = ['block', 'pause', 'pass'];
const HOURS = new Set(Array.from({ length: 24 }, (_, hour) => String(hour)));
const MAX_RULES = 20;
const MAX_RULE_DOMAINS = 30;
const MAX_RULE_WINDOWS = 10;
const CHANGE_DELAYS = [0, 10, 60, 'next-day'];
const EMPTY_PLAN = { rules: [], pendingChanges: [], timeZone: null, mission: '', nextAction: '' };

// Block rule activity for the weekly review (BLK-10): daily counts per site and
// hour, plus the reasons entered for passes. No URLs or page content.
function validRuleEvents(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > MAX_REPORT_DAYS) return null;
  const clean = {};
  for (const [day, hosts] of Object.entries(value)) {
    if (!DAY.test(day)) return null;
    if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)
      || Object.keys(hosts).length > MAX_REPORT_HOSTS) return null;
    clean[day] = {};
    for (const [host, kinds] of Object.entries(hosts)) {
      if (!DOMAIN.test(host) || !kinds || typeof kinds !== 'object' || Array.isArray(kinds)) return null;
      clean[day][host] = {};
      for (const [kind, hours] of Object.entries(kinds)) {
        if (!RULE_KINDS.includes(kind) || !hours || typeof hours !== 'object' || Array.isArray(hours)) return null;
        clean[day][host][kind] = {};
        for (const [hour, count] of Object.entries(hours)) {
          if (!HOURS.has(hour)) return null;
          if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) return null;
          clean[day][host][kind][hour] = count;
        }
      }
    }
  }
  return clean;
}

function validPassReasons(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > MAX_REPORT_DAYS) return null;
  const clean = {};
  for (const [day, list] of Object.entries(value)) {
    if (!DAY.test(day) || !Array.isArray(list) || list.length > MAX_PASS_REASONS) return null;
    clean[day] = list.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      if (typeof entry.host !== 'string' || !DOMAIN.test(entry.host)) return null;
      if (!Number.isInteger(entry.hour) || entry.hour < 0 || entry.hour > 23) return null;
      if (typeof entry.reason !== 'string' || entry.reason.length < 1 || entry.reason.length > MAX_REASON_LENGTH) {
        return null;
      }
      return { host: entry.host, hour: entry.hour, reason: entry.reason };
    });
    if (clean[day].some((entry) => entry === null)) return null;
  }
  return clean;
}

// A Chrome profile reports only daily blocked-attempt totals per domain, the
// block rule activity for those days, and the days it was running, so the
// desktop app can show coverage and trends.
const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}$/;

function validReport(report) {
  if (!report || typeof report !== 'object' || !PROFILE.test(report.profileId)) return null;
  const name = typeof report.profileName === 'string' ? report.profileName.trim().slice(0, 60) : '';
  const attempts = report.attempts ?? {};
  const activeDays = report.activeDays ?? [];
  if (typeof attempts !== 'object' || Array.isArray(attempts) || Object.keys(attempts).length > 40) return null;
  if (!Array.isArray(activeDays) || activeDays.length > 40 || !activeDays.every((day) => DAY.test(day))) return null;
  const clean = {};
  for (const [day, counts] of Object.entries(attempts)) {
    if (!DAY.test(day) || !counts || typeof counts !== 'object' || Object.keys(counts).length > 30) return null;
    clean[day] = {};
    for (const [domain, count] of Object.entries(counts)) {
      if (!DOMAIN.test(domain) || !Number.isSafeInteger(count) || count < 0 || count > 100_000) return null;
      clean[day][domain] = count;
    }
  }
  const ruleEvents = validRuleEvents(report.ruleEvents);
  const passReasons = validPassReasons(report.passReasons);
  if (!ruleEvents || !passReasons) return null;
  if (report.version !== undefined && (typeof report.version !== 'string' || !VERSION.test(report.version))) return null;
  return {
    profileId: report.profileId,
    profileName: name || 'Chrome profile',
    version: report.version ?? null,
    attempts: clean,
    activeDays: [...activeDays],
    ruleEvents,
    passReasons
  };
}

function validSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  if (schedule.type === 'always') return { type: 'always' };
  if (schedule.type !== 'scheduled' || !Array.isArray(schedule.windows)) return null;
  if (schedule.windows.length === 0 || schedule.windows.length > MAX_RULE_WINDOWS) return null;
  const windows = [];
  for (const window of schedule.windows) {
    if (!window || typeof window !== 'object' || !CLOCK.test(String(window.start)) || !CLOCK.test(String(window.end))) return null;
    if (!Array.isArray(window.days) || window.days.length === 0 || window.days.length > 7) return null;
    if (!window.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) return null;
    windows.push({ days: [...new Set(window.days)].sort((a, b) => a - b), start: window.start, end: window.end });
  }
  return { type: 'scheduled', windows };
}

// A block rule as Chrome stores it (BLK-01, BLK-04). The extension re-checks the
// same shape after reading storage, so both sides agree on the fields.
function validRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 64) return null;
  if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 60) return null;
  if (!Array.isArray(rule.domains) || rule.domains.length === 0 || rule.domains.length > MAX_RULE_DOMAINS) return null;
  if (!rule.domains.every((domain) => typeof domain === 'string' && DOMAIN.test(domain))) return null;
  if (!['block', 'pause'].includes(rule.strength)) return null;
  const schedule = validSchedule(rule.schedule);
  if (!schedule) return null;
  if (!Number.isSafeInteger(rule.countdownSeconds) || rule.countdownSeconds < 5 || rule.countdownSeconds > 60) return null;
  if (!Number.isSafeInteger(rule.passMinutes) || rule.passMinutes < 1 || rule.passMinutes > 30) return null;
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled !== false,
    domains: [...new Set(rule.domains)],
    schedule,
    strength: rule.strength,
    countdownSeconds: rule.countdownSeconds,
    passMinutes: rule.passMinutes
  };
}

function validChange(change) {
  if (!change || typeof change !== 'object' || typeof change.id !== 'string' || !change.id || change.id.length > 64) return null;
  if (!Number.isFinite(new Date(change.effectiveAt ?? NaN).getTime())) return null;
  const base = { id: change.id, ruleId: typeof change.ruleId === 'string' ? change.ruleId : null, effectiveAt: change.effectiveAt };
  const kind = change.change?.type;
  if (kind === 'delete') return { ...base, change: { type: 'delete' } };
  if (kind === 'update') {
    const rule = validRule(change.change.rule);
    return rule ? { ...base, ruleId: rule.id, change: { type: 'update', rule } } : null;
  }
  if (kind === 'delay' && CHANGE_DELAYS.includes(change.change.changeDelay)) {
    return { ...base, ruleId: null, change: { type: 'delay', changeDelay: change.change.changeDelay } };
  }
  return null;
}

// What the extension needs to enforce rules while the desktop app is closed
// (BLK-03, BLK-05, BLK-06, BLK-07). It carries no browsing data.
function validPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (!Array.isArray(plan.rules) || plan.rules.length > MAX_RULES) return null;
  const rules = plan.rules.map(validRule);
  if (rules.some((rule) => rule === null)) return null;
  const changes = plan.pendingChanges ?? [];
  if (!Array.isArray(changes) || changes.length > MAX_RULES * 2) return null;
  const pendingChanges = changes.map(validChange);
  if (pendingChanges.some((change) => change === null)) return null;
  const timeZone = plan.timeZone ?? null;
  if (!(timeZone === null || (typeof timeZone === 'string' && timeZone.length <= 64))) return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return { rules, pendingChanges, timeZone, mission: text(plan.mission, 240), nextAction: text(plan.nextAction, 160) };
}

function validFocus(focus) {
  if (focus === null || focus === undefined) return null;
  if (typeof focus !== 'object' || !Number.isSafeInteger(focus.endAt)) return null;
  if (!Array.isArray(focus.domains) || focus.domains.length > 30) return null;
  if (!focus.domains.every((domain) => typeof domain === 'string' && DOMAIN.test(domain))) return null;
  if (!(focus.nextAction === null || (typeof focus.nextAction === 'string' && focus.nextAction.length <= 160))) return null;
  return { endAt: focus.endAt, domains: [...focus.domains], nextAction: focus.nextAction };
}

// A whole publication from the planner: the focus session and the rule set.
function validSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const plan = validPlan(snapshot.plan);
  if (!plan) return null;
  const focus = validFocus(snapshot.focus);
  if (focus === null && snapshot.focus !== null && snapshot.focus !== undefined) return null;
  return { focus, plan };
}

function createFocusBridge(token, readPlan, onReport = () => {}, onShow = () => {}) {
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const route = `${request.method} ${request.url}`;
    if (request.headers.host !== `127.0.0.1:${server.address().port}`
      || !['GET /v1/focus', 'POST /v1/report', 'POST /v1/show'].includes(route)) {
      response.writeHead(404).end();
      return;
    }
    const authorization = Buffer.from(request.headers.authorization || '');
    if (authorization.length !== expected.length || !timingSafeEqual(expected, authorization)) {
      response.writeHead(401).end();
      return;
    }
    if (route === 'POST /v1/show') {
      onShow();
      response.writeHead(204).end();
      return;
    }
    if (route === 'POST /v1/report') {
      if (!String(request.headers['content-type']).startsWith('application/json')) {
        response.writeHead(415).end();
        return;
      }
      const chunks = [];
      let size = 0;
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REPORT_BYTES) {
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (response.headersSent) return;
        let report;
        try {
          report = validReport(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          report = null;
        }
        if (!report) {
          response.writeHead(400).end();
          return;
        }
        onReport({ ...report, receivedAt: Date.now() });
        response.writeHead(204).end();
      });
      return;
    }
    const snapshot = readPlan();
    if (snapshot === undefined) {
      response.writeHead(503).end();
      return;
    }
    const record = snapshot ?? { focus: null, plan: EMPTY_PLAN };
    const body = JSON.stringify({
      focus: record.focus?.endAt > Date.now() ? record.focus : null,
      plan: record.plan ?? EMPTY_PLAN
    });
    if (Buffer.byteLength(body, 'utf8') > MAX_PLAN_BYTES) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(body);
  });
  return server;
}

module.exports = {
  createFocusBridge,
  validReport,
  validPlan,
  validSnapshot,
  EMPTY_PLAN,
  MAX_PLAN_BYTES,
  MAX_REPORT_BYTES,
  PORT
};
