import {
  addToToday, captureTask, chromeCoverage, distractionReview, recordChromeReports, DEFAULT_DOMAINS, deleteTask, deleteWorkout, deliveryReview, dismissReminder,
  dueReminders, eraseUserData, exportSync, focusSnapshot, inboxTasks, isActive, isFocused, markDelivered,
  mergeSync, normalizeDomains, onLogin, parseLeadTimes, pendingDelivery, planningDay, readState, reconcileReminders,
  registerDevice, remindsOn, reminderText, resolveConflict, REVIEW_LABELS, saveState, saveTask, saveWorkout,
  setMission, setNextAction, snoozeReminder, startFocus, STATUS_LABELS, toggleTask, todayView,
  upcomingReminders, updateSettings, weekRange, addDays, workoutLabel, WORKOUT_TYPES
} from './model.js';
import {
  exactTiming, nativeReminders, openExactTimingSetting, permissionState, requestPermission,
  scheduleUpcoming, showNow
} from './notify.js';
import { clearPhotos, deletePhoto, photoUrl, savePhoto } from './photos.js';

const desktop = window.fixMyselfDesktop;
const DEVICE_KEY = 'fix-myself:device';
const VIEWS = ['today', 'tasks', 'task', 'review', 'settings'];
const element = (id) => document.getElementById(id);
const preferences = element('preferences');
const planningForm = element('planning-form');
const taskDialog = element('task-dialog');
const taskForm = element('task-form');
const missionDialog = element('mission-dialog');
const missionForm = element('mission-form');
const detailForm = element('detail-form');
const shortDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
let state;
let device;
let currentDay;
let currentView = 'today';
let currentTaskId = null;
let previousFocusStatus;
let reviewStart = null;
let missedCount = 0;
let tick = 0;
const sectionCache = new Map();
const photoUrls = new Map();

// ---------------------------------------------------------------------------
// Helpers

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'checked' || key === 'value' || key === 'selected') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const ctx = () => ({ now: new Date(), device: device.id });

function reportError(error) {
  const feedback = element('app-feedback');
  feedback.textContent = error.message || 'The app could not save the change.';
  feedback.hidden = false;
}

function applyState(nextState) {
  saveState(localStorage, nextState);
  state = nextState;
  render();
}

function attempt(change, feedback, success = '') {
  try {
    applyState(change());
    if (feedback) feedback.textContent = success;
    return true;
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
    else reportError(error);
    return false;
  }
}

function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const fromLocalInput = (value) => value ? new Date(value).toISOString() : null;
const formatDay = (day) => shortDate.format(new Date(day + 'T12:00:00'));
const formatTime = (iso) => dateTime.format(new Date(iso));

function formatRange(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  const sameDay = from.toDateString() === to.toDateString();
  return `${formatTime(start)}–${sameDay ? timeOnly.format(to) : formatTime(end)}`;
}

function confirmTwice(button, label, action) {
  if (button.dataset.armed === 'true') {
    button.dataset.armed = 'false';
    button.textContent = label;
    action();
    return;
  }
  button.dataset.armed = 'true';
  button.textContent = 'Select again to confirm';
  setTimeout(() => {
    button.dataset.armed = 'false';
    button.textContent = label;
  }, 5000);
}

function cached(section, data) {
  const signature = JSON.stringify(data);
  if (sectionCache.get(section) === signature) return true;
  sectionCache.set(section, signature);
  return false;
}

// ---------------------------------------------------------------------------
// Device identity

function defaultDeviceName() {
  if (desktop?.platform === 'win32') return 'Windows PC';
  if (desktop) return 'Desktop';
  if (nativeReminders) return 'Android phone';
  return 'Browser';
}

function loadDevice() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY));
    if (typeof saved?.id === 'string' && typeof saved.name === 'string') return saved;
  } catch {
    // A new identity is created below.
  }
  const created = { id: globalThis.crypto.randomUUID(), name: defaultDeviceName() };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(created));
  return created;
}

const platformName = () => desktop ? 'windows' : nativeReminders ? 'android' : 'browser';

// ---------------------------------------------------------------------------
// Focus and Chrome

function syncChrome() {
  if (desktop) desktop.publishFocus(focusSnapshot(state)).catch(reportError);
}

function renderTimer(now = Date.now()) {
  const active = isFocused(state.focus, now);
  const seconds = active ? Math.ceil((state.focus.endAt - now) / 1000) : state.preferences.focusMinutes * 60;
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  element('focus-time').textContent = remaining;
  element('start-focus').hidden = active;
  const covered = chromeCoverage(state, now).filter((profile) => profile.current).length;
  const coverage = covered === 0 ? 'No Chrome profile has checked in recently.'
    : covered === 1 ? 'Blocking in 1 Chrome profile.' : `Blocking in ${covered} Chrome profiles.`;
  const status = active
    ? desktop ? 'Focus in progress. ' + coverage : 'Focus timer is running on this device.'
    : desktop ? '' : 'Timer only on this device.';
  if (element('focus-status').textContent !== status) element('focus-status').textContent = status;
  if (previousFocusStatus !== active) {
    previousFocusStatus = active;
    syncChrome();
  }
}

