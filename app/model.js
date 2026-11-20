export const DEFAULT_DOMAINS = ['youtube.com', 'facebook.com', 'instagram.com'];
export const STORAGE_KEY = 'fix-myself:v1';
export const STATE_VERSION = 2;
export const STATUSES = ['open', 'in_progress', 'completed', 'canceled'];
export const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', completed: 'Completed', canceled: 'Canceled' };
export const MAX_PRIORITIES = 3;
export const SYNC_FORMAT = 'fix-myself-sync';

// Fields that sync between devices. Each carries its own edit stamp.
export const TASK_FIELDS = [
  'title', 'status', 'pinned', 'supportsMission', 'nextStep', 'effortMinutes', 'criteria',
  'subtasks', 'workBlocks', 'plannedDate', 'deadline', 'commitment', 'remind', 'source', 'review'
];
export const REVIEW_RESULTS = ['unreviewed', 'met', 'partly_met', 'needs_review'];
export const REVIEW_LABELS = { unreviewed: 'Unreviewed', met: 'Met', partly_met: 'Partly met', needs_review: 'Needs review' };
const ROOT_FIELDS = ['mission', 'nextActionId', 'settings'];
const ACTIVE = new Set(['open', 'in_progress']);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const isActive = (task) => ACTIVE.has(task.status);

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function defaultSettings() {
  return {
    timeZone: deviceTimeZone(),
    reminderLeads: { start: [10], deadline: [60, 1440] },
    notifyDevice: 'all'
  };
}

function defaultState() {
  return {
    version: STATE_VERSION,
    mission: '',
    nextActionId: null,
    tasks: [],
    workouts: [],
    deleted: {},
    stamps: {},
    supersedes: {},
    devices: {},
    settings: defaultSettings(),
    // Device-local records below this line are not exported for sync.
    focus: null,
    lastLoginDay: null,
    reminders: {},
    conflicts: [],
    peers: {},
    preferences: { focusAtLogin: false, focusMinutes: 45, domains: [...DEFAULT_DOMAINS] }
  };
}

function context(ctx = {}) {
  const now = ctx.now ?? new Date();
  return { now, at: now.toISOString(), device: ctx.device ?? 'local' };
}

const stampOf = (c) => `${c.at}|${c.device}`;
const stampDevice = (stamp) => stamp?.split('|')[1] ?? '';
const newId = () => globalThis.crypto.randomUUID();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function blankTask(c) {
  return {
    id: newId(),
    title: '',
    status: 'open',
    pinned: false,
    supportsMission: false,
    nextStep: '',
    effortMinutes: null,
    criteria: '',
    subtasks: [],
    workBlocks: [],
    plannedDate: null,
    deadline: null,
    originalDeadline: null,
    commitment: null,
    remind: { start: true, deadline: true },
    source: null,
    review: null,
    createdAt: c.at,
    completedAt: null,
    events: [],
    stamps: {},
    supersedes: {}
  };
}

function migrateTask(task) {
  const status = task.completedAt ? 'completed' : 'open';
  const events = [{ id: newId(), type: 'created', at: task.createdAt }];
  if (task.completedAt) events.push({ id: newId(), type: 'completed', at: task.completedAt });
  return {
    ...blankTask({ at: task.createdAt }),
    id: task.id,
    title: task.title,
    status,
    pinned: Boolean(task.pinned) && status === 'open',
    plannedDate: task.plannedDate ?? null,
    deadline: task.deadline ?? null,
    originalDeadline: task.deadline ?? null,
    createdAt: task.createdAt,
    completedAt: task.completedAt ?? null,
    events
  };
}

export function migrateState(saved) {
  if (saved?.version === 1 && Array.isArray(saved.tasks) && saved.preferences) {
    return {
      ...defaultState(),
      mission: saved.mission ?? '',
      tasks: saved.tasks.map(migrateTask),
      focus: saved.focus ?? null,
      lastLoginDay: saved.lastLoginDay ?? null,
      preferences: { ...defaultState().preferences, ...saved.preferences }
    };
  }
  if (saved?.version === STATE_VERSION && Array.isArray(saved.tasks) && saved.preferences) {
    return { ...defaultState(), ...saved, settings: { ...defaultSettings(), ...saved.settings } };
  }
  throw new Error('This version cannot open the saved plan.');
}

