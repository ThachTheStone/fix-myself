import {
  activeBlockRules, linkBlock, addToToday, applyPendingBlockChanges, applyPendingRuleChanges, cancelPendingBlockChange,
  cancelPendingRuleChange, cancelStrictExit, exitStrictHold, requestStrictExit, strictReview, STRICT_EXIT_SECONDS, tickStrict, captureTask, chromeCoverage,
  CHANGE_DELAYS, COUNTDOWN_SECONDS, DEFAULT_CHANGE_DELAY, deleteAppPreset, deleteBlockRule, distractionReview,
  recordChromeReports, ruleReview,
  DEFAULT_DOMAINS, deleteTask, deleteWorkout, deliveryReview, dismissReminder,
  dueReminders, eraseUserData, exportSync, focusSnapshot, inboxTasks, isActive, isAlwaysAllowed, isFocused, isSessionRunning, endFocus, pauseFocus, resumeFocus, settleFocus,
  taskFocusMinutes, focusTimeReview,
  appLimitSnapshot, appReview, recordAppEvent,
  markDelivered,
  mergeSync, normalizeDomains, onLogin, parseLeadTimes, PASS_MINUTES, pendingDelivery, planningDay, planSnapshot,
  readState, reconcileReminders,
  registerDevice, remindsOn, resolveConflict, saveAppPreset, saveBlockRule, saveState, saveTask, saveWorkout,
  miniTimerView, setMiniTimer,
  setAutoAppPreset, setBlockRuleEnabled, setChangeDelay, setMission, setNextAction, snoozeReminder, startFocus,
  STATUSES, toggleTask,
  todayView, upcomingReminders, updateSettings, weekRange, addDays, WORKOUT_TYPES
} from './model.js';
import {
  exactTiming, nativeReminders, openExactTimingSetting, permissionState, requestPermission,
  scheduleUpcoming, showNow
} from './notify.js';
import { clearPhotos, deletePhoto, photoUrl, savePhoto } from './photos.js';
import {
  detectLanguage, getLanguage, LANGUAGE_KEY, LANGUAGES, locale, setLanguage, t, translateDocument, translateError
} from './i18n.js';

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
let shortDate;
let dateTime;
let timeOnly;
let state;
let device;
let currentDay;
let currentView = 'today';
let currentTaskId = null;
let previousFocusStatus = '';
let reviewStart = null;
let missedCount = 0;
let focusNextStep = false;
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
  feedback.textContent = translateError(error.message) || t('app.saveFailed');
  feedback.hidden = false;
}

// ---------------------------------------------------------------------------
// Language

function useLanguage(language) {
  setLanguage(language);
  const tag = locale();
  shortDate = new Intl.DateTimeFormat(tag, { weekday: 'short', month: 'short', day: 'numeric' });
  dateTime = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' });
  timeOnly = new Intl.DateTimeFormat(tag, { timeStyle: 'short' });
  translateDocument();
  const select = element('language-select');
  select.replaceChildren(...Object.entries(LANGUAGES).map(([code, name]) => h('option', { value: code, text: name, lang: code })));
  select.value = getLanguage();
  element('workout-type').replaceChildren(...WORKOUT_TYPES.map((type) => h('option', { value: type, text: workoutType(type) })));
}

const statusLabel = (status) => t('status.' + status);
const reviewLabel = (result) => t('result.' + result);
// Workout types are stored in English; types from other versions show as entered.
const workoutType = (type) => WORKOUT_TYPES.includes(type) ? t('workout.' + type) : type;

function workoutNote(workout) {
  if (workout.photoId) return t('workout.photoAttached');
  if (workout.hasPhoto) return t('workout.photoElsewhere');
  return t('workout.selfReported');
}

function reminderLine(reminder) {
  const title = state.tasks.find((item) => item.id === reminder.taskId)?.title ?? t('common.aTask');
  return t(reminder.kind === 'deadline' ? 'reminder.due' : 'reminder.start', { title });
}

function applyState(nextState) {
  saveState(localStorage, nextState);
  state = nextState;
  render();
  syncWorkspaces();
}