// ---------------------------------------------------------------------------
// Task rows

function taskMeta(task, isNext) {
  const now = new Date().toISOString();
  const upcomingBlock = task.workBlocks.find((block) => block.end > now);
  const doneSubtasks = task.subtasks.filter((item) => item.done).length;
  return [
    isNext ? 'Next action' : '',
    task.pinned ? 'Priority' : '',
    task.status === 'in_progress' || task.status === 'canceled' ? STATUS_LABELS[task.status] : '',
    task.commitment ? 'Committed' : '',
    task.plannedDate ? 'Planned ' + formatDay(task.plannedDate) : '',
    upcomingBlock ? 'Block ' + formatRange(upcomingBlock.start, upcomingBlock.end) : '',
    task.deadline ? (isActive(task) && task.deadline < now ? 'Overdue ' : 'Due ') + formatTime(task.deadline) : '',
    task.subtasks.length ? `${doneSubtasks}/${task.subtasks.length} subtasks` : '',
    task.effortMinutes ? `${task.effortMinutes} min` : ''
  ].filter(Boolean).join(' · ');
}

function taskRow(task, list, options = {}) {
  const done = task.status === 'canceled' ? null : h('input', {
    type: 'checkbox',
    checked: task.status === 'completed',
    'aria-label': 'Complete ' + task.title,
    dataset: { focusKey: `done:${list}:${task.id}` },
    onchange: (event) => {
      if (!attempt(() => toggleTask(state, task.id, ctx()))) event.target.checked = task.status === 'completed';
    }
  });
  const actions = [];
  if (options.carryover) {
    actions.push(h('button', {
      type: 'button', class: 'text-button', text: 'Add to today',
      'aria-label': 'Add ' + task.title + ' to today',
      dataset: { focusKey: `today:${task.id}` },
      onclick: () => attempt(() => addToToday(state, task.id, ctx()))
    }));
  }
  actions.push(h('a', {
    href: '#task/' + encodeURIComponent(task.id), class: 'text-link', text: 'Open',
    'aria-label': 'Open ' + task.title, dataset: { focusKey: `open:${list}:${task.id}` }
  }));
  return h('li', { class: 'task' + (task.status === 'canceled' ? ' canceled' : '') },
    done,
    h('div', { class: 'task-detail' },
      h('p', { class: 'task-title', text: task.title }),
      h('p', { class: 'task-meta', text: options.meta ?? taskMeta(task, options.isNext) })),
    h('div', { class: 'task-actions' }, ...actions));
}

function renderTasks(id, tasks, options = {}) {
  const list = element(id);
  list.replaceChildren(...tasks.map((task) => taskRow(task, id, {
    ...options,
    isNext: task.id === options.nextId,
    meta: options.metaFor?.(task)
  })));
  const empty = element(id.replace('-list', '-empty'));
  if (empty) empty.hidden = tasks.length > 0;
}

// ---------------------------------------------------------------------------
// Today

function renderReminders(now) {
  const due = dueReminders(state, now, device.id);
  element('reminders-panel').hidden = due.length === 0;
  const missed = element('reminders-missed');
  missed.hidden = missedCount < 2;
  missed.textContent = `${missedCount} reminders came due while the app was closed or asleep.`;
  element('reminder-list').replaceChildren(...due.map((reminder) => h('li', { class: 'reminder' },
    h('div', {},
      h('p', { class: 'strong', text: reminderText(state, reminder) }),
      h('p', { class: 'muted', text: (reminder.kind === 'deadline' ? 'Due ' : 'Starts ') + formatTime(reminder.triggerAt) })),
    h('div', { class: 'task-actions' },
      h('button', {
        type: 'button', class: 'text-button', text: 'Snooze 10 min',
        onclick: () => attempt(() => snoozeReminder(state, reminder.id, 10, new Date()))
      }),
      h('button', {
        type: 'button', class: 'text-button', text: 'Dismiss',
        onclick: () => attempt(() => dismissReminder(state, reminder.id))
      }),
      h('a', { class: 'text-link', href: '#task/' + encodeURIComponent(reminder.taskId), text: 'Open' })))));
}

function renderToday(now) {
  const view = todayView(state, now);
  currentDay = view.day;
  const longDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: state.settings.timeZone || undefined
  });
  element('today-date').textContent = longDate.format(now);
  element('mission-summary').textContent = state.mission || 'Set the direction for your day.';
  element('plan-count').textContent = view.plan.length ? `${view.done} of ${view.plan.length} complete` : '';
  renderTasks('today-list', view.plan, { nextId: view.next?.id });
  element('carryover-section').hidden = view.carryovers.length === 0;
  renderTasks('carryover-list', view.carryovers, { carryover: true });
  element('deadline-section').hidden = view.deadlines.length === 0;
  renderTasks('deadline-list', view.deadlines);

  element('next-title').textContent = view.next?.title ?? 'Nothing planned yet. Add a task or choose one below.';
  element('next-step').textContent = view.next?.nextStep ? 'Next step: ' + view.next.nextStep : '';
  const active = state.tasks.filter(isActive);
  if (!cached('next-select', [active.map((task) => [task.id, task.title]), state.nextActionId])) {
    element('next-select').replaceChildren(
      h('option', { value: '', text: 'Automatic: first priority in today\'s plan' }),
      ...active.map((task) => h('option', { value: task.id, text: task.title })));
    element('next-select').value = state.nextActionId ?? '';
  }

  renderReminders(now);
  const conflicts = state.conflicts.length;
  element('conflict-notice').hidden = conflicts === 0;
  element('conflict-text').textContent = conflicts === 1
    ? 'One sync conflict needs your choice.' : `${conflicts} sync conflicts need your choice.`;
}