export function readState(storage) {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved === null) return defaultState();
  return migrateState(JSON.parse(saved));
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function localDate(date = new Date(), timeZone = null) {
  if (timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function planningDay(state, now = new Date()) {
  return localDate(now, state.settings?.timeZone);
}

export function addDays(day, count) {
  const date = new Date(day + 'T00:00:00Z');
  return new Date(date.getTime() + count * DAY_MS).toISOString().slice(0, 10);
}

export function normalizeDomains(text) {
  const hosts = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (hosts.some((host) => !domainPattern.test(host))) {
    throw new Error('Use domain names such as youtube.com, without links or paths.');
  }
  if (new Set(hosts).size > 30) throw new Error('Add up to 30 domains.');
  return [...new Set(hosts)];
}

export function parseLeadTimes(text) {
  const values = String(text).split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_080)) {
    throw new Error('Use whole minutes between 0 and 10080, separated by commas.');
  }
  if (values.length > 5) throw new Error('Add up to five lead times.');
  return [...new Set(values)].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Task editing

function isoOrNull(value, message) {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error(message);
  return time.toISOString();
}

function cleanText(value, max, label) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

function validateChanges(task, changes) {
  const next = {};
  for (const [field, value] of Object.entries(changes)) {
    switch (field) {
      case 'title': {
        const title = cleanText(value, 160, 'The title');
        if (!title) throw new Error('Enter a task title.');
        next.title = title;
        break;
      }
      case 'status':
        if (!STATUSES.includes(value)) throw new Error('Choose a task status.');
        next.status = value;
        break;
      case 'pinned':
      case 'supportsMission':
        next[field] = Boolean(value);
        break;
      case 'nextStep':
        next.nextStep = cleanText(value, 200, 'The next step');
        break;
      case 'criteria':
        next.criteria = cleanText(value, 1000, 'Completion criteria');
        break;
      case 'effortMinutes': {
        if (value === null || value === '' || value === undefined) {
          next.effortMinutes = null;
          break;
        }
        const minutes = Number(value);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10_000) {
          throw new Error('Enter the effort estimate in whole minutes.');
        }
        next.effortMinutes = minutes;
        break;
      }
      case 'plannedDate':
        if (value && !DAY_PATTERN.test(value)) throw new Error('Choose a valid planned date.');
        next.plannedDate = value || null;
        break;
      case 'deadline':
        next.deadline = isoOrNull(value, 'Choose a valid deadline.');
        break;
      case 'subtasks':
        if (!Array.isArray(value) || value.length > 50) throw new Error('Add up to 50 subtasks.');
        next.subtasks = value.map((item) => {
          const title = cleanText(item.title, 160, 'A subtask');
          if (!title) throw new Error('Enter a subtask title.');
          return { id: item.id ?? newId(), title, done: Boolean(item.done) };
        });
        break;
      case 'workBlocks':
        if (!Array.isArray(value) || value.length > 50) throw new Error('Add up to 50 work blocks.');
        next.workBlocks = value.map((block) => {
          const start = isoOrNull(block.start, 'Choose a start time for the work block.');
          const end = isoOrNull(block.end, 'Choose an end time for the work block.');
          if (!start || !end || end <= start) throw new Error('A work block must end after it starts.');
          return { id: block.id ?? newId(), start, end };
        }).sort((a, b) => a.start.localeCompare(b.start));
        break;
      case 'commitment':
        if (value === null) {
          next.commitment = null;
        } else {
          const outcome = cleanText(value.outcome, 240, 'The committed outcome');
          if (!outcome) throw new Error('Describe the outcome you are committing to.');
          next.commitment = {
            outcome,
            committedAt: isoOrNull(value.committedAt, 'Choose a valid commitment time.')
          };
        }
        break;
      case 'remind':
        next.remind = { start: Boolean(value?.start), deadline: Boolean(value?.deadline) };
        break;
      case 'review':
        if (value === null) {
          next.review = null;
          break;
        }
        if (!REVIEW_RESULTS.includes(value.result)) throw new Error('Choose a review result.');
        next.review = { result: value.result, evidence: cleanText(value.evidence, 1000, 'The evidence note') };
        break;
      case 'source':
        next.source = value ?? null;
        break;
      default:
        throw new Error(`Unknown task field: ${field}`);
    }
  }
  return next;
}