function attempt(change, feedback, success = '') {
  try {
    applyState(change());
    if (feedback) feedback.textContent = success;
    return true;
  } catch (error) {
    if (feedback) feedback.textContent = translateError(error.message);
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

function confirmTwice(button, labelKey, action) {
  if (button.dataset.armed === 'true') {
    button.dataset.armed = 'false';
    button.textContent = t(labelKey);
    action();
    return;
  }
  button.dataset.armed = 'true';
  button.textContent = t('app.confirmAgain');
  setTimeout(() => {
    button.dataset.armed = 'false';
    button.textContent = t(labelKey);
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
// Task workspaces (WS-01 to WS-05). Websites are a synced task field. Files,
// folders and apps live in the desktop app's own registry; this window only
// names them by id, so it can never make the desktop open a path it chose.

const workspaceItemsEnabled = () => Boolean(desktop?.platform === 'win32' && desktop.workspaceOpen);
const localItems = new Map();
const strictApps = new Map();
let workspaceTaskIds = null;
let strictAppsSignature = null;

// Called with the tasks' apps for strict holds, which start without a click (WB-02).
const strictCtx = () => ({ ...ctx(), workspaceApps: (taskId) => strictApps.get(taskId) ?? [] });

function strictTaskIds() {
  const now = new Date().toISOString();
  return state.tasks.filter((task) => isActive(task) && (task.workBlocks ?? []).some((block) => block.strict && block.end > now))
    .map((task) => task.id).sort();
}

// Removes registry items of deleted tasks and reads the apps of tasks with a strict block.
async function syncWorkspaces(force = false) {
  if (!workspaceItemsEnabled()) return;
  try {
    const ids = state.tasks.map((task) => task.id);
    const idSignature = ids.join('|');
    if (idSignature !== workspaceTaskIds) {
      workspaceTaskIds = idSignature;
      await desktop.workspacePrune(ids.slice(0, 500));
    }
    const strictIds = strictTaskIds();
    const signature = strictIds.join('|');
    if (force || signature !== strictAppsSignature) {
      strictAppsSignature = signature;
      strictApps.clear();
      for (const id of strictIds) strictApps.set(id, await desktop.workspaceApps(id));
    }
  } catch (error) {
    reportError(error);
  }
}

async function refreshLocalItems(taskId) {
  if (!workspaceItemsEnabled()) return;
  try {
    localItems.set(taskId, await desktop.workspaceList(taskId));
  } catch {
    localItems.set(taskId, []);
  }
  if (currentView === 'task' && currentTaskId === taskId) {
    sectionCache.delete('detail:workspace');
    render();
  }
}

function blockedLine(link, block) {
  let host = link.url;
  try {
    host = new URL(link.url).hostname;
  } catch {
    // The stored link was validated; keep the raw text if it cannot be read.
  }
  const by = block.source === 'focus' ? t('workspace.byFocus') : block.name;
  return h('span', {},
    t('workspace.blocked', { host, by }), ' ',
    h('a', { href: '#settings', class: 'text-link', text: t('workspace.changeInSettings') }));
}

function showLines(feedback, lines) {
  feedback.replaceChildren(...lines.flatMap((line, index) => (index === 0 ? [line] : [' ', line])));
}

async function openWorkspace(taskId, feedback) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const urls = [];
  const blocked = [];
  for (const link of task.links ?? []) {
    const block = linkBlock(state, link.url);
    if (block) blocked.push(blockedLine(link, block));
    else urls.push(link.url);
  }
  let results = [];
  try {
    if (workspaceItemsEnabled()) {
      results = await desktop.workspaceOpen({ taskId, urls });
    } else {
      for (const url of urls) window.open(url, '_blank', 'noopener');
      results = urls.map((url) => ({ label: url, ok: true }));
    }
  } catch (error) {
    feedback.textContent = translateError(error.message);
    return;
  }
  const failed = results.filter((item) => !item.ok).map((item) => item.label);
  if (results.length === 0 && blocked.length === 0) {
    feedback.textContent = t('workspace.nothingToOpen');
    return;
  }
  showLines(feedback, [
    h('span', { text: t('workspace.opened', { n: results.length - failed.length }) }),
    ...(failed.length ? [h('span', { text: t('workspace.failed', { labels: failed.join(', ') }) })] : []),
    ...blocked
  ]);
}

function renderWorkspace(task, fresh) {
  const local = localItems.get(task.id);
  if (fresh || !local) refreshLocalItems(task.id).catch(reportError);
  element('workspace-local').hidden = !workspaceItemsEnabled();
  const links = task.links ?? [];
  const items = local ?? [];
  if (cached('detail:workspace', [links, items, locale()])) return;
  element('workspace-empty').hidden = links.length + items.length > 0;
  const remove = (label, onclick) => h('button', {
    type: 'button', class: 'text-button', text: t('common.remove'), 'aria-label': t('workspace.removeItem', { label }), onclick
  });
  element('workspace-list').replaceChildren(
    ...links.map((link) => h('li', { class: 'subtask' },
      h('span', {},
        h('span', { class: 'muted', text: t('workspace.kind.link') + ' ' }),
        h('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer', text: link.label })),
      remove(link.label, () => editTask({ links: links.filter((other) => other.id !== link.id) }, element('workspace-feedback'))))),
    ...items.map((item) => h('li', { class: 'subtask' },
      h('span', {},
        h('span', { class: 'muted', text: t('workspace.kind.' + item.kind) + ' ' }),
        item.label,
        item.missing ? h('span', { class: 'muted', text: ' · ' + t('workspace.missing') }) : null),
      remove(item.label, async () => {
        try {
          await desktop.workspaceRemove(item.id);
          await refreshLocalItems(task.id);
          await syncWorkspaces(true);
        } catch (error) {
          element('workspace-feedback').textContent = translateError(error.message);
        }
      }))));
}

function wireWorkspace() {
  const feedback = element('workspace-feedback');
  const linkCount = () => (state.tasks.find((item) => item.id === currentTaskId)?.links ?? []).length;
  element('workspace-link-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { url, label } = event.target.elements;
    const task = state.tasks.find((item) => item.id === currentTaskId);
    if (!task) return;
    const link = { url: url.value, label: label.value };
    if (!editTask({ links: [...(task.links ?? []), link] }, feedback)) return;
    const saved = state.tasks.find((item) => item.id === task.id).links.at(-1);
    url.value = '';
    label.value = '';
    // A blocked site is still kept; it is only left out when the workspace opens (WS-03).
    const block = linkBlock(state, saved.url);
    if (block) showLines(feedback, [blockedLine(saved, block)]);
  });
  const addLocal = async (add) => {
    feedback.textContent = '';
    try {
      const item = await add();
      if (item) await refreshLocalItems(currentTaskId);
      await syncWorkspaces(true);
    } catch (error) {
      feedback.textContent = translateError(error.message);
    }
  };
  element('workspace-add-file').addEventListener('click', () => addLocal(
    () => desktop.workspacePick({ taskId: currentTaskId, kind: 'file', linkCount: linkCount() })));
  element('workspace-add-folder').addEventListener('click', () => addLocal(
    () => desktop.workspacePick({ taskId: currentTaskId, kind: 'folder', linkCount: linkCount() })));
  element('workspace-add-app').addEventListener('click', async () => {
    feedback.textContent = '';
    try {
      const apps = await desktop.listApps();
      element('workspace-open-apps').replaceChildren(...apps.map((app) => h('option', { value: app.path, text: app.name })));
      element('workspace-app-picker').hidden = false;
      if (apps.length === 0) feedback.textContent = t('workspace.noApps');
    } catch {
      feedback.textContent = t('workspace.appListFailed');
    }
  });
  element('workspace-app-confirm').addEventListener('click', () => {
    const path = element('workspace-open-apps').value;
    if (!path) return;
    addLocal(() => desktop.workspaceAddApp({ taskId: currentTaskId, path, linkCount: linkCount() }))
      .then(() => { element('workspace-app-picker').hidden = true; });
  });
  element('workspace-open').addEventListener('click', () => {
    openWorkspace(currentTaskId, feedback).catch(reportError);
  });
}

// ---------------------------------------------------------------------------
// Focus and Chrome

function syncChrome() {
  if (desktop) desktop.publishPlan({ focus: focusSnapshot(state), plan: planSnapshot(state) }).catch(reportError);
  publishAppLimit();
}

// Tells the floating timer window what to show; it counts down by itself (FOC-12).
function publishMiniTimer() {
  if (desktop?.platform !== 'win32') return;
  const mini = state.preferences.miniTimer;
  const view = mini?.enabled ? miniTimerView(state, new Date()) : null;
  const payload = view
    ? {
      show: true,
      endAt: view.endAt,
      // Synced or imported titles may be longer than the window accepts.
      label: (view.taskTitle || t('mini.wandering')).slice(0, 160),
      status: view.strict ? t('mini.strict') : view.paused ? t('mini.paused') : '',
      clickThrough: Boolean(mini.clickThrough)
    }
    : { show: false };
  desktop.setMiniTimer(payload).catch(reportError);
}

function changeMiniTimer(changes) {
  if (attempt(() => setMiniTimer(state, changes))) publishMiniTimer();
}

// A waiting change becomes real when its moment passes, even if Settings is
// closed (BLK-06). The extension applies the same moment by itself.
function checkRuleChanges() {
  if (!state.pendingRuleChanges?.length) return;
  const next = applyPendingRuleChanges(state);
  if (next !== state) applyState(next);
}

// Applies due block changes, runs the strict hold, then settles the session.
function checkStrict() {
  try {
    let next = applyPendingBlockChanges(state, ctx());
    if (!nativeReminders) next = tickStrict(next, strictCtx());
    next = settleFocus(next, ctx());
    if (next !== state) applyState(next);
  } catch (error) {
    reportError(error);
  }
}

function focusDuration(minutes) {
  if (minutes < 60) return t('common.minutesShort', { n: minutes });
  return t('focusTask.hoursMinutes', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function renderFocusTask(running) {
  const select = element('focus-task');
  select.hidden = running;
  element('focus-task-label').hidden = running;
  if (running) return;
  const next = state.nextActionId;
  const rank = (task) => (task.id === next ? 0 : task.pinned ? 1 : 2);
  const tasks = state.tasks.filter(isActive)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  const signature = [locale(), tasks.map((task) => [task.id, task.title]), next];
  if (cached('focus-task-options', signature)) return;
  const previous = select.value;
  select.replaceChildren(
    h('option', { value: '', text: t('focusTask.none') }),
    ...tasks.map((task) => h('option', { value: task.id, text: task.title })));
  const nextActive = tasks.some((task) => task.id === next) ? next : '';
  select.value = tasks.some((task) => task.id === previous) ? previous : nextActive;
}

function renderStrictExit(hold, now) {
  const asked = hold?.exitRequestedAt != null;
  element('strict-exit').hidden = !hold || asked;
  element('strict-exit-panel').hidden = !asked;
  if (!asked) {
    element('strict-reason').value = '';
    return;
  }
  const left = Math.max(0, Math.ceil((hold.exitRequestedAt + STRICT_EXIT_SECONDS * 1000 - now) / 1000));
  element('strict-countdown').textContent = t('strict.countdown', {
    time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  });
  element('strict-exit-confirm').disabled = left > 0;
}

function renderTimer(now = Date.now()) {
  const running = isSessionRunning(state.focus, now);
  const blocking = isFocused(state.focus, now);
  const seconds = running ? Math.ceil((state.focus.endAt - now) / 1000) : state.preferences.focusMinutes * 60;
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  element('focus-time').textContent = remaining;
  element('start-focus').hidden = running;
  const hold = running ? state.focus.strict ?? null : null;
  element('pause-focus').hidden = !running || Boolean(hold);
  element('end-focus').hidden = !running || Boolean(hold);
  renderFocusTask(running);
  renderStrictExit(hold, now);
  const paused = running && state.focus.segmentStart == null;
  const pauseLabel = t(paused ? 'focusTask.resume' : 'focusTask.pause');
  if (element('pause-focus').textContent !== pauseLabel) element('pause-focus').textContent = pauseLabel;
  const current = element('focus-current');
  current.hidden = !running;
  if (running) {
    const task = state.focus.taskId ? state.tasks.find((item) => item.id === state.focus.taskId) : null;
    const text = hold
      ? now >= hold.blockEnd
        ? t('strict.extended', { time: timeOnly.format(new Date(hold.holdUntil)), limit: timeOnly.format(new Date(hold.limit)) })
        : t('strict.holding', { title: task?.title ?? '', time: timeOnly.format(new Date(hold.holdUntil)) })
      : task ? t('focusTask.working', { title: task.title }) : t('focusTask.wandering');
    if (current.textContent !== text) current.textContent = text;
  }
  const workspaceTask = running && state.focus.taskId && state.tasks.some((item) => item.id === state.focus.taskId);
  element('focus-workspace').hidden = !workspaceTask;
  if (!workspaceTask && element('focus-workspace-feedback').textContent) element('focus-workspace-feedback').textContent = '';
  element('focus-preset').hidden = !(presetsEnabled() && (state.appPresets ?? []).length > 0 && !running);
  const covered = chromeCoverage(state, now).filter((profile) => profile.current).length;
  const coverage = covered === 0 ? t('focus.noCoverage') : t('focus.coverage', { n: covered });
  const apps = state.focus?.apps;
  const sessionStatus = running
    ? desktop ? t('focus.inProgress', { coverage }) : t('focus.localRunning')
    : blocking ? t('focusTask.ended', { time: timeOnly.format(new Date(state.focus.blockUntil ?? state.focus.endAt)) })
      : desktop ? '' : t('focus.localOnly');
  const status = [
    sessionStatus,
    paused ? t('focusTask.paused') : '',
    running && sessionStatus && apps ? t('apps.inFocus', { apps: apps.apps.map((app) => app.name).join(', ') }) : '',
    running ? appCoverageText() : ''
  ].filter(Boolean).join(' ');
  if (element('focus-status').textContent !== status) element('focus-status').textContent = status;
  const mini = state.preferences.miniTimer ?? {};
  const showMini = desktop?.platform === 'win32';
  element('mini-timer-field').hidden = !showMini;
  element('mini-timer-through-field').hidden = !showMini || !mini.enabled;
  element('mini-timer-toggle').checked = Boolean(mini.enabled);
  element('mini-timer-through').checked = Boolean(mini.clickThrough);
  // The task title is part of it so a rename, or a task removed by sync, updates the floating timer.
  const signature = [running, blocking, state.focus?.endAt, state.focus?.blockUntil, state.focus?.taskId,
    paused, Boolean(hold), miniTimerView(state)?.taskTitle ?? ''].join('|');
  if (previousFocusStatus !== signature) {
    previousFocusStatus = signature;
    syncChrome();
    publishMiniTimer();
  }
}

// ---------------------------------------------------------------------------
// Task rows

function taskMeta(task, isNext) {
  const now = new Date().toISOString();
  const upcomingBlock = task.workBlocks.find((block) => block.end > now);
  const doneSubtasks = task.subtasks.filter((item) => item.done).length;
  return [
    isNext ? t('meta.next') : '',
    task.pinned ? t('meta.priority') : '',
    task.status === 'in_progress' || task.status === 'canceled' ? statusLabel(task.status) : '',
    task.commitment ? t('meta.committed') : '',
    task.plannedDate ? t('meta.planned', { day: formatDay(task.plannedDate) }) : '',
    upcomingBlock ? t('meta.block', { range: formatRange(upcomingBlock.start, upcomingBlock.end) }) : '',
    task.deadline ? t(isActive(task) && task.deadline < now ? 'meta.overdue' : 'meta.due', { time: formatTime(task.deadline) }) : '',
    task.subtasks.length ? t('meta.subtasks', { done: doneSubtasks, total: task.subtasks.length }) : '',
    task.effortMinutes ? t('common.minutesShort', { n: task.effortMinutes }) : ''
  ].filter(Boolean).join(' · ');
}

function taskRow(task, list, options = {}) {
  const done = task.status === 'canceled' ? null : h('input', {
    type: 'checkbox',
    checked: task.status === 'completed',
    'aria-label': t('task.complete', { title: task.title }),
    dataset: { focusKey: `done:${list}:${task.id}` },
    onchange: (event) => {
      if (!attempt(() => toggleTask(state, task.id, ctx()))) event.target.checked = task.status === 'completed';
    }
  });
  const actions = [];
  if (options.carryover) {
    actions.push(h('button', {
      type: 'button', class: 'text-button', text: t('task.addToToday'),
      'aria-label': t('task.addToTodayLabel', { title: task.title }),
      dataset: { focusKey: `today:${task.id}` },
      onclick: () => attempt(() => addToToday(state, task.id, ctx()))
    }));
  }
  actions.push(h('a', {
    href: '#task/' + encodeURIComponent(task.id), class: 'text-link', text: t('common.open'),
    'aria-label': t('task.openLabel', { title: task.title }), dataset: { focusKey: `open:${list}:${task.id}` }
  }));
  return h('li', { class: 'task' + (task.status === 'canceled' ? ' canceled' : '') },
    done,
    h('div', { class: 'task-detail' },
      h('p', { class: 'task-title' }, h('a', { href: '#task/' + encodeURIComponent(task.id), text: task.title })),
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
  missed.textContent = t('today.missed', { n: missedCount });
  element('reminder-list').replaceChildren(...due.map((reminder) => h('li', { class: 'reminder' },
    h('div', {},
      h('p', { class: 'strong', text: reminderLine(reminder) }),
      h('p', { class: 'muted', text: t(reminder.kind === 'deadline' ? 'today.due' : 'today.starts', { time: formatTime(reminder.triggerAt) }) })),
    h('div', { class: 'task-actions' },
      h('button', {
        type: 'button', class: 'text-button', text: t('today.snooze'),
        onclick: () => attempt(() => snoozeReminder(state, reminder.id, 10, new Date()))
      }),
      h('button', {
        type: 'button', class: 'text-button', text: t('today.dismiss'),
        onclick: () => attempt(() => dismissReminder(state, reminder.id))
      }),
      h('a', { class: 'text-link', href: '#task/' + encodeURIComponent(reminder.taskId), text: t('common.open') })))));
}

function renderToday(now) {
  const view = todayView(state, now);
  currentDay = view.day;
  const longDate = new Intl.DateTimeFormat(locale(), {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: state.settings.timeZone || undefined
  });
  element('today-date').textContent = longDate.format(now);
  element('mission-summary').textContent = state.mission || t('today.missionEmpty');
  element('plan-count').textContent = view.plan.length ? t('today.planCount', { done: view.done, total: view.plan.length }) : '';
  renderTasks('today-list', view.plan, { nextId: view.next?.id });
  element('carryover-section').hidden = view.carryovers.length === 0;
  renderTasks('carryover-list', view.carryovers, { carryover: true });
  element('deadline-section').hidden = view.deadlines.length === 0;
  renderTasks('deadline-list', view.deadlines);

  element('next-title').textContent = view.next?.title ?? t('today.nextEmpty');
  element('next-step').textContent = view.next?.nextStep ? t('today.nextStep', { step: view.next.nextStep }) : '';
  const active = state.tasks.filter(isActive);
  if (!cached('next-select', [active.map((task) => [task.id, task.title]), state.nextActionId])) {
    element('next-select').replaceChildren(
      h('option', { value: '', text: t('today.nextAuto') }),
      ...active.map((task) => h('option', { value: task.id, text: task.title })));
    element('next-select').value = state.nextActionId ?? '';
  }

  renderReminders(now);
  const conflicts = state.conflicts.length;
  element('conflict-notice').hidden = conflicts === 0;
  element('conflict-text').textContent = t('today.conflicts', { n: conflicts });
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
    case 'created':
    case 'commitment_removed':
    case 'deadline_cleared':
    case 'completed':
    case 'reopened':
    case 'canceled': return t('event.' + event.type);
    case 'committed': return event.committedAt
      ? t('event.committedAt', { outcome: event.outcome, time: formatTime(event.committedAt) })
      : t('event.committed', { outcome: event.outcome });
    case 'deadline_set': return t('event.deadline_set', { time: formatTime(event.to) });
    case 'deadline_revised': return t('event.deadline_revised', { from: formatTime(event.from), to: formatTime(event.to) });
    case 'planned': return t('event.planned', { day: formatDay(event.date) });
    case 'block_scheduled': return t('event.block_scheduled', { range: formatRange(event.start, event.end) });
    case 'block_rescheduled': return t('event.block_rescheduled', {
      from: formatRange(event.from.start, event.from.end), to: formatRange(event.to.start, event.to.end)
    });
    case 'block_removed': return t('event.block_removed', { range: formatRange(event.start, event.end) });
    case 'status': return t('event.status', { status: statusLabel(event.status).toLowerCase() });
    case 'reviewed': return t('event.reviewed', { result: reviewLabel(event.result) });
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
    for (const id of ['detail-feedback', 'commitment-feedback', 'subtask-feedback', 'block-feedback', 'review-feedback', 'workspace-feedback']) {
      element(id).textContent = '';
    }
  }
  if (!task) {
    element('detail-title').textContent = t('detail.notFound');
    element('detail-status').textContent = '';
    return;
  }
  element('detail-title').textContent = task.title;
  element('detail-status').textContent = [statusLabel(task.status), task.commitment ? t('meta.committed') : '', task.pinned ? t('meta.priority') : '']
    .filter(Boolean).join(' · ');
  if (fresh) fillDetailForm(task);
  const original = element('detail-original-deadline');
  original.hidden = !(task.originalDeadline && task.originalDeadline !== task.deadline);
  original.textContent = task.originalDeadline ? t('detail.originalDeadline', { time: formatTime(task.originalDeadline) }) : '';
  const spent = t('focusTask.time', { duration: focusDuration(taskFocusMinutes(state, task.id)) })
    + (task.effortMinutes ? t('focusTask.estimate', { duration: focusDuration(task.effortMinutes) }) : '');
  if (element('detail-focus-time').textContent !== spent) element('detail-focus-time').textContent = spent;

  if (!cached('detail:commitment', task.commitment)) {
    element('commitment-view').hidden = !task.commitment;
    element('commitment-form').hidden = Boolean(task.commitment);
    if (task.commitment) {
      element('commitment-outcome').textContent = task.commitment.outcome;
      element('commitment-time').textContent = task.commitment.committedAt
        ? t('detail.committedTime', { time: formatTime(task.commitment.committedAt) }) : '';
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
        type: 'button', class: 'text-button', text: t('common.remove'), 'aria-label': t('detail.removeSubtask', { title: item.title }),
        onclick: () => editTask({ subtasks: task.subtasks.filter((other) => other.id !== item.id) }, element('subtask-feedback'))
      }))));
  }

  if (!cached('detail:blocks', task.workBlocks)) {
    element('block-list').replaceChildren(...task.workBlocks.map((block, index) => {
      const startInput = h('input', { type: 'datetime-local', value: toLocalInput(block.start), 'aria-label': t('detail.blockStart', { n: index + 1 }) });
      const endInput = h('input', { type: 'datetime-local', value: toLocalInput(block.end), 'aria-label': t('detail.blockEnd', { n: index + 1 }) });
      return h('li', { class: 'block' },
        h('p', { class: 'strong', text: formatRange(block.start, block.end) + (block.strict ? ' · ' + t('strict.tag') : '') }),
        h('label', { class: 'check-label' },
          h('input', {
            type: 'checkbox', checked: Boolean(block.strict),
            onchange: (event) => {
              if (!editTask({
                workBlocks: task.workBlocks.map((other) => other.id === block.id ? { ...other, strict: event.target.checked } : other)
              }, element('block-feedback'))) event.target.checked = !event.target.checked;
            }
          }), ' ', t('strict.tag')),
        h('div', { class: 'field-row' }, startInput, endInput),
        h('div', { class: 'task-actions' },
          h('button', {
            type: 'button', class: 'text-button', text: t('detail.reschedule'),
            onclick: () => editTask({
              workBlocks: task.workBlocks.map((other) => other.id === block.id
                ? { ...other, start: fromLocalInput(startInput.value), end: fromLocalInput(endInput.value) } : other)
            }, element('block-feedback'), t('detail.rescheduled'))
          }),
          h('button', {
            type: 'button', class: 'text-button', text: t('common.remove'),
            onclick: () => editTask({ workBlocks: task.workBlocks.filter((other) => other.id !== block.id) }, element('block-feedback'))
          })));
    }));
  }

  renderWorkspace(task, fresh);

  const waiting = (state.pendingBlockChanges ?? []).filter((change) => change.taskId === task.id);
  if (!cached('detail:pendingBlocks', waiting)) {
    element('block-pending').replaceChildren(...waiting.map((change) => {
      const old = task.workBlocks.find((block) => block.id === change.blockId);
      const time = formatTime(change.effectiveAt);
      const text = change.block
        ? t('strict.pendingChange', { time, range: formatRange(change.block.start, change.block.end) })
          + (change.block.strict ? '' : ' ' + t('strict.notStrict'))
        : t('strict.pendingRemove', { time, range: old ? formatRange(old.start, old.end) : '' });
      return h('li', { class: 'block' },
        h('p', { class: 'muted', text }),
        h('button', {
          type: 'button', class: 'text-button', text: t('common.cancel'),
          onclick: () => attempt(() => cancelPendingBlockChange(state, change.id, ctx()))
        }));
    }));
  }

  element('review-panel').hidden = task.status !== 'completed';
  if (!cached('detail:review', [task.review, task.criteria, task.status])) {
    element('review-criteria').textContent = task.criteria
      ? t('detail.reviewCriteria', { criteria: task.criteria })
      : t('detail.reviewNoCriteria');
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
  const rate = review.onTimeRate === null ? t('review.unavailable') : Math.round(review.onTimeRate * 100) + '%';
  const stats = [
    [t('review.statDue'), review.due.length],
    [t('review.statCompleted'), review.completed.length],
    [t('review.statOnTime'), review.onTime.length],
    [t('review.statRate'), rate],
    [t('review.statOpen'), review.carryovers.length]
  ];
  element('review-stats').replaceChildren(...stats.map(([label, value]) => h('div', { class: 'stat panel' },
    h('dt', { text: label }), h('dd', { text: String(value) }))));
  element('quality-summary').textContent = review.completed.length
    ? Object.entries(review.quality).map(([result, count]) => `${reviewLabel(result)} ${count}`).join(' · ')
    : t('review.noCompleted');
  renderTasks('rescheduled-list', review.rescheduled, {
    metaFor: (task) => t('review.originalRevised', { from: formatTime(task.originalDeadline), to: formatTime(task.deadline) })
  });
  renderTasks('missed-list', review.carryovers);
  renderTasks('undated-list', review.undated);
  const focusReview = focusTimeReview(state, reviewStart, end);
  element('focus-review-empty').hidden = focusReview.totalMinutes > 0;
  element('focus-review-list').replaceChildren(...(focusReview.totalMinutes > 0 ? [
    ...focusReview.byTask.map((item) => h('li', { class: 'task' },
      h('p', { class: 'task-title', text: t('focusTask.reviewItem', { title: item.title, duration: focusDuration(item.minutes) }) }))),
    ...(focusReview.wanderingMinutes > 0 ? [h('li', { class: 'task' },
      h('p', { class: 'task-title', text: t('focusTask.reviewWandering', { duration: focusDuration(focusReview.wanderingMinutes) }) }))] : [])
  ] : []));
  const strict = strictReview(state, reviewStart, end);
  const strictTotal = Object.values(strict.counts).reduce((sum, count) => sum + count, 0);
  element('strict-review-empty').hidden = strictTotal > 0;
  element('strict-review-counts').hidden = strictTotal === 0;
  element('strict-review-counts').textContent = strictTotal > 0 ? t('strict.reviewCounts', strict.counts) : '';
  element('strict-review-list').replaceChildren(...strict.exits.map((item) => h('li', { class: 'task' },
    h('p', { class: 'task-title', text: t('strict.reviewExit', {
      date: formatDay(localDate(new Date(item.at), state.settings?.timeZone)), title: item.title, reason: item.reason
    }) }))));
  renderDistractions(end);
  renderRuleReview(end);
  renderAppReview(end);

  const workouts = state.workouts.filter((workout) => workout.date >= reviewStart && workout.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));
  element('workout-empty').hidden = workouts.length > 0;
  element('workout-list').replaceChildren(...workouts.map((workout) => {
    const type = workoutType(workout.type);
    const image = workout.photoId ? h('img', { class: 'thumb', alt: t('review.workoutPhoto', { type }) }) : null;
    if (image) attachPhoto(image, workout.photoId);
    return h('li', { class: 'task' },
      image,
      h('div', { class: 'task-detail' },
        h('p', { class: 'task-title', text: `${type} · ${t('common.minutesShort', { n: workout.minutes })}` }),
        h('p', { class: 'task-meta', text: `${formatDay(workout.date)} · ${workoutNote(workout)}` })),
      h('button', {
        type: 'button', class: 'text-button', text: t('common.delete'),
        'aria-label': t('review.deleteWorkout', { type, day: formatDay(workout.date) }),
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
    summary.textContent = t('review.notPaired');
  } else if (!review.days.length) {
    summary.textContent = t('review.notStarted');
  } else {
    summary.textContent = t('review.attempts', { n: review.total })
      + (review.comparable ? t('review.compared', { n: review.previousTotal }) : t('review.notComparable'));
  }
  element('distraction-list').replaceChildren(...review.bySite.map((site) => h('li', { class: 'task' },
    h('div', { class: 'task-detail' },
      h('p', { class: 'task-title', text: site.domain }),
      h('p', { class: 'task-meta', text: t('review.siteBlocked', { n: site.count })
        + (site.previous === null ? '' : ' · ' + t('review.siteLastWeek', { n: site.previous })) })))));
  const gaps = element('distraction-gaps');
  gaps.hidden = !review.connected || review.gaps.length === 0;
  gaps.textContent = t('review.gaps', { days: review.gaps.map(formatDay).join(', ') });
}

// Visits that Block and Pause rules stopped, and the reasons entered for
// passes, kept apart from the focus attempt totals above (BLK-10).
function renderRuleReview(end) {
  const review = ruleReview(state, reviewStart, end, currentDay);
  const clock = (hour) => String(hour).padStart(2, '0') + ':00';
  element('rule-review-empty').hidden = review.bySite.length > 0;
  element('rule-review-list').replaceChildren(...review.bySite.map((site) => {
    const busiest = site.hours
      .map((count, hour) => ({ hour, count }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.hour - b.hour)
      .slice(0, 3)
      .map((item) => `${clock(item.hour)} (${item.count})`)
      .join(', ');
    return h('li', { class: 'task' },
      h('div', { class: 'task-detail' },
        h('p', { class: 'task-title', text: site.domain }),
        h('p', { class: 'task-meta', text: [
          t('ruleReview.blocked', { n: site.block }),
          t('ruleReview.paused', { n: site.pause }),
          t('ruleReview.passes', { n: site.pass })
        ].join(' · ') }),
        h('p', { class: 'task-meta', text: t('ruleReview.busiest', { hours: busiest }) })));
  }));
  element('rule-reason-empty').hidden = review.reasons.length > 0;
  element('rule-reason-list').replaceChildren(...review.reasons.map((reason) => h('li', { class: 'task' },
    h('p', {
      class: 'task-title',
      text: `${formatDay(reason.day)}, ${clock(reason.hour)} · ${reason.domain}: ${reason.reason}`
    }))));
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
      ? t('settings.covered', { time: formatTime(profile.lastSeenAt) })
      : t('settings.unavailableSince', { time: formatTime(profile.lastSeenAt) }) }))));
}

// ---------------------------------------------------------------------------
// Block rules

const ruleForm = element('rule-form');
const RULE_DAYS = [0, 1, 2, 3, 4, 5, 6];

// 7 January 2024 is a Sunday, so the stored day numbers map to weekday names.
const dayName = (day) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 7 + day)));