function renderTaskLists() {
  const inbox = inboxTasks(state);
  const inboxIds = new Set(inbox.map((task) => task.id));
  renderTasks('inbox-list', inbox);
  renderTasks('planned-list', state.tasks.filter((task) => isActive(task) && !inboxIds.has(task.id)));
  const closed = state.tasks.filter((task) => !isActive(task))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  renderTasks('closed-list', closed);
  element('closed-count').textContent = closed.length ? `(${closed.length})` : '';
}

// ---------------------------------------------------------------------------
// Task detail

function describeEvent(event) {
  switch (event.type) {
    case 'created': return 'Captured';
    case 'committed': return `Committed to “${event.outcome}”` + (event.committedAt ? ` at ${formatTime(event.committedAt)}` : '');
    case 'commitment_removed': return 'Commitment removed';
    case 'deadline_set': return 'Deadline set for ' + formatTime(event.to);
    case 'deadline_revised': return `Deadline revised from ${formatTime(event.from)} to ${formatTime(event.to)}`;
    case 'deadline_cleared': return 'Deadline removed';
    case 'planned': return 'Planned for ' + formatDay(event.date);
    case 'block_scheduled': return 'Work block scheduled for ' + formatRange(event.start, event.end);
    case 'block_rescheduled': return `Work block moved from ${formatRange(event.from.start, event.from.end)} to ${formatRange(event.to.start, event.to.end)}`;
    case 'block_removed': return 'Work block removed: ' + formatRange(event.start, event.end);
    case 'completed': return 'Completed';
    case 'reopened': return 'Reopened';
    case 'canceled': return 'Canceled';
    case 'status': return 'Marked ' + STATUS_LABELS[event.status].toLowerCase();
    case 'reviewed': return 'Review confirmed: ' + REVIEW_LABELS[event.result];
    default: return event.type;
  }
}

function fillDetailForm(task) {
  const fields = detailForm.elements;
  fields.title.value = task.title;
  fields.status.value = task.status;
  fields.effortMinutes.value = task.effortMinutes ?? '';
  fields.plannedDate.value = task.plannedDate ?? '';
  fields.deadline.value = toLocalInput(task.deadline);
  fields.nextStep.value = task.nextStep;
  fields.criteria.value = task.criteria;
  fields.pinned.checked = task.pinned;
  fields.pinned.disabled = !isActive(task);
  fields.supportsMission.checked = task.supportsMission;
  fields.remindStart.checked = task.remind.start;
  fields.remindDeadline.checked = task.remind.deadline;
}

function editTask(changes, feedback, success) {
  return attempt(() => saveTask(state, currentTaskId, changes, ctx()), feedback, success);
}