function event(c, type, detail = {}) {
  return { id: newId(), type, at: c.at, ...detail };
}

function timelineEvents(before, after, c) {
  const events = [];
  if (before.status !== after.status) {
    if (after.status === 'completed') events.push(event(c, 'completed'));
    else if (after.status === 'canceled') events.push(event(c, 'canceled'));
    else if (!isActive(before)) events.push(event(c, 'reopened', { status: after.status }));
    else events.push(event(c, 'status', { status: after.status }));
  }
  if (before.deadline !== after.deadline) {
    if (!after.deadline) events.push(event(c, 'deadline_cleared', { from: before.deadline }));
    else if (!before.deadline && after.originalDeadline === after.deadline) {
      events.push(event(c, 'deadline_set', { to: after.deadline }));
    } else events.push(event(c, 'deadline_revised', { from: before.deadline, to: after.deadline }));
  }
  if (before.plannedDate !== after.plannedDate && after.plannedDate) {
    events.push(event(c, 'planned', { date: after.plannedDate }));
  }
  if (!same(before.review, after.review) && after.review) {
    events.push(event(c, 'reviewed', { result: after.review.result }));
  }
  if (!same(before.commitment, after.commitment)) {
    if (after.commitment) {
      events.push(event(c, 'committed', { outcome: after.commitment.outcome, committedAt: after.commitment.committedAt }));
    } else events.push(event(c, 'commitment_removed'));
  }
  const previous = new Map(before.workBlocks.map((block) => [block.id, block]));
  for (const block of after.workBlocks) {
    const old = previous.get(block.id);
    if (!old) events.push(event(c, 'block_scheduled', { blockId: block.id, start: block.start, end: block.end }));
    else if (old.start !== block.start || old.end !== block.end) {
      events.push(event(c, 'block_rescheduled', {
        blockId: block.id, from: { start: old.start, end: old.end }, to: { start: block.start, end: block.end }
      }));
    }
    previous.delete(block.id);
  }
  for (const block of previous.values()) {
    events.push(event(c, 'block_removed', { blockId: block.id, start: block.start, end: block.end }));
  }
  return events;
}

export function activePriorities(state, exceptId) {
  return state.tasks.filter((task) => task.id !== exceptId && task.pinned && isActive(task)).length;
}

export function saveTask(state, id, changes, ctx) {
  const c = context(ctx);
  const existing = id ? state.tasks.find((task) => task.id === id) : null;
  if (id && !existing) throw new Error('This task no longer exists.');
  const before = existing ?? blankTask(c);
  const fields = validateChanges(before, changes);
  const after = { ...before, ...fields };
  if (!existing && !after.title) throw new Error('Enter a task title.');

  if (!isActive(after)) after.pinned = false;
  if (after.pinned && !before.pinned && activePriorities(state, after.id) >= MAX_PRIORITIES) {
    throw new Error('Unpin a priority before adding another.');
  }
  if (after.status === 'completed' && before.status !== 'completed') after.completedAt = c.at;
  if (after.status !== 'completed') after.completedAt = null;
  if (after.deadline && !after.originalDeadline) after.originalDeadline = after.deadline;

  const changed = TASK_FIELDS.filter((field) => !same(before[field], after[field]));
  if (existing && changed.length === 0) return state;
  after.stamps = { ...before.stamps };
  after.supersedes = { ...before.supersedes };
  const stamp = stampOf(c);
  for (const field of existing ? changed : TASK_FIELDS) {
    after.stamps[field] = stamp;
    delete after.supersedes[field];
  }
  after.events = [
    ...before.events,
    ...(existing ? [] : [event(c, 'created')]),
    ...timelineEvents(existing ?? { ...before, title: after.title }, after, c)
  ];
  const tasks = existing
    ? state.tasks.map((task) => task.id === after.id ? after : task)
    : [...state.tasks, after];
  let next = { ...state, tasks };
  if (state.nextActionId === after.id && !isActive(after)) next = setRoot(next, 'nextActionId', null, c);
  return reconcileReminders(next, c.now);
}

export function captureTask(state, fields, ctx) {
  return saveTask(state, null, fields, ctx);
}