function delayLabel(value) {
  if (value === 'next-day') return t('rules.delayNextDay');
  if (Number(value) === 0) return t('rules.delayNone');
  if (Number(value) === 60) return t('rules.delayHour');
  return t('rules.delayTen');
}

function scheduleLabel(schedule) {
  if (schedule?.type !== 'scheduled') return t('rules.alwaysOn');
  return schedule.windows.map((window) => `${window.days.map(dayName).join(', ')} ${window.start}–${window.end}`).join(' · ');
}

function ruleLabel(rule) {
  return [
    rule.strength === 'pause'
      ? t('rules.pauseMeta', { seconds: rule.countdownSeconds, minutes: rule.passMinutes })
      : t('rules.blockMeta'),
    scheduleLabel(rule.schedule),
    t('rules.siteCount', { n: rule.domains.length })
  ].join(' · ');
}

// Reports a rule change inline, noting when the change waits for the delay.
function ruleFeedback(ruleId) {
  const waiting = typeof ruleId === 'string'
    && (state.pendingRuleChanges ?? []).some((change) => change.ruleId === ruleId);
  element('rules-feedback').textContent = waiting ? t('rules.changeWaiting') : t('rules.saved');
}

function ruleAttempt(action, ruleId = null) {
  try {
    applyState(action());
    ruleFeedback(ruleId);
    return true;
  } catch (error) {
    element('rules-feedback').textContent = translateError(error.message);
    return false;
  }
}