function renderDetail(fresh) {
  const task = state.tasks.find((item) => item.id === currentTaskId);
  element('detail-missing').hidden = Boolean(task);
  element('detail-body').hidden = !task;
  if (fresh) {
    for (const key of [...sectionCache.keys()]) if (key.startsWith('detail:')) sectionCache.delete(key);
    for (const id of ['detail-feedback', 'commitment-feedback', 'subtask-feedback', 'block-feedback', 'review-feedback']) {
      element(id).textContent = '';
    }
  }
  if (!task) {
    element('detail-title').textContent = 'Task not found';
    element('detail-status').textContent = '';
    return;
  }
  element('detail-title').textContent = task.title;
  element('detail-status').textContent = [STATUS_LABELS[task.status], task.commitment ? 'Committed' : '', task.pinned ? 'Priority' : '']
    .filter(Boolean).join(' · ');
  if (fresh) fillDetailForm(task);
  const original = element('detail-original-deadline');
  original.hidden = !(task.originalDeadline && task.originalDeadline !== task.deadline);
  original.textContent = task.originalDeadline ? 'Original deadline ' + formatTime(task.originalDeadline) : '';

  if (!cached('detail:commitment', task.commitment)) {
    element('commitment-view').hidden = !task.commitment;
    element('commitment-form').hidden = Boolean(task.commitment);
    if (task.commitment) {
      element('commitment-outcome').textContent = task.commitment.outcome;
      element('commitment-time').textContent = task.commitment.committedAt
        ? 'Committed ' + formatTime(task.commitment.committedAt) : '';
    } else {
      const form = element('commitment-form').elements;
      form.outcome.value = '';
      form.committedAt.value = toLocalInput(new Date().toISOString());
    }
  }

  if (!cached('detail:subtasks', task.subtasks)) {
    element('subtask-list').replaceChildren(...task.subtasks.map((item) => h('li', { class: 'subtask' },
      h('label', { class: 'check-label' },
        h('input', {
          type: 'checkbox', checked: item.done, dataset: { focusKey: 'subtask:' + item.id },
          onchange: (event) => editTask({
            subtasks: task.subtasks.map((other) => other.id === item.id ? { ...other, done: event.target.checked } : other)
          }, element('subtask-feedback'))
        }), ' ', item.title),
      h('button', {
        type: 'button', class: 'text-button', text: 'Remove', 'aria-label': 'Remove subtask ' + item.title,
        onclick: () => editTask({ subtasks: task.subtasks.filter((other) => other.id !== item.id) }, element('subtask-feedback'))
      }))));
  }

  if (!cached('detail:blocks', task.workBlocks)) {
    element('block-list').replaceChildren(...task.workBlocks.map((block, index) => {
      const startInput = h('input', { type: 'datetime-local', value: toLocalInput(block.start), 'aria-label': `Block ${index + 1} start` });
      const endInput = h('input', { type: 'datetime-local', value: toLocalInput(block.end), 'aria-label': `Block ${index + 1} end` });
      return h('li', { class: 'block' },
        h('p', { class: 'strong', text: formatRange(block.start, block.end) }),
        h('div', { class: 'field-row' }, startInput, endInput),
        h('div', { class: 'task-actions' },
          h('button', {
            type: 'button', class: 'text-button', text: 'Reschedule',
            onclick: () => editTask({
              workBlocks: task.workBlocks.map((other) => other.id === block.id
                ? { ...other, start: fromLocalInput(startInput.value), end: fromLocalInput(endInput.value) } : other)
            }, element('block-feedback'), 'Work block rescheduled. The deadline is unchanged.')
          }),
          h('button', {
            type: 'button', class: 'text-button', text: 'Remove',
            onclick: () => editTask({ workBlocks: task.workBlocks.filter((other) => other.id !== block.id) }, element('block-feedback'))
          })));
    }));
  }

  element('review-panel').hidden = task.status !== 'completed';
  if (!cached('detail:review', [task.review, task.criteria, task.status])) {
    element('review-criteria').textContent = task.criteria
      ? 'Completion criteria: ' + task.criteria
      : 'No completion criteria were recorded. You can still confirm a result or leave it unreviewed.';
    const form = element('review-form').elements;
    form.result.value = task.review?.result ?? 'unreviewed';
    form.evidence.value = task.review?.evidence ?? '';
  }

  if (!cached('detail:timeline', task.events)) {
    element('timeline-list').replaceChildren(...[...task.events].reverse().map((event) => h('li', {},
      h('time', { datetime: event.at, class: 'muted', text: formatTime(event.at) }),
      h('span', { text: describeEvent(event) }))));
  }
}

// ---------------------------------------------------------------------------
// Weekly review

async function attachPhoto(img, id) {
  if (!photoUrls.has(id)) photoUrls.set(id, await photoUrl(id).catch(() => null));
  const url = photoUrls.get(id);
  if (url) img.src = url;
  else img.remove();
}

function renderReview() {
  reviewStart ??= weekRange(currentDay).start;
  const end = addDays(reviewStart, 6);
  element('review-range').textContent = `${formatDay(reviewStart)} – ${formatDay(end)}`;
  const review = deliveryReview(state, reviewStart, end);
  const rate = review.onTimeRate === null ? 'Unavailable' : Math.round(review.onTimeRate * 100) + '%';
  const stats = [
    ['Commitments due', review.due.length],
    ['Completed', review.completed.length],
    ['On time', review.onTime.length],
    ['On-time rate', rate],
    ['Still open', review.carryovers.length]
  ];
  element('review-stats').replaceChildren(...stats.map(([label, value]) => h('div', { class: 'stat panel' },
    h('dt', { text: label }), h('dd', { text: String(value) }))));
  element('quality-summary').textContent = review.completed.length
    ? Object.entries(review.quality).map(([result, count]) => `${REVIEW_LABELS[result]} ${count}`).join(' · ')
    : 'No completed commitments in this period.';
  renderTasks('rescheduled-list', review.rescheduled, {
    metaFor: (task) => `Original ${formatTime(task.originalDeadline)} · Revised ${formatTime(task.deadline)}`
  });
  renderTasks('missed-list', review.carryovers);
  renderTasks('undated-list', review.undated);
  renderDistractions(end);

  const workouts = state.workouts.filter((workout) => workout.date >= reviewStart && workout.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));
  element('workout-empty').hidden = workouts.length > 0;
  element('workout-list').replaceChildren(...workouts.map((workout) => {
    const image = workout.photoId ? h('img', { class: 'thumb', alt: `${workout.type} photo` }) : null;
    if (image) attachPhoto(image, workout.photoId);
    return h('li', { class: 'task' },
      image,
      h('div', { class: 'task-detail' },
        h('p', { class: 'task-title', text: `${workout.type} · ${workout.minutes} min` }),
        h('p', { class: 'task-meta', text: `${formatDay(workout.date)} · ${workoutLabel(workout)}` })),
      h('button', {
        type: 'button', class: 'text-button', text: 'Delete', 'aria-label': `Delete ${workout.type} on ${formatDay(workout.date)}`,
        onclick: async () => {
          if (workout.photoId) await deletePhoto(workout.photoId).catch(reportError);
          attempt(() => deleteWorkout(state, workout.id, ctx()));
        }
      }));
  }));
}