export function setTaskStatus(state, id, status, ctx) {
  return saveTask(state, id, { status }, ctx);
}

export function toggleTask(state, id, ctx) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  return saveTask(state, id, { status: task.status === 'completed' ? 'open' : 'completed' }, ctx);
}

export function addToToday(state, id, ctx) {
  const c = context(ctx);
  return saveTask(state, id, { plannedDate: planningDay(state, c.now) }, c);
}

export function deleteTask(state, id, ctx) {
  const c = context(ctx);
  if (!state.tasks.some((task) => task.id === id)) return state;
  let next = {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== id),
    deleted: { ...state.deleted, [id]: c.at },
    conflicts: state.conflicts.filter((conflict) => conflict.ref !== id)
  };
  if (state.nextActionId === id) next = setRoot(next, 'nextActionId', null, c);
  return reconcileReminders(next, c.now);
}

function setRoot(state, field, value, c) {
  if (same(state[field], value)) return state;
  const supersedes = { ...state.supersedes };
  delete supersedes[field];
  return { ...state, [field]: value, stamps: { ...state.stamps, [field]: stampOf(c) }, supersedes };
}

export function setMission(state, text, ctx) {
  return setRoot(state, 'mission', cleanText(text, 240, 'The mission'), context(ctx));
}

export function setNextAction(state, id, ctx) {
  const task = id ? state.tasks.find((item) => item.id === id) : null;
  if (id && (!task || !isActive(task))) throw new Error('Choose an open task as the next action.');
  return setRoot(state, 'nextActionId', id ?? null, context(ctx));
}

export function updateSettings(state, changes, ctx) {
  const c = context(ctx);
  const settings = { ...state.settings, ...changes };
  if (settings.timeZone) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone });
    } catch {
      throw new Error('Choose a valid time zone, such as Asia/Ho_Chi_Minh.');
    }
  }
  if (typeof settings.notifyDevice !== 'string' || !settings.notifyDevice) {
    throw new Error('Choose a notification device.');
  }
  return reconcileReminders(setRoot(state, 'settings', settings, c), c.now);
}

export function registerDevice(state, device, now = new Date()) {
  const current = state.devices[device.id];
  const record = { name: device.name, platform: device.platform, lastSeenAt: now.toISOString() };
  if (current && current.name === record.name && current.platform === record.platform
      && now.getTime() - new Date(current.lastSeenAt).getTime() < 3_600_000) {
    return state;
  }
  return { ...state, devices: { ...state.devices, [device.id]: record } };
}

// ---------------------------------------------------------------------------
// Today

function blockOnDay(task, day, timeZone) {
  return task.workBlocks.some((block) => localDate(new Date(block.start), timeZone) === day);
}

function planOrder(a, b) {
  const firstBlock = (task) => task.workBlocks[0]?.start ?? '9999';
  return Number(b.pinned) - Number(a.pinned)
    || firstBlock(a).localeCompare(firstBlock(b))
    || a.createdAt.localeCompare(b.createdAt);
}

export function todayTasks(state, day = planningDay(state)) {
  const timeZone = state.settings?.timeZone;
  return state.tasks.filter((task) => {
    if (task.status === 'completed') return localDate(new Date(task.completedAt), timeZone) === day;
    if (!isActive(task)) return false;
    return task.pinned || task.plannedDate === day || blockOnDay(task, day, timeZone)
      || (task.deadline && localDate(new Date(task.deadline), timeZone) === day);
  }).sort(planOrder);
}

export function nextTask(state, day = planningDay(state)) {
  const chosen = state.tasks.find((task) => task.id === state.nextActionId && isActive(task));
  if (chosen) return chosen;
  const plan = todayTasks(state, day).filter(isActive);
  return plan.find((task) => task.pinned) ?? plan[0] ?? null;
}

export function carryovers(state, day = planningDay(state)) {
  const plan = new Set(todayTasks(state, day).map((task) => task.id));
  return state.tasks.filter((task) => isActive(task) && !plan.has(task.id)
    && task.plannedDate && task.plannedDate < day).sort(planOrder);
}