function renderRules() {
  const activeIds = new Set(activeBlockRules(state).map((entry) => entry.rule.id));
  const pending = state.pendingRuleChanges ?? [];
  element('rules-empty').hidden = state.blockRules.length > 0;
  element('rule-list').replaceChildren(...state.blockRules.map((rule) => {
    const deleting = pending.find((change) => change.ruleId === rule.id && change.change.type === 'delete');
    return h('li', { class: 'rule' },
      h('input', {
        type: 'checkbox',
        checked: rule.enabled,
        'aria-label': t('rules.enable', { name: rule.name }),
        onchange: (event) => ruleAttempt(() => setBlockRuleEnabled(state, rule.id, event.target.checked, ctx()), rule.id)
      }),
      h('div', { class: 'rule-detail' },
        h('p', { class: 'strong', text: rule.name + (activeIds.has(rule.id) ? t('rules.activeSuffix') : '') }),
        h('p', { class: 'muted', text: ruleLabel(rule) }),
        deleting ? h('p', { class: 'muted', text: t('rules.deleteWaiting', { time: formatTime(deleting.effectiveAt) }) }) : null),
      h('div', { class: 'task-actions' },
        h('button', { type: 'button', class: 'text-button', text: t('rules.edit'), onclick: () => editRule(rule) }),
        h('button', {
          type: 'button', class: 'text-button', text: t('rules.delete'),
          onclick: (event) => confirmTwice(event.currentTarget, 'rules.delete',
            () => ruleAttempt(() => deleteBlockRule(state, rule.id, ctx()), rule.id))
        })));
  }));
  element('pending-rules-empty').hidden = pending.length > 0;
  element('pending-rule-list').replaceChildren(...pending.map((change) => {
    const rule = state.blockRules.find((item) => item.id === change.ruleId);
    const name = rule?.name ?? change.change.rule?.name ?? '';
    const label = change.change.type === 'delay'
      ? t('rules.pendingDelay', { delay: delayLabel(change.change.changeDelay) })
      : change.change.type === 'delete'
        ? t('rules.pendingDelete', { name })
        : t('rules.pendingUpdate', { name });
    return h('li', {},
      h('p', { class: 'strong', text: label }),
      h('p', { class: 'muted', text: t('rules.pendingAt', { time: formatTime(change.effectiveAt) }) }),
      h('div', { class: 'task-actions' },
        h('button', {
          type: 'button', class: 'text-button', text: t('rules.cancelChange'),
          onclick: () => attempt(() => cancelPendingRuleChange(state, change.id, ctx()),
            element('rules-feedback'), t('rules.changeCancelled'))
        })));
  }));
  element('change-delay').value = String(state.settings.changeDelay ?? DEFAULT_CHANGE_DELAY);
}