function renderDistractions(end) {
  const review = distractionReview(state, reviewStart, end, currentDay);
  const summary = element('distraction-summary');
  if (!review.connected) {
    summary.textContent = 'Blocked Chrome attempts appear here after the Fix Myself Focus extension is paired.';
  } else if (!review.days.length) {
    summary.textContent = 'This period has not started yet.';
  } else {
    summary.textContent = `${review.total} blocked attempt${review.total === 1 ? '' : 's'} in Chrome`
      + (review.comparable
        ? `, compared with ${review.previousTotal} on the same days last week.`
        : '. Week-over-week comparison needs full coverage in both weeks.');
  }
  element('distraction-list').replaceChildren(...review.bySite.map((site) => h('li', { class: 'task' },
    h('div', { class: 'task-detail' },
      h('p', { class: 'task-title', text: site.domain }),
      h('p', { class: 'task-meta', text: `${site.count} blocked` + (site.previous === null ? '' : ` · ${site.previous} last week`) })))));
  const gaps = element('distraction-gaps');
  gaps.hidden = !review.connected || review.gaps.length === 0;
  gaps.textContent = 'No Chrome report for ' + review.gaps.map(formatDay).join(', ') + '. Attempts on those days may be missing.';
}

async function pullChromeReports() {
  if (!desktop?.chromeReports) return;
  const next = recordChromeReports(state, await desktop.chromeReports());
  if (next !== state) applyState(next);
}

function renderCoverage() {
  const coverage = chromeCoverage(state);
  element('coverage-empty').hidden = coverage.length > 0;
  element('coverage-list').replaceChildren(...coverage.map((profile) => h('li', {},
    h('p', { class: 'strong', text: profile.name }),
    h('p', { class: 'muted', text: profile.current
      ? 'Covered. Checked in ' + formatTime(profile.lastSeenAt) + '.'
      : 'Unavailable since ' + formatTime(profile.lastSeenAt) + '. Chrome may be closed, or the extension may be disabled or unpaired.' }))));
}