export function approachingDeadlines(state, now = new Date(), days = 7) {
  const day = planningDay(state, now);
  const limit = addDays(day, days);
  const plan = new Set(todayTasks(state, day).map((task) => task.id));
  return state.tasks
    .filter((task) => isActive(task) && task.deadline && !plan.has(task.id)
      && localDate(new Date(task.deadline), state.settings?.timeZone) <= limit)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export function inboxTasks(state) {
  return state.tasks.filter((task) => isActive(task) && !task.pinned && !task.plannedDate
    && !task.commitment && task.workBlocks.length === 0);
}

export function todayView(state, now = new Date()) {
  const day = planningDay(state, now);
  const plan = todayTasks(state, day);
  const next = nextTask(state, day);
  return {
    day,
    plan: next ? [next, ...plan.filter((task) => task.id !== next.id)] : plan,
    next,
    priorities: state.tasks.filter((task) => task.pinned && isActive(task)),
    carryovers: carryovers(state, day),
    deadlines: approachingDeadlines(state, now),
    done: plan.filter((task) => task.status === 'completed').length
  };
}

// ---------------------------------------------------------------------------
// Focus

export function isFocused(focus, now = Date.now()) {
  return Boolean(focus && focus.endAt > now);
}

export function startFocus(state, now = new Date()) {
  if (isFocused(state.focus, now.getTime())) return state;
  const { focusMinutes, domains } = state.preferences;
  return {
    ...state,
    focus: {
      endAt: now.getTime() + focusMinutes * 60_000,
      domains: [...domains]
    }
  };
}

export function onLogin(state, now = new Date()) {
  const day = planningDay(state, now);
  if (!state.preferences.focusAtLogin || state.lastLoginDay === day) return state;
  return { ...startFocus(state, now), lastLoginDay: day };
}

export function focusSnapshot(state, now = new Date()) {
  if (!isFocused(state.focus, now.getTime())) return null;
  return {
    ...state.focus,
    nextAction: nextTask(state, planningDay(state, now))?.title.slice(0, 160) ?? null
  };
}

// ---------------------------------------------------------------------------
// Reminders

function desiredReminders(state) {
  const { reminderLeads } = state.settings;
  const result = [];
  for (const task of state.tasks) {
    if (!isActive(task)) continue;
    if (task.deadline && task.remind.deadline) {
      for (const lead of reminderLeads.deadline) {
        result.push({ taskId: task.id, kind: 'deadline', trigger: task.id + ':deadline', triggerAt: task.deadline, lead });
      }
    }
    if (task.remind.start) {
      for (const block of task.workBlocks) {
        for (const lead of reminderLeads.start) {
          result.push({ taskId: task.id, kind: 'start', blockId: block.id, trigger: task.id + ':start:' + block.id, triggerAt: block.start, lead });
        }
      }
    }
  }
  return result.map((item) => ({
    ...item,
    id: `${item.trigger}:${item.lead}`,
    fireAt: new Date(new Date(item.triggerAt).getTime() - item.lead * 60_000).toISOString()
  }));
}

// Rebuilds reminders from tasks. Reminders whose trigger time is unchanged keep
// their snooze and delivery state; a changed trigger replaces them, and
// reminders for completed, canceled or deleted tasks are dropped.
export function reconcileReminders(state, now = new Date()) {
  const at = now.toISOString();
  const previous = state.reminders ?? {};
  const reminders = {};
  const lateByTrigger = new Map();
  for (const wanted of desiredReminders(state)) {
    const old = previous[wanted.id];
    if (old && old.triggerAt === wanted.triggerAt) {
      reminders[wanted.id] = { ...old, fireAt: wanted.fireAt };
      continue;
    }
    const reminder = { ...wanted, status: 'pending', snoozedUntil: null, deliveredAt: null, createdAt: at };
    if (wanted.triggerAt <= at) reminder.status = 'expired';
    else if (wanted.fireAt <= at) {
      const late = lateByTrigger.get(wanted.trigger);
      if (late && late.fireAt >= wanted.fireAt) reminder.status = 'expired';
      else {
        if (late) late.status = 'expired';
        lateByTrigger.set(wanted.trigger, reminder);
      }
    }
    reminders[wanted.id] = reminder;
  }
  if (same(previous, reminders)) return state;
  return { ...state, reminders };
}

const effectiveFire = (reminder) => reminder.snoozedUntil ?? reminder.fireAt;

export function remindsOn(state, deviceId) {
  return state.settings.notifyDevice === 'all' || state.settings.notifyDevice === deviceId;
}

export function dueReminders(state, now = new Date(), deviceId) {
  if (deviceId && !remindsOn(state, deviceId)) return [];
  const at = now.toISOString();
  return Object.values(state.reminders)
    .filter((reminder) => (reminder.status === 'pending' || reminder.status === 'delivered')
      && effectiveFire(reminder) <= at)
    .sort((a, b) => effectiveFire(a).localeCompare(effectiveFire(b)));
}

export function upcomingReminders(state, now = new Date(), deviceId) {
  if (deviceId && !remindsOn(state, deviceId)) return [];
  const at = now.toISOString();
  return Object.values(state.reminders)
    .filter((reminder) => reminder.status === 'pending' && effectiveFire(reminder) > at)
    .sort((a, b) => effectiveFire(a).localeCompare(effectiveFire(b)));
}

// Splits undelivered due reminders into ones to announce individually and a
// group that became overdue while the app was not running.
export function pendingDelivery(state, now = new Date(), deviceId, graceMs = 5 * 60_000) {
  const due = dueReminders(state, now, deviceId).filter((reminder) => reminder.status === 'pending');
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const missed = due.filter((reminder) => effectiveFire(reminder) < cutoff);
  if (missed.length < 2) return { single: due, missed: [] };
  return { single: due.filter((reminder) => !missed.includes(reminder)), missed };
}

function updateReminder(state, id, changes) {
  const reminder = state.reminders[id];
  if (!reminder) return state;
  return { ...state, reminders: { ...state.reminders, [id]: { ...reminder, ...changes } } };
}

export function markDelivered(state, ids, now = new Date()) {
  return ids.reduce((next, id) => updateReminder(next, id, { status: 'delivered', deliveredAt: now.toISOString() }), state);
}

export function snoozeReminder(state, id, minutes, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('Choose a snooze length.');
  return updateReminder(state, id, {
    status: 'pending',
    deliveredAt: null,
    snoozedUntil: new Date(now.getTime() + minutes * 60_000).toISOString()
  });
}

export function dismissReminder(state, id) {
  return updateReminder(state, id, { status: 'dismissed' });
}

export function reminderText(state, reminder) {
  const task = state.tasks.find((item) => item.id === reminder.taskId);
  const title = task?.title ?? 'A task';
  return reminder.kind === 'deadline' ? `${title} is due` : `Time to start ${title}`;
}

// ---------------------------------------------------------------------------
// Device sync. Each synced field keeps an edit stamp ("ISO time|device id").
// Merges take the newer value, surface both values when two devices edited the
// same field since they last synced, and never restore deleted tasks.

export function exportSync(state, device, now = new Date()) {
  return {
    format: SYNC_FORMAT,
    version: 1,
    deviceId: device.id,
    deviceName: device.name,
    exportedAt: now.toISOString(),
    data: {
      mission: state.mission,
      nextActionId: state.nextActionId,
      settings: state.settings,
      stamps: state.stamps,
      supersedes: state.supersedes,
      tasks: state.tasks,
      workouts: state.workouts.map(({ photoId, ...workout }) => ({ ...workout, hasPhoto: Boolean(photoId || workout.hasPhoto) })),
      deleted: state.deleted,
      devices: state.devices
    }
  };
}

function validatePayload(payload) {
  if (payload?.format !== SYNC_FORMAT || payload.version !== 1 || typeof payload.deviceId !== 'string'
      || typeof payload.exportedAt !== 'string' || !Array.isArray(payload.data?.tasks)) {
    throw new Error('This file is not a Fix Myself sync file.');
  }
  for (const task of payload.data.tasks) {
    if (typeof task.id !== 'string' || typeof task.title !== 'string' || !STATUSES.includes(task.status)) {
      throw new Error('The sync file contains an invalid task.');
    }
  }
}

function mergeFields(local, remote, fields, base, ref, conflicts) {
  const out = { ...local, stamps: { ...local.stamps }, supersedes: { ...local.supersedes } };
  let changed = false;
  for (const field of fields) {
    const localStamp = local.stamps?.[field] ?? '';
    const remoteStamp = remote.stamps?.[field] ?? '';
    if (localStamp === remoteStamp || !(field in remote)) continue;
    if (same(local[field], remote[field])) {
      if (remoteStamp > localStamp) out.stamps[field] = remoteStamp;
      continue;
    }
    if (local.supersedes?.[field]?.includes(remoteStamp)) continue;
    const takeRemote = () => {
      out[field] = remote[field];
      out.stamps[field] = remoteStamp;
      if (remote.supersedes?.[field]) out.supersedes[field] = remote.supersedes[field];
      else delete out.supersedes[field];
      changed = true;
    };
    if (remote.supersedes?.[field]?.includes(localStamp)) {
      takeRemote();
      continue;
    }
    if (base && localStamp > base && remoteStamp > base && stampDevice(localStamp) !== stampDevice(remoteStamp)) {
      conflicts.push({ id: `${ref}:${field}`, ref, field, local: local[field], remote: remote[field], localStamp, remoteStamp });
      continue;
    }
    if (remoteStamp > localStamp) takeRemote();
  }
  return { record: out, changed };
}

export function mergeSync(state, payload, ctx) {
  validatePayload(payload);
  const c = context(ctx);
  if (payload.deviceId === c.device) throw new Error('This sync file came from this device.');
  const remote = payload.data;
  const base = state.peers[payload.deviceId]?.seenUntil ?? null;
  const deleted = { ...state.deleted, ...remote.deleted };
  const conflicts = [];
  const summary = { added: 0, updated: 0, removed: 0, conflicts: 0 };

  const remoteTasks = new Map(remote.tasks.map((task) => [task.id, task]));
  const tasks = [];
  for (const task of state.tasks) {
    if (deleted[task.id]) {
      summary.removed += 1;
      continue;
    }
    const other = remoteTasks.get(task.id);
    remoteTasks.delete(task.id);
    if (!other) {
      tasks.push(task);
      continue;
    }
    const { record, changed } = mergeFields(task, other, TASK_FIELDS, base, task.id, conflicts);
    const events = new Map([...task.events, ...(other.events ?? [])].map((item) => [item.id, item]));
    record.events = [...events.values()].sort((a, b) => a.at.localeCompare(b.at));
    record.originalDeadline = task.originalDeadline ?? other.originalDeadline ?? record.deadline;
    if (record.status === 'completed') record.completedAt = task.completedAt ?? other.completedAt ?? c.at;
    else record.completedAt = null;
    if (changed || record.events.length !== task.events.length) summary.updated += 1;
    tasks.push(record);
  }
  for (const task of remoteTasks.values()) {
    if (deleted[task.id]) continue;
    tasks.push({ ...blankTask(c), ...task });
    summary.added += 1;
  }

  const rootLocal = { mission: state.mission, nextActionId: state.nextActionId, settings: state.settings, stamps: state.stamps, supersedes: state.supersedes };
  const { record: root } = mergeFields(rootLocal, remote, ROOT_FIELDS, base, null, conflicts);

  const workouts = new Map(state.workouts.map((workout) => [workout.id, workout]));
  for (const workout of remote.workouts ?? []) {
    if (deleted[workout.id]) continue;
    const mine = workouts.get(workout.id);
    if (!mine || (workout.updatedAt ?? '') > (mine.updatedAt ?? '')) {
      workouts.set(workout.id, { ...workout, photoId: mine?.photoId ?? null });
    }
  }

  const devices = { ...state.devices };
  for (const [id, device] of Object.entries(remote.devices ?? {})) {
    if (!devices[id] || device.lastSeenAt > devices[id].lastSeenAt) devices[id] = device;
  }

  const fresh = new Set(conflicts.map((conflict) => conflict.id));
  const keptConflicts = state.conflicts.filter((conflict) => !fresh.has(conflict.id) && !deleted[conflict.ref]);
  summary.conflicts = conflicts.length;
  let next = {
    ...state,
    ...root,
    tasks,
    workouts: [...workouts.values()].filter((workout) => !deleted[workout.id]),
    deleted,
    devices,
    conflicts: [...keptConflicts, ...conflicts],
    peers: { ...state.peers, [payload.deviceId]: { name: payload.deviceName ?? null, seenUntil: payload.exportedAt, mergedAt: c.at } }
  };
  if (next.nextActionId && !next.tasks.some((task) => task.id === next.nextActionId && isActive(task))) {
    next.nextActionId = null;
  }
  next = reconcileReminders(next, c.now);
  return { state: next, summary };
}

export function resolveConflict(state, conflictId, choice, ctx) {
  const c = context(ctx);
  const conflict = state.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return state;
  const value = choice === 'remote' ? conflict.remote : conflict.local;
  const stamp = stampOf(c);
  const superseded = [conflict.localStamp, conflict.remoteStamp];
  const conflicts = state.conflicts.filter((item) => item.id !== conflictId);
  if (conflict.ref === null) {
    return reconcileReminders({
      ...state,
      [conflict.field]: value,
      stamps: { ...state.stamps, [conflict.field]: stamp },
      supersedes: { ...state.supersedes, [conflict.field]: superseded },
      conflicts
    }, c.now);
  }
  const tasks = state.tasks.map((task) => task.id !== conflict.ref ? task : {
    ...task,
    [conflict.field]: value,
    stamps: { ...task.stamps, [conflict.field]: stamp },
    supersedes: { ...task.supersedes, [conflict.field]: superseded }
  });
  return reconcileReminders({ ...state, tasks, conflicts }, c.now);
}

export function eraseUserData(state) {
  const fresh = defaultState();
  return { ...fresh, preferences: state.preferences, settings: state.settings };
}

// ---------------------------------------------------------------------------
// Weekly review and workouts

// Delivery for commitments due within [startDay, endDay] in the planning time zone.
export function deliveryReview(state, startDay, endDay) {
  const timeZone = state.settings?.timeZone;
  const committed = state.tasks.filter((task) => task.commitment && task.status !== 'canceled');
  const dueInRange = committed.filter((task) => {
    if (!task.deadline) return false;
    const day = localDate(new Date(task.deadline), timeZone);
    return day >= startDay && day <= endDay;
  });
  const completed = dueInRange.filter((task) => task.status === 'completed');
  const onTime = completed.filter((task) => task.completedAt <= task.deadline);
  return {
    due: dueInRange,
    completed,
    onTime,
    carryovers: dueInRange.filter(isActive),
    rescheduled: dueInRange.filter((task) => task.originalDeadline && task.originalDeadline !== task.deadline),
    undated: committed.filter((task) => !task.deadline),
    onTimeRate: dueInRange.length ? onTime.length / dueInRange.length : null,
    quality: Object.fromEntries(REVIEW_RESULTS.map((result) => [result, completed
      .filter((task) => (task.review?.result ?? 'unreviewed') === result).length]))
  };
}

export function weekRange(day) {
  const date = new Date(day + 'T00:00:00Z');
  const offset = (date.getUTCDay() + 6) % 7;
  const start = addDays(day, -offset);
  return { start, end: addDays(start, 6) };
}

export const WORKOUT_TYPES = ['Run', 'Walk', 'Cycling', 'Strength', 'Yoga', 'Swim', 'Other'];

export function saveWorkout(state, fields, ctx) {
  const c = context(ctx);
  if (!DAY_PATTERN.test(fields.date ?? '')) throw new Error('Choose the workout date.');
  const type = cleanText(fields.type, 40, 'The workout type');
  if (!type) throw new Error('Choose the workout type.');
  const minutes = Number(fields.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Enter the duration in whole minutes.');
  const existing = state.workouts.find((workout) => workout.id === fields.id);
  const workout = {
    id: existing?.id ?? newId(),
    date: fields.date,
    type,
    minutes,
    photoId: fields.photoId ?? existing?.photoId ?? null,
    hasPhoto: Boolean(fields.photoId ?? existing?.photoId ?? existing?.hasPhoto),
    createdAt: existing?.createdAt ?? c.at,
    updatedAt: c.at
  };
  const workouts = existing
    ? state.workouts.map((item) => item.id === workout.id ? workout : item)
    : [...state.workouts, workout];
  return { ...state, workouts };
}

export function deleteWorkout(state, id, ctx) {
  const c = context(ctx);
  return {
    ...state,
    workouts: state.workouts.filter((workout) => workout.id !== id),
    deleted: { ...state.deleted, [id]: c.at }
  };
}

export function workoutLabel(workout) {
  if (workout.photoId) return 'Photo attached';
  if (workout.hasPhoto) return 'Photo on another device';
  return 'Self-reported';
}