function windowRow(window = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }) {
  const row = h('div', { class: 'rule-window' },
    h('div', { class: 'rule-days' }, ...RULE_DAYS.map((day) => h('label', { class: 'check-label' },
      h('input', { type: 'checkbox', name: 'day', value: String(day), checked: window.days.includes(day) }),
      h('span', { text: dayName(day) })))),
    h('div', { class: 'field-row' },
      h('div', {},
        h('label', { text: t('rules.start') }),
        h('input', { type: 'time', name: 'start', value: window.start, 'aria-label': t('rules.start') })),
      h('div', {},
        h('label', { text: t('rules.end') }),
        h('input', { type: 'time', name: 'end', value: window.end, 'aria-label': t('rules.end') }))),
    h('button', { type: 'button', class: 'text-button', text: t('rules.removeWindow'), onclick: () => row.remove() }));
  return row;
}

function readWindows() {
  return [...element('rule-windows').querySelectorAll('.rule-window')].map((node) => ({
    days: [...node.querySelectorAll('input[name="day"]:checked')].map((input) => Number(input.value)),
    start: node.querySelector('input[name="start"]').value,
    end: node.querySelector('input[name="end"]').value
  }));
}

function updateRuleFormMode() {
  element('rule-schedule-fields').hidden = ruleForm.elements.schedule.value !== 'scheduled';
  element('rule-pause-fields').hidden = ruleForm.elements.strength.value !== 'pause';
}

function resetRuleForm() {
  const fields = ruleForm.elements;
  fields.id.value = '';
  fields.name.value = '';
  // The focus distraction list is the starting choice (BLK-01).
  fields.domains.value = state.preferences.domains.join('\n');
  fields.schedule.value = 'always';
  fields.strength.value = 'block';
  fields.countdownSeconds.value = COUNTDOWN_SECONDS.default;
  fields.passMinutes.value = PASS_MINUTES.default;
  element('rule-windows').replaceChildren();
  element('rule-form-title').textContent = t('rules.newRule');
  element('rule-cancel').hidden = true;
  updateRuleFormMode();
}

function editRule(rule) {
  const fields = ruleForm.elements;
  fields.id.value = rule.id;
  fields.name.value = rule.name;
  fields.domains.value = rule.domains.join('\n');
  fields.schedule.value = rule.schedule.type;
  const windows = rule.schedule.type === 'scheduled' ? rule.schedule.windows : [];
  element('rule-windows').replaceChildren(...(windows.length ? windows.map((window) => windowRow(window)) : [windowRow()]));
  fields.strength.value = rule.strength;
  fields.countdownSeconds.value = rule.countdownSeconds;
  fields.passMinutes.value = rule.passMinutes;
  element('rule-form-title').textContent = t('rules.editRule');
  element('rule-cancel').hidden = false;
  updateRuleFormMode();
  ruleForm.scrollIntoView({ block: 'nearest' });
  fields.name.focus();
}


function wireRules() {
  ruleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = ruleForm.elements.id.value || null;
    const known = new Set(state.blockRules.map((rule) => rule.id));
    try {
      applyState(saveBlockRule(state, id, {
        name: ruleForm.elements.name.value,
        domains: ruleForm.elements.domains.value,
        schedule: ruleForm.elements.schedule.value === 'scheduled'
          ? { type: 'scheduled', windows: readWindows() }
          : { type: 'always' },
        strength: ruleForm.elements.strength.value,
        countdownSeconds: ruleForm.elements.countdownSeconds.value,
        passMinutes: ruleForm.elements.passMinutes.value
      }, ctx()));
      ruleFeedback(id ?? state.blockRules.find((rule) => !known.has(rule.id))?.id ?? null);
      resetRuleForm();
    } catch (error) {
      element('rules-feedback').textContent = translateError(error.message);
    }
  });
  element('rule-cancel').addEventListener('click', () => {
    resetRuleForm();
    element('rules-feedback').textContent = '';
  });
  element('rule-use-focus').addEventListener('click', () => {
    ruleForm.elements.domains.value = state.preferences.domains.join('\n');
  });
  for (const input of ruleForm.querySelectorAll('input[name="schedule"], select[name="strength"]')) {
    input.addEventListener('change', updateRuleFormMode);
  }
  element('rule-add-window').addEventListener('click', () => {
    element('rule-windows').append(windowRow());
  });
  element('change-delay').addEventListener('change', (event) => {
    try {
      const next = setChangeDelay(state, event.target.value, ctx());
      const waiting = (next.pendingRuleChanges ?? []).some((change) => change.change.type === 'delay');
      applyState(next);
      element('rules-feedback').textContent = waiting
        ? t('rules.delayWaiting', { delay: delayLabel(event.target.value) })
        : t('rules.saved');
    } catch (error) {
      element('rules-feedback').textContent = translateError(error.message);
      renderRules();
    }
  });
  resetRuleForm();
}