// ---------------------------------------------------------------------------
// Settings

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (field === 'status') return STATUS_LABELS[value] ?? value;
  if (field === 'deadline') return formatTime(value);
  if (field === 'plannedDate') return formatDay(value);
  if (field === 'commitment') return value.outcome;
  if (field === 'nextActionId') return state.tasks.find((task) => task.id === value)?.title ?? 'Another task';
  if (field === 'settings') return `Time zone ${value.timeZone ?? 'device'}`;
  if (field === 'review') return REVIEW_LABELS[value.result];
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}: ` + value.map((item) => item.title ?? formatRange(item.start, item.end)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderSettingsLists() {
  const devices = Object.entries(state.devices);
  if (!cached('notify-device', [devices.map(([id, item]) => [id, item.name]), device.id])) {
    const select = element('notify-device');
    select.replaceChildren(h('option', { value: 'all', text: 'Every device' }),
      ...devices.map(([id, item]) => h('option', { value: id, text: item.name + (id === device.id ? ' (this device)' : '') })));
    select.value = state.settings.notifyDevice;
  }
  element('device-list').replaceChildren(...devices.map(([id, item]) => {
    const peer = state.peers[id];
    return h('li', {},
      h('p', { class: 'strong', text: item.name + (id === device.id ? ' (this device)' : '') }),
      h('p', { class: 'muted', text: [item.platform, 'Last seen ' + formatTime(item.lastSeenAt),
        peer ? 'Last merged ' + formatTime(peer.mergedAt) : ''].filter(Boolean).join(' · ') }));
  }));
  element('conflicts').hidden = state.conflicts.length === 0;
  element('conflict-list').replaceChildren(...state.conflicts.map((conflict) => {
    const owner = conflict.ref ? state.tasks.find((task) => task.id === conflict.ref)?.title ?? 'A task' : 'Plan';
    return h('li', { class: 'conflict' },
      h('p', { class: 'strong', text: `${owner}: ${conflict.field}` }),
      h('p', { text: 'This device: ' + formatValue(conflict.field, conflict.local) }),
      h('p', { text: 'Other device: ' + formatValue(conflict.field, conflict.remote) }),
      h('div', { class: 'task-actions' },
        h('button', { type: 'button', class: 'text-button', text: 'Keep this device\'s value',
          onclick: () => attempt(() => resolveConflict(state, conflict.id, 'local', ctx())) }),
        h('button', { type: 'button', class: 'text-button', text: 'Use the other device\'s value',
          onclick: () => attempt(() => resolveConflict(state, conflict.id, 'remote', ctx())) })));
  }));
}

async function refreshNotifications() {
  const status = element('notify-status');
  const timing = element('notify-timing');
  const permission = await permissionState().catch(() => 'unsupported');
  element('notify-allow').hidden = permission !== 'prompt';
  element('notify-exact').hidden = true;
  status.textContent = {
    granted: 'Notifications are allowed.',
    denied: 'Notifications are blocked. Allow them in system settings to receive reminders. Due reminders still appear on Today.',
    prompt: 'Notifications are not allowed yet. Due reminders still appear on Today.',
    unsupported: 'This device cannot show notifications here. Due reminders appear on Today.'
  }[permission] ?? '';
  if (!remindsOn(state, device.id)) {
    timing.textContent = 'Reminders are currently sent to another device.';
  } else if (nativeReminders) {
    const exact = await exactTiming();
    element('notify-exact').hidden = !exact || exact === 'granted';
    timing.textContent = exact && exact !== 'granted'
      ? 'Android may deliver reminders several minutes late. Allow exact timing to improve this.'
      : 'Reminders are scheduled with Android and arrive while the app is closed.';
  } else if (desktop) {
    timing.textContent = 'Reminders appear while Fix Myself is running. Reminders missed while it was closed are grouped when it opens.';
  } else {
    timing.textContent = 'Reminders appear only while this page is open.';
  }
}

function timeZones() {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const current = state.settings.timeZone;
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

async function refreshPreferences() {
  const { focusMinutes, domains, focusAtLogin } = state.preferences;
  preferences.elements.duration.value = focusMinutes;
  preferences.elements.domains.value = domains.join('\n');
  preferences.elements.automatic.checked = focusAtLogin;
  preferences.elements.keepRunning.checked = state.preferences.keepRunning;
  const zoneSelect = planningForm.elements.timeZone;
  if (!zoneSelect.options.length) zoneSelect.replaceChildren(...timeZones().map((zone) => h('option', { value: zone, text: zone.replaceAll('_', ' ') })));
  zoneSelect.value = state.settings.timeZone ?? '';
  planningForm.elements.leadStart.value = state.settings.reminderLeads.start.join(', ');
  planningForm.elements.leadDeadline.value = state.settings.reminderLeads.deadline.join(', ');
  sectionCache.delete('notify-device');
  renderSettingsLists();
  element('device-name').value = device.name;
  refreshNotifications().catch(reportError);
  if (!desktop) return;
  try {
    const status = await desktop.status();
    preferences.elements.startup.checked = status.startup;
    element('pairing-code').value = status.pairingCode ?? '';
    element('chrome-pairing').hidden = !status.pairingCode;
    if (!status.pairingCode) {
      element('settings-feedback').textContent = 'Chrome pairing is unavailable. Check that another app is not using the local connection.';
    }
  } catch (error) {
    element('settings-feedback').textContent = error.message;
  }
}

function syncFileText() {
  return JSON.stringify(exportSync(state, device));
}

function downloadSyncFile() {
  const blob = new Blob([syncFileText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeName = device.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
  const link = h('a', { href: url, download: `fix-myself-${safeName}-${currentDay}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Reminders

function checkReminders() {
  const now = new Date();
  const { single, missed } = pendingDelivery(state, now, device.id);
  if (!single.length && !missed.length) return;
  if (!nativeReminders) {
    for (const reminder of single) showNow('Fix Myself', reminderText(state, reminder)).catch(() => {});
    if (missed.length) showNow('Fix Myself', `${missed.length} reminders came due while Fix Myself was closed.`).catch(() => {});
  }
  if (missed.length) missedCount = missed.length;
  applyState(markDelivered(state, [...single, ...missed].map((reminder) => reminder.id), now));
}

function scheduleReminders(now) {
  if (!nativeReminders) return;
  const upcoming = upcomingReminders(state, now, device.id).map((reminder) => ({
    id: reminder.id + (reminder.snoozedUntil ?? ''),
    at: reminder.snoozedUntil ?? reminder.fireAt,
    text: reminderText(state, reminder)
  }));
  scheduleUpcoming(upcoming).catch(() => {});
}

// ---------------------------------------------------------------------------
// Rendering and navigation