// ---------------------------------------------------------------------------
// App presets (APP-01, APP-02). The preset form only appears in the Windows
// desktop app, where the bridge can list installed apps with an open window.

const presetForm = element('preset-form');
let presetApps = [];
let openApps = [];

function presetsEnabled() {
  return Boolean(desktop?.platform === 'win32' && desktop.listApps);
}

function presetLabel(preset) {
  return [
    preset.strength === 'pause'
      ? t('apps.pauseMeta', { seconds: preset.countdownSeconds, minutes: preset.passMinutes })
      : t('apps.blockMeta'),
    t('apps.appCount', { n: preset.apps.length })
  ].join(' · ');
}

function renderPresetApps() {
  element('preset-apps-empty').hidden = presetApps.length > 0;
  element('preset-apps').replaceChildren(...presetApps.map((app, index) => h('li', {},
    h('div', { class: 'rule-detail' },
      h('p', { class: 'strong', text: app.name }),
      h('p', { class: 'muted', text: app.path })),
    h('div', { class: 'task-actions' },
      h('button', {
        type: 'button', class: 'text-button', text: t('common.remove'),
        'aria-label': t('apps.removeApp', { name: app.name }),
        onclick: () => {
          presetApps = presetApps.filter((_item, position) => position !== index);
          renderPresetApps();
          refreshAppChoices();
        }
      })))));
}

// Offers only apps that are not already in the preset and are never limited.
function refreshAppChoices() {
  const chosen = new Set(presetApps.map((app) => app.path.toLowerCase()));
  const options = openApps.filter((app) => !chosen.has(app.path.toLowerCase()) && !isAlwaysAllowed(app.path));
  const signature = [locale(), options.map((app) => [app.path, app.name])];
  if (!cached('preset-open-apps', signature)) {
    element('preset-open-apps').replaceChildren(...(options.length
      ? options.map((app) => h('option', { value: app.path, text: app.name }))
      : [h('option', { value: '', text: t('apps.listEmpty') })]));
  }
  element('preset-open-apps').disabled = options.length === 0;
  element('preset-add-app').disabled = options.length === 0;
}

function renderFocusPreset() {
  const presets = state.appPresets ?? [];
  const signature = [locale(), presets.map((preset) => [preset.id, preset.name]), state.preferences.lastAppPreset];
  if (!cached('focus-preset-options', signature)) {
    element('focus-preset').replaceChildren(
      h('option', { value: '', text: t('apps.noLimit') }),
      ...presets.map((preset) => h('option', { value: preset.id, text: preset.name })));
    const last = presets.some((preset) => preset.id === state.preferences.lastAppPreset)
      ? state.preferences.lastAppPreset
      : '';
    element('focus-preset').value = last;
  }
}

function renderPresets() {
  const presets = state.appPresets ?? [];
  element('preset-empty').hidden = presets.length > 0;
  element('preset-list').replaceChildren(...presets.map((preset) => h('li', { class: 'rule' },
    h('div', { class: 'rule-detail' },
      h('p', { class: 'strong', text: preset.name }),
      h('p', { class: 'muted', text: presetLabel(preset) })),
    h('div', { class: 'task-actions' },
      h('button', { type: 'button', class: 'text-button', text: t('apps.edit'), onclick: () => editPreset(preset) }),
      h('button', {
        type: 'button', class: 'text-button', text: t('apps.delete'),
        onclick: (event) => confirmTwice(event.currentTarget, 'apps.delete',
          () => attempt(() => deleteAppPreset(state, preset.id, ctx()), element('preset-feedback'), t('apps.deleted')))
      })))));
  const autoSignature = [locale(), presets.map((preset) => [preset.id, preset.name]), state.preferences.autoAppPreset];
  if (!cached('auto-preset', autoSignature)) {
    element('auto-preset').replaceChildren(
      h('option', { value: '', text: t('apps.noLimit') }),
      ...presets.map((preset) => h('option', { value: preset.id, text: preset.name })));
    const auto = presets.some((preset) => preset.id === state.preferences.autoAppPreset)
      ? state.preferences.autoAppPreset
      : '';
    element('auto-preset').value = auto;
  }
  renderFocusPreset();
}

function updatePresetFormMode() {
  element('preset-pause-fields').hidden = element('preset-strength').value !== 'pause';
}

function resetPresetForm() {
  presetForm.elements.id.value = '';
  presetForm.elements.name.value = '';
  presetForm.elements.strength.value = 'block';
  presetForm.elements.countdownSeconds.value = COUNTDOWN_SECONDS.default;
  presetForm.elements.passMinutes.value = PASS_MINUTES.default;
  presetApps = [];
  renderPresetApps();
  refreshAppChoices();
  element('preset-form-title').textContent = t('apps.newPreset');
  element('preset-cancel').hidden = true;
  updatePresetFormMode();
}

function editPreset(preset) {
  presetForm.elements.id.value = preset.id;
  presetForm.elements.name.value = preset.name;
  presetForm.elements.strength.value = preset.strength;
  presetForm.elements.countdownSeconds.value = preset.countdownSeconds;
  presetForm.elements.passMinutes.value = preset.passMinutes;
  presetApps = preset.apps.map((app) => ({ ...app }));
  renderPresetApps();
  refreshAppChoices();
  element('preset-form-title').textContent = t('apps.editPreset');
  element('preset-cancel').hidden = false;
  updatePresetFormMode();
  presetForm.scrollIntoView({ block: 'nearest' });
  element('preset-name').focus();
}

async function loadOpenApps(feedback) {
  try {
    openApps = await desktop.listApps();
    refreshAppChoices();
    if (openApps.length === 0) feedback.textContent = t('apps.listEmpty');
  } catch {
    feedback.textContent = t('apps.listFailed');
  }
}

function wirePresets() {
  presetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      applyState(saveAppPreset(state, element('preset-id').value || null, {
        name: element('preset-name').value,
        apps: presetApps,
        strength: element('preset-strength').value,
        countdownSeconds: element('preset-countdown').value,
        passMinutes: element('preset-pass').value
      }, ctx()));
      element('preset-feedback').textContent = t('apps.saved');
      resetPresetForm();
    } catch (error) {
      element('preset-feedback').textContent = translateError(error.message);
    }
  });
  element('preset-cancel').addEventListener('click', () => {
    resetPresetForm();
    element('preset-feedback').textContent = '';
  });
  element('preset-strength').addEventListener('change', updatePresetFormMode);
  element('preset-refresh').addEventListener('click', () => {
    loadOpenApps(element('preset-feedback')).catch(reportError);
  });
  element('preset-add-app').addEventListener('click', () => {
    const app = openApps.find((item) => item.path === element('preset-open-apps').value);
    if (!app) return;
    presetApps = [...presetApps, { path: app.path, name: app.name }];
    renderPresetApps();
    refreshAppChoices();
  });
  element('auto-preset').addEventListener('change', (event) => {
    try {
      applyState(setAutoAppPreset(state, event.target.value || null));
      element('preset-auto-feedback').textContent = t('apps.autoSaved');
    } catch (error) {
      element('preset-auto-feedback').textContent = translateError(error.message);
      renderPresets();
    }
  });
  resetPresetForm();
}


// ---------------------------------------------------------------------------
// App limits during focus (APP-03 to APP-07, APP-09). The desktop guard
// minimizes apps outside the session's preset and asks this window to explain.

const appDialog = element('app-dialog');
let appCoverageState = { state: 'off', partial: [] };
let appView = null;
let appCountdown = null;
let lastAppLimit;

function publishAppLimit() {
  if (!desktop?.setAppLimit) return;
  const limit = appLimitSnapshot(state);
  const signature = JSON.stringify(limit);
  if (signature === lastAppLimit) return;
  lastAppLimit = signature;
  desktop.setAppLimit(limit).catch(reportError);
}

function appCoverageText() {
  if (!state.focus?.apps || !isSessionRunning(state.focus)) return '';
  if (appCoverageState.state === 'unavailable') return t('apps.coverageOff');
  if (appCoverageState.partial.length) return t('apps.coveragePartial');
  return '';
}

function showAppIntervention(view) {
  appView = view;
  clearInterval(appCountdown);
  element('app-dialog-app').textContent = t('appBlock.app', { app: view.app });
  element('app-dialog-session').textContent = t('appBlock.session', { preset: view.preset, time: timeOnly.format(new Date(view.endAt)) });
  element('app-dialog-allowed').textContent = t('appBlock.allowed', { apps: view.allowed.join(', ') });
  element('app-dialog-next').textContent = view.nextAction ? t('appBlock.next', { next: view.nextAction }) : t('appBlock.noNext');
  const pause = view.mode === 'pause';
  element('app-dialog-pause').hidden = !pause;
  element('app-dialog-feedback').textContent = '';
  element('app-dialog-reason').value = '';
  const button = element('app-dialog-continue');
  button.hidden = !pause;
  if (pause) {
    let left = view.countdownSeconds;
    button.textContent = t('appBlock.continue', { n: view.passMinutes });
    const tickDown = () => {
      button.disabled = left > 0;
      element('app-dialog-countdown').textContent = left > 0 ? t('appBlock.wait', { n: left }) : t('appBlock.ready');
      if (left <= 0) clearInterval(appCountdown);
      left -= 1;
    };
    tickDown();
    appCountdown = setInterval(tickDown, 1000);
  } else {
    element('app-dialog-countdown').textContent = '';
    element('app-dialog-allowed').textContent += ' ' + t('appBlock.blocked');
  }
  if (!appDialog.open) appDialog.showModal();
}

function wireAppLimits() {
  if (!desktop?.onAppIntervention) return;
  desktop.onAppIntervention((view) => {
    if (location.hash !== '#today' && location.hash !== '') location.hash = '#today';
    showAppIntervention(view);
  });
  desktop.onAppEvent((record) => {
    const next = recordAppEvent(state, record);
    if (next !== state) applyState(next);
  });
  desktop.onAppCoverage((coverage) => {
    appCoverageState = coverage;
    renderTimer();
  });
  desktop.appCoverage().then((coverage) => { appCoverageState = coverage; }).catch(reportError);
  element('app-dialog-continue').addEventListener('click', async () => {
    if (!appView) return;
    try {
      await desktop.takeAppPass(appView.path, element('app-dialog-reason').value);
      appDialog.close();
    } catch (error) {
      element('app-dialog-feedback').textContent = translateError(error.message);
    }
  });
  appDialog.addEventListener('close', () => {
    clearInterval(appCountdown);
    appView = null;
  });
}

function renderAppReview(end) {
  const section = element('app-review');
  section.hidden = !presetsEnabled();
  if (section.hidden) return;
  const review = appReview(state, reviewStart, end, currentDay);
  element('app-review-empty').hidden = review.byApp.length > 0;
  element('app-review-list').replaceChildren(...review.byApp.map((item) => h('li', { class: 'task' },
    h('div', { class: 'task-detail' },
      h('p', { class: 'task-title', text: item.name }),
      h('p', { class: 'task-meta', text: t('appReview.counts', { block: item.block, pause: item.pause, pass: item.pass }) })))));
  element('app-review-reasons-empty').hidden = review.reasons.length > 0;
  element('app-review-reasons').replaceChildren(...review.reasons.map((item) => h('li', {
    text: t('appReview.reason', { day: formatDay(item.day), hour: String(item.hour).padStart(2, '0'), app: item.name, reason: item.reason })
  })));
}