function render() {
  const focusKey = document.activeElement?.dataset?.focusKey;
  const now = new Date();
  renderToday(now);
  renderTaskLists();
  if (currentView === 'task') renderDetail(false);
  if (currentView === 'review') renderReview();
  renderSettingsLists();
  renderCoverage();
  renderTimer(now.getTime());
  syncChrome();
  scheduleReminders(now);
  if (focusKey && document.activeElement === document.body) {
    document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

function navigate() {
  const requested = location.hash.slice(1);
  let view = requested;
  if (requested.startsWith('task/')) {
    view = 'task';
    currentTaskId = decodeURIComponent(requested.slice(5));
  }
  if (!VIEWS.includes(view)) view = 'today';
  currentView = view;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  const navTarget = view === 'task' ? 'tasks' : view;
  for (const link of document.querySelectorAll('.nav-link')) {
    if (link.hash === '#' + navTarget) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'task') {
    renderDetail(true);
    window.scrollTo(0, 0);
  }
  if (view === 'review') renderReview();
  if (view === 'settings') refreshPreferences();
  if (view === 'review' || view === 'settings') pullChromeReports().catch(reportError);
}

function showTask() {
  element('task-dialog-title').textContent = 'Add task';
  element('task-feedback').textContent = '';
  taskForm.reset();
  taskForm.elements.plannedDate.value = location.hash === '#tasks' ? '' : currentDay;
  taskDialog.showModal();
}

// ---------------------------------------------------------------------------
// Event wiring

function wireToday() {
  document.querySelectorAll('[data-add-task]').forEach((button) => button.addEventListener('click', showTask));
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { title, plannedDate, deadline, pinned } = taskForm.elements;
    const saved = attempt(() => captureTask(state, {
      title: title.value,
      plannedDate: plannedDate.value,
      deadline: fromLocalInput(deadline.value),
      pinned: pinned.checked
    }, ctx()), element('task-feedback'));
    if (saved) taskDialog.close();
  });
  element('edit-mission').addEventListener('click', () => {
    missionForm.elements.mission.value = state.mission;
    element('mission-feedback').textContent = '';
    missionDialog.showModal();
  });
  missionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (attempt(() => setMission(state, missionForm.elements.mission.value, ctx()), element('mission-feedback'))) {
      missionDialog.close();
    }
  });
  element('start-focus').addEventListener('click', () => attempt(() => startFocus(state)));
  element('next-select').addEventListener('change', (event) => {
    attempt(() => setNextAction(state, event.target.value || null, ctx()));
  });
  element('capture-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.target.elements.title;
    if (attempt(() => captureTask(state, { title: input.value }, ctx()), element('capture-feedback'), 'Captured to your inbox.')) {
      input.value = '';
      input.focus();
    }
  });
}

function wireDetail() {
  detailForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = detailForm.elements;
    const saved = editTask({
      title: fields.title.value,
      status: fields.status.value,
      effortMinutes: fields.effortMinutes.value,
      plannedDate: fields.plannedDate.value,
      deadline: fromLocalInput(fields.deadline.value),
      nextStep: fields.nextStep.value,
      criteria: fields.criteria.value,
      pinned: fields.pinned.checked,
      supportsMission: fields.supportsMission.checked,
      remind: { start: fields.remindStart.checked, deadline: fields.remindDeadline.checked }
    }, element('detail-feedback'), 'Saved.');
    if (saved) fillDetailForm(state.tasks.find((task) => task.id === currentTaskId));
  });
  element('delete-task').addEventListener('click', (event) => {
    confirmTwice(event.currentTarget, 'Delete task', () => {
      if (attempt(() => deleteTask(state, currentTaskId, ctx()), element('detail-feedback'))) location.hash = '#tasks';
    });
  });
  element('commitment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { outcome, committedAt } = event.target.elements;
    editTask({ commitment: { outcome: outcome.value, committedAt: fromLocalInput(committedAt.value) } }, element('commitment-feedback'));
  });
  element('remove-commitment').addEventListener('click', () => editTask({ commitment: null }, element('commitment-feedback')));
  element('subtask-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.target.elements.title;
    const task = state.tasks.find((item) => item.id === currentTaskId);
    if (editTask({ subtasks: [...task.subtasks, { title: input.value }] }, element('subtask-feedback'))) {
      input.value = '';
      input.focus();
    }
  });
  element('block-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { start, end } = event.target.elements;
    const task = state.tasks.find((item) => item.id === currentTaskId);
    if (editTask({ workBlocks: [...task.workBlocks, { start: fromLocalInput(start.value), end: fromLocalInput(end.value) }] },
      element('block-feedback'), 'Work block added.')) event.target.reset();
  });
  element('review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { result, evidence } = event.target.elements;
    editTask({ review: { result: result.value, evidence: evidence.value } }, element('review-feedback'), 'Review saved.');
  });
}