// ---------------------------------------------------------------------------
// Settings

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return t('common.empty');
  if (field === 'status') return STATUSES.includes(value) ? statusLabel(value) : value;
  if (field === 'deadline') return formatTime(value);
  if (field === 'plannedDate') return formatDay(value);
  if (field === 'commitment') return value.outcome;
  if (field === 'nextActionId') return state.tasks.find((task) => task.id === value)?.title ?? t('conflict.anotherTask');
  if (field === 'settings') return t('conflict.timeZone', { zone: value.timeZone ?? t('conflict.deviceZone') });
  if (field === 'review') return reviewLabel(value.result);
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (Array.isArray(value)) {
    return t('conflict.items', { n: value.length, list: value.map((item) => item.title ?? formatRange(item.start, item.end)).join(', ') });
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const deviceLabel = (id, item) => id === device.id ? t('settings.thisDevice', { name: item.name }) : item.name;

function renderSettingsLists() {
  const devices = Object.entries(state.devices);
  if (!cached('notify-device', [devices.map(([id, item]) => [id, item.name]), device.id])) {
    const select = element('notify-device');
    select.replaceChildren(h('option', { value: 'all', text: t('settings.everyDevice') }),
      ...devices.map(([id, item]) => h('option', { value: id, text: deviceLabel(id, item) })));
    select.value = state.settings.notifyDevice;
  }
  element('device-list').replaceChildren(...devices.map(([id, item]) => {
    const peer = state.peers[id];
    return h('li', {},
      h('p', { class: 'strong', text: deviceLabel(id, item) }),
      h('p', { class: 'muted', text: [item.platform, t('settings.lastSeen', { time: formatTime(item.lastSeenAt) }),
        peer ? t('settings.lastMerged', { time: formatTime(peer.mergedAt) }) : ''].filter(Boolean).join(' · ') }));
  }));
  element('conflicts').hidden = state.conflicts.length === 0;
  element('conflict-list').replaceChildren(...state.conflicts.map((conflict) => {
    const owner = conflict.ref ? state.tasks.find((task) => task.id === conflict.ref)?.title ?? t('common.aTask') : t('conflict.plan');
    return h('li', { class: 'conflict' },
      h('p', { class: 'strong', text: `${owner}: ${conflict.field}` }),
      h('p', { text: t('conflict.thisDevice', { value: formatValue(conflict.field, conflict.local) }) }),
      h('p', { text: t('conflict.otherDevice', { value: formatValue(conflict.field, conflict.remote) }) }),
      h('div', { class: 'task-actions' },
        h('button', { type: 'button', class: 'text-button', text: t('conflict.keepLocal'),
          onclick: () => attempt(() => resolveConflict(state, conflict.id, 'local', ctx())) }),
        h('button', { type: 'button', class: 'text-button', text: t('conflict.useRemote'),
          onclick: () => attempt(() => resolveConflict(state, conflict.id, 'remote', ctx())) })));
  }));
}

async function refreshNotifications() {
  const status = element('notify-status');
  const timing = element('notify-timing');
  const permission = await permissionState().catch(() => 'unsupported');
  element('notify-allow').hidden = permission !== 'prompt';
  element('notify-exact').hidden = true;
  status.textContent = ['granted', 'denied', 'prompt', 'unsupported'].includes(permission) ? t('notify.' + permission) : '';
  if (!remindsOn(state, device.id)) {
    timing.textContent = t('notify.otherDevice');
  } else if (nativeReminders) {
    const exact = await exactTiming();
    element('notify-exact').hidden = !exact || exact === 'granted';
    timing.textContent = t(exact && exact !== 'granted' ? 'notify.androidLate' : 'notify.androidScheduled');
  } else if (desktop) {
    timing.textContent = t('notify.desktop');
  } else {
    timing.textContent = t('notify.browser');
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
  if (presetsEnabled() && openApps.length === 0) loadOpenApps(element('preset-feedback')).catch(reportError);
  if (!desktop) return;
  try {
    const status = await desktop.status();
    preferences.elements.startup.checked = status.startup;
    element('pairing-code').value = status.pairingCode ?? '';
    element('chrome-pairing').hidden = !status.pairingCode;
    if (!status.pairingCode) {
      element('settings-feedback').textContent = t('settings.pairingUnavailable');
    }
  } catch (error) {
    element('settings-feedback').textContent = translateError(error.message);
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
    for (const reminder of single) showNow('Fix Myself', reminderLine(reminder)).catch(() => {});
    if (missed.length) showNow('Fix Myself', t('reminder.missedClosed', { n: missed.length })).catch(() => {});
  }
  if (missed.length) missedCount = missed.length;
  applyState(markDelivered(state, [...single, ...missed].map((reminder) => reminder.id), now));
}

function scheduleReminders(now) {
  if (!nativeReminders) return;
  const upcoming = upcomingReminders(state, now, device.id).map((reminder) => ({
    id: reminder.id + (reminder.snoozedUntil ?? ''),
    at: reminder.snoozedUntil ?? reminder.fireAt,
    text: reminderLine(reminder)
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
  renderRules();
  renderPresets();
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
    if (focusNextStep && !element('detail-body').hidden) detailForm.elements.nextStep.focus();
  }
  focusNextStep = false;
  if (view === 'review') renderReview();
  if (view === 'settings') refreshPreferences();
  if (view === 'review' || view === 'settings') pullChromeReports().catch(reportError);
}

// Captures a task and returns its id, or null when validation fails.
function createTask(fields, feedback, success) {
  const before = new Set(state.tasks.map((task) => task.id));
  if (!attempt(() => captureTask(state, fields, ctx()), feedback, success)) return null;
  return state.tasks.find((task) => !before.has(task.id))?.id ?? null;
}

// Opens a new task's page with the cursor in Next step, ready for details.
function openForDetails(id) {
  focusNextStep = true;
  location.hash = '#task/' + encodeURIComponent(id);
}

function showTask() {
  element('task-dialog-title').textContent = t('dialog.addTask');
  element('task-feedback').textContent = '';
  taskForm.reset();
  taskForm.elements.plannedDate.value = location.hash === '#tasks' ? '' : currentDay;
  taskDialog.showModal();
}

// ---------------------------------------------------------------------------
// Event wiring

function wireToday() {
  element('mini-timer-toggle').addEventListener('change', (event) => changeMiniTimer({ enabled: event.target.checked }));
  element('mini-timer-through').addEventListener('change', (event) => changeMiniTimer({ clickThrough: event.target.checked }));
  desktop?.onMiniTimerToggle?.(() => changeMiniTimer({ enabled: !state.preferences.miniTimer.enabled }));
  // Closing the floating window itself (Alt+F4) turns the preference off, so the checkbox matches.
  desktop?.onMiniTimerClosed?.(() => changeMiniTimer({ enabled: false }));
  document.querySelectorAll('[data-add-task]').forEach((button) => button.addEventListener('click', showTask));
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { title, plannedDate, deadline, pinned } = taskForm.elements;
    const id = createTask({
      title: title.value,
      plannedDate: plannedDate.value,
      deadline: fromLocalInput(deadline.value),
      pinned: pinned.checked
    }, element('task-feedback'));
    if (!id) return;
    taskDialog.close();
    if (event.submitter?.value === 'details') openForDetails(id);
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
  element('start-focus').addEventListener('click', async () => {
    const select = element('focus-preset');
    const options = select.hidden ? {} : { presetId: select.value || null };
    options.taskId = element('focus-task').value || null;
    // The apps of the task's workspace are allowed for the session (WS-04).
    if (options.taskId && workspaceItemsEnabled()) {
      options.workspaceApps = await desktop.workspaceApps(options.taskId).catch(() => []);
    }
    attempt(() => startFocus(state, new Date(), { ...options, device: device.id }));
  });
  element('focus-workspace').addEventListener('click', () => {
    if (state.focus?.taskId) openWorkspace(state.focus.taskId, element('focus-workspace-feedback')).catch(reportError);
  });
  element('pause-focus').addEventListener('click', () => {
    attempt(() => state.focus?.segmentStart == null ? resumeFocus(state, ctx()) : pauseFocus(state, ctx()));
  });
  element('end-focus').addEventListener('click', () => {
    attempt(() => endFocus(state, ctx()));
  });
  element('strict-exit').addEventListener('click', () => {
    attempt(() => requestStrictExit(state, ctx()));
  });
  element('strict-stay').addEventListener('click', () => {
    attempt(() => cancelStrictExit(state, ctx()));
  });
  element('strict-exit-confirm').addEventListener('click', () => {
    attempt(() => exitStrictHold(state, element('strict-reason').value, ctx()));
  });
  element('next-select').addEventListener('change', (event) => {
    attempt(() => setNextAction(state, event.target.value || null, ctx()));
  });
  element('capture-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.target.elements.title;
    const feedback = element('capture-feedback');
    const id = createTask({ title: input.value }, feedback, t('tasks.captured'));
    if (id) {
      feedback.append(' ', h('a', {
        href: '#task/' + encodeURIComponent(id), class: 'text-link', text: t('tasks.addDetails'),
        onclick: (click) => { click.preventDefault(); openForDetails(id); }
      }));
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
    }, element('detail-feedback'), t('detail.saved'));
    if (saved) fillDetailForm(state.tasks.find((task) => task.id === currentTaskId));
  });
  element('delete-task').addEventListener('click', (event) => {
    confirmTwice(event.currentTarget, 'detail.delete', () => {
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
    const { start, end, strict } = event.target.elements;
    const task = state.tasks.find((item) => item.id === currentTaskId);
    if (editTask({ workBlocks: [...task.workBlocks, { start: fromLocalInput(start.value), end: fromLocalInput(end.value), strict: strict.checked }] },
      element('block-feedback'), t('detail.blockAdded'))) event.target.reset();
  });
  element('review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { result, evidence } = event.target.elements;
    editTask({ review: { result: result.value, evidence: evidence.value } }, element('review-feedback'), t('detail.reviewSaved'));
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
        feedback, t('review.workoutLogged'))) {
        minutes.value = '';
        photo.value = '';
      } else if (photoId) await deletePhoto(photoId);
    } catch (error) {
      feedback.textContent = translateError(error.message);
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
          ...state.preferences,
          focusMinutes: Number(duration.value),
          focusAtLogin: startup.checked && automatic.checked,
          domains: hosts,
          keepRunning: keepRunning.checked
        }
      });
      automatic.checked = state.preferences.focusAtLogin;
      feedback.textContent = t('settings.saved');
    } catch (error) {
      feedback.textContent = translateError(error.message);
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
    }, ctx()), element('planning-feedback'), t('settings.planningSaved'));
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
    element('sync-feedback').textContent = t('settings.renamed');
  });
  element('sync-download').addEventListener('click', downloadSyncFile);
  element('export-data').addEventListener('click', () => {
    downloadSyncFile();
    element('data-feedback').textContent = t('settings.exported');
  });
  element('sync-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(syncFileText());
      element('sync-feedback').textContent = t('settings.copied');
    } catch {
      element('sync-feedback').textContent = t('settings.noClipboardSync');
    }
  });
  element('sync-merge').addEventListener('click', async () => {
    const feedback = element('sync-feedback');
    const fileInput = element('sync-file');
    const textInput = element('sync-text');
    try {
      const text = fileInput.files[0] ? await fileInput.files[0].text() : textInput.value.trim();
      if (!text) throw new Error(t('settings.chooseSync'));
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('This file is not a Fix Myself sync file.');
      }
      const result = mergeSync(state, payload, ctx());
      applyState(result.state);
      const { added, updated, removed, conflicts } = result.summary;
      feedback.textContent = t('settings.merged', { device: payload.deviceName ?? t('settings.anotherDevice'), added, updated, removed })
        + (conflicts ? t('settings.mergeConflicts', { n: conflicts }) : '');
      fileInput.value = '';
      textInput.value = '';
    } catch (error) {
      feedback.textContent = translateError(error.message);
    }
  });
  element('erase-data').addEventListener('click', (event) => {
    confirmTwice(event.currentTarget, 'settings.erase', async () => {
      await clearPhotos().catch(reportError);
      photoUrls.clear();
      sectionCache.clear();
      applyState(registerDevice(eraseUserData(state), { ...device, platform: platformName() }));
      element('data-feedback').textContent = t('settings.erased');
    });
  });
  element('copy-pairing').addEventListener('click', async () => {
    const feedback = element('pairing-feedback');
    try {
      await navigator.clipboard.writeText(element('pairing-code').value);
      feedback.textContent = t('settings.codeCopied');
    } catch {
      feedback.textContent = t('settings.noClipboard');
    }
  });
  element('language-select').addEventListener('change', (event) => {
    localStorage.setItem(LANGUAGE_KEY, event.target.value);
    useLanguage(event.target.value);
    // Messages left by the previous language would now be mixed in; clear them.
    for (const node of document.querySelectorAll('.feedback')) node.textContent = '';
    sectionCache.clear();
    resetRuleForm();
    resetPresetForm();
    render();
    publishMiniTimer();
    if (currentView === 'task') renderDetail(false);
    if (currentView === 'settings') refreshNotifications().catch(reportError);
  });
}

async function boot() {
  useLanguage(detectLanguage(localStorage, navigator.languages ?? [navigator.language]));
  device = loadDevice();
  state = readState(localStorage);
  state = reconcileReminders(registerDevice(state, { ...device, platform: platformName() }));
  if (desktop?.platform === 'win32') element('windows-settings').hidden = false;
  if (desktop) element('browser-settings').hidden = false;
  if (presetsEnabled()) element('app-presets').hidden = false;
  // Settle first so a session left open while the app was closed is recorded with this device's id.
  // A damaged local record must not stop Today from opening; the interval retries and reports.
  await syncWorkspaces();
  try {
    state = applyPendingBlockChanges(state, ctx());
    if (!nativeReminders) state = tickStrict(state, strictCtx());
    state = settleFocus(state, ctx());
  } catch (error) {
    reportError(error);
  }
  if (desktop?.loginLaunch) state = onLogin(state);
  desktop?.setBackground?.(state.preferences.keepRunning).catch(reportError);
  saveState(localStorage, state);
  currentDay = planningDay(state);

  wireToday();
  wireDetail();
  wireWorkspace();
  wireReview();
  wireRules();
  wirePresets();
  wireAppLimits();
  wireSettings();
  window.addEventListener('hashchange', navigate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkRuleChanges();
      render();
      checkReminders();
    }
  });
  navigate();
  render();
  checkRuleChanges();
  checkReminders();
  setInterval(() => {
    tick += 1;
    checkRuleChanges();
    checkStrict();
    if (planningDay(state) !== currentDay) render();
    else renderTimer();
    if (tick % 15 === 0) checkReminders();
    if (tick % 30 === 0) pullChromeReports().catch(reportError);
  }, 1000);
}

boot().catch(reportError);