function wireReview() {
  const move = (days) => {
    reviewStart = days === null ? weekRange(currentDay).start : addDays(reviewStart, days);
    renderReview();
  };
  element('review-prev').addEventListener('click', () => move(-7));
  element('review-next').addEventListener('click', () => move(7));
  element('review-this').addEventListener('click', () => move(null));
  const form = element('workout-form');
  form.elements.type.replaceChildren(...WORKOUT_TYPES.map((type) => h('option', { value: type, text: type })));
  form.elements.date.value = currentDay;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { date, type, minutes, photo } = form.elements;
    const feedback = element('workout-feedback');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const file = photo.files[0];
      const photoId = file ? await savePhoto(file) : null;
      if (attempt(() => saveWorkout(state, { date: date.value, type: type.value, minutes: minutes.value, photoId }, ctx()),
        feedback, 'Workout logged.')) {
        minutes.value = '';
        photo.value = '';
      } else if (photoId) await deletePhoto(photoId);
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function wireSettings() {
  preferences.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = element('settings-feedback');
    const { duration, startup, automatic, domains, keepRunning } = preferences.elements;
    const submit = preferences.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const hosts = desktop ? normalizeDomains(domains.value) : [...DEFAULT_DOMAINS];
      if (desktop?.platform === 'win32') {
        await desktop.setStartup(startup.checked);
        await desktop.setBackground(keepRunning.checked);
      }
      applyState({
        ...state,
        preferences: {
          focusMinutes: Number(duration.value),
          focusAtLogin: startup.checked && automatic.checked,
          domains: hosts,
          keepRunning: keepRunning.checked
        }
      });
      automatic.checked = state.preferences.focusAtLogin;
      feedback.textContent = 'Settings saved.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  planningForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { timeZone, leadStart, leadDeadline, notifyDevice } = planningForm.elements;
    attempt(() => updateSettings(state, {
      timeZone: timeZone.value || null,
      reminderLeads: { start: parseLeadTimes(leadStart.value), deadline: parseLeadTimes(leadDeadline.value) },
      notifyDevice: notifyDevice.value
    }, ctx()), element('planning-feedback'), 'Planning settings saved. Future reminders were updated.');
    refreshNotifications().catch(reportError);
  });
  element('notify-allow').addEventListener('click', async () => {
    await requestPermission().catch(reportError);
    await refreshNotifications();
    sectionCache.clear();
    render();
  });
  element('notify-exact').addEventListener('click', async () => {
    await openExactTimingSetting().catch(reportError);
    await refreshNotifications();
  });
  element('save-device').addEventListener('click', () => {
    const name = element('device-name').value.trim().slice(0, 40);
    if (!name) return;
    device = { ...device, name };
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    applyState(registerDevice(state, { ...device, platform: platformName() }));
    element('sync-feedback').textContent = 'Device renamed.';
  });
  element('sync-download').addEventListener('click', downloadSyncFile);
  element('export-data').addEventListener('click', () => {
    downloadSyncFile();
    element('data-feedback').textContent = 'Your tasks, commitments, settings and workout entries were exported. Photos stay on this device.';
  });
  element('sync-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(syncFileText());
      element('sync-feedback').textContent = 'Sync data copied. Paste it on your other device.';
    } catch {
      element('sync-feedback').textContent = 'Clipboard access is unavailable. Download the sync file instead.';
    }
  });
  element('sync-merge').addEventListener('click', async () => {
    const feedback = element('sync-feedback');
    const fileInput = element('sync-file');
    const textInput = element('sync-text');
    try {
      const text = fileInput.files[0] ? await fileInput.files[0].text() : textInput.value.trim();
      if (!text) throw new Error('Choose a sync file or paste sync data.');
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('This file is not a Fix Myself sync file.');
      }
      const result = mergeSync(state, payload, ctx());
      applyState(result.state);
      const { added, updated, removed, conflicts } = result.summary;
      feedback.textContent = `Merged from ${payload.deviceName ?? 'another device'}: ${added} added, ${updated} updated, ${removed} removed.`
        + (conflicts ? ` ${conflicts} change${conflicts === 1 ? ' needs' : 's need'} your choice below.` : '');
      fileInput.value = '';
      textInput.value = '';
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
  element('erase-data').addEventListener('click', (event) => {
    confirmTwice(event.currentTarget, 'Delete all my data', async () => {
      await clearPhotos().catch(reportError);
      photoUrls.clear();
      sectionCache.clear();
      applyState(registerDevice(eraseUserData(state), { ...device, platform: platformName() }));
      element('data-feedback').textContent = 'Your tasks, mission, workouts and photos were deleted from this device.';
    });
  });
  element('copy-pairing').addEventListener('click', async () => {
    const feedback = element('pairing-feedback');
    try {
      await navigator.clipboard.writeText(element('pairing-code').value);
      feedback.textContent = 'Pairing code copied.';
    } catch {
      feedback.textContent = 'Clipboard access is unavailable.';
    }
  });
}

async function boot() {
  device = loadDevice();
  state = readState(localStorage);
  state = reconcileReminders(registerDevice(state, { ...device, platform: platformName() }));
  if (desktop?.platform === 'win32') element('windows-settings').hidden = false;
  if (desktop) element('browser-settings').hidden = false;
  if (desktop?.loginLaunch) state = onLogin(state);
  desktop?.setBackground?.(state.preferences.keepRunning).catch(reportError);
  saveState(localStorage, state);
  currentDay = planningDay(state);

  wireToday();
  wireDetail();
  wireReview();
  wireSettings();
  window.addEventListener('hashchange', navigate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      render();
      checkReminders();
    }
  });
  navigate();
  render();
  checkReminders();
  setInterval(() => {
    tick += 1;
    if (planningDay(state) !== currentDay) render();
    else renderTimer();
    if (tick % 15 === 0) checkReminders();
    if (tick % 30 === 0) pullChromeReports().catch(reportError);
  }, 1000);
}

boot().catch(reportError);
