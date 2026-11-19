import {
  DEFAULT_DOMAINS, focusSnapshot, isFocused, localDate, nextTask, normalizeDomains,
  onLogin, readState, saveState, startFocus, todayTasks, toggleTask, updateTask
} from './model.js';

const desktop = window.fixMyselfDesktop;
const element = (id) => document.getElementById(id);
const preferences = element('preferences');
const taskDialog = element('task-dialog');
const taskForm = element('task-form');
const missionDialog = element('mission-dialog');
const missionForm = element('mission-form');
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let state;
let currentDay;
let editingTask;
let previousFocusStatus;

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

function syncChrome() {
  if (desktop) desktop.publishFocus(focusSnapshot(state)).catch(reportError);
}

function renderTimer(now = Date.now()) {
  const active = isFocused(state.focus, now);
  const seconds = active ? Math.ceil((state.focus.endAt - now) / 1000) : state.preferences.focusMinutes * 60;
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  element('focus-time').textContent = remaining;
  element('start-focus').hidden = active;
  const status = active
    ? desktop ? 'Focus in progress. Paired Chrome profiles follow this session.' : 'Focus timer is running on this device.'
    : desktop ? '' : 'Timer only on this device.';
  if (element('focus-status').textContent !== status) element('focus-status').textContent = status;
  if (previousFocusStatus !== active) {
    previousFocusStatus = active;
    syncChrome();
  }
}

function navigate() {
  const requested = location.hash.slice(1);
  const view = ['today', 'tasks', 'settings'].includes(requested) ? requested : 'today';
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll('.nav-link')) {
    if (link.hash === '#' + view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (view === 'settings') refreshPreferences();
}

function renderList(id, tasks, firstTask) {
  const list = element(id + '-list');
  const previous = document.activeElement;
  const previousTask = previous?.dataset.taskId;
  const previousControl = previous?.tagName;
  list.replaceChildren();
  const ordered = [
    ...(firstTask ? [firstTask] : []),
    ...tasks.filter((task) => task.id !== firstTask?.id)
  ];
  for (const task of ordered) {
    const row = document.createElement('li');
    row.className = 'task';
    const done = document.createElement('input');
    done.type = 'checkbox';
    done.checked = Boolean(task.completedAt);
    done.dataset.taskId = task.id;
    done.setAttribute('aria-label', 'Complete ' + task.title);
    done.addEventListener('change', () => {
      try {
        applyState(toggleTask(state, task.id));
      } catch (error) {
        done.checked = Boolean(task.completedAt);
        reportError(error);
      }
    });
    const detail = document.createElement('div');
    detail.className = 'task-detail';
    const title = document.createElement('p');
    title.className = 'task-title';
    title.textContent = task.title;
    const meta = document.createElement('p');
    meta.className = 'task-meta';
    meta.textContent = [
      task.id === firstTask?.id ? 'Next action' : '',
      task.pinned ? 'Priority' : '',
      task.plannedDate ? 'Planned ' + shortDate.format(new Date(task.plannedDate + 'T12:00:00')) : '',
      task.deadline ? 'Due ' + dateTime.format(new Date(task.deadline)) : ''
    ].filter(Boolean).join(' · ');
    detail.append(title, meta);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-button';
    edit.dataset.taskId = task.id;
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', 'Edit ' + task.title);
    edit.addEventListener('click', () => showTask(task));
    row.append(done, detail, edit);
    list.append(row);
    if (previousTask === task.id) {
      if (previousControl === 'INPUT') done.focus();
      if (previousControl === 'BUTTON') edit.focus();
    }
  }
  element(id + '-empty').hidden = tasks.length > 0;
}

function render() {
  const now = new Date();
  currentDay = localDate(now);
  const tasks = todayTasks(state, currentDay);
  const done = tasks.filter((task) => task.completedAt).length;
  element('today-date').textContent = longDate.format(now);
  element('mission-summary').textContent = state.mission || 'Set the direction for your day.';
  element('plan-count').textContent = tasks.length ? `${done} of ${tasks.length} complete` : '';
  renderList('today', tasks, nextTask(tasks));
  renderList('all', state.tasks, null);
  renderTimer(now.getTime());
  syncChrome();
}

function showTask(task) {
  editingTask = task?.id;
  element('task-dialog-title').textContent = task ? 'Edit task' : 'Add task';
  element('task-feedback').textContent = '';
  taskForm.elements.title.value = task?.title ?? '';
  taskForm.elements.plannedDate.value = task?.plannedDate ?? (task || location.hash === '#tasks' ? '' : localDate());
  const due = task?.deadline ? new Date(task.deadline) : null;
  const asLocal = due ? new Date(due.getTime() - due.getTimezoneOffset() * 60_000) : null;
  taskForm.elements.deadline.value = asLocal?.toISOString().slice(0, 16) ?? '';
  taskForm.elements.pinned.checked = task?.pinned ?? false;
  taskForm.elements.pinned.disabled = Boolean(task?.completedAt);
  taskDialog.showModal();
}

async function refreshPreferences() {
  const { focusMinutes, domains, focusAtLogin } = state.preferences;
  preferences.elements.duration.value = focusMinutes;
  preferences.elements.domains.value = domains.join('\n');
  preferences.elements.automatic.checked = focusAtLogin;
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

async function boot() {
  state = readState(localStorage);
  if (desktop?.platform === 'win32') element('windows-settings').hidden = false;
  if (desktop) element('browser-settings').hidden = false;
  if (desktop?.loginLaunch) applyState(onLogin(state));

  document.querySelectorAll('[data-add-task]').forEach((button) => {
    button.addEventListener('click', () => showTask());
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });

  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { title, plannedDate, deadline, pinned } = taskForm.elements;
    try {
      applyState(updateTask(state, {
        id: editingTask,
        title: title.value,
        plannedDate: plannedDate.value,
        deadline: deadline.value ? new Date(deadline.value).toISOString() : null,
        pinned: pinned.checked
      }));
      taskDialog.close();
    } catch (error) {
      element('task-feedback').textContent = error.message;
    }
  });

  element('edit-mission').addEventListener('click', () => {
    missionForm.elements.mission.value = state.mission;
    element('mission-feedback').textContent = '';
    missionDialog.showModal();
  });
  missionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      applyState({ ...state, mission: missionForm.elements.mission.value.trim() });
      missionDialog.close();
    } catch (error) {
      element('mission-feedback').textContent = error.message;
    }
  });

  element('start-focus').addEventListener('click', () => {
    try {
      applyState(startFocus(state));
    } catch (error) {
      reportError(error);
    }
  });

  preferences.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = element('settings-feedback');
    const { duration, startup, automatic, domains } = preferences.elements;
    const submit = preferences.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const hosts = desktop ? normalizeDomains(domains.value) : [...DEFAULT_DOMAINS];
      if (desktop?.platform === 'win32') await desktop.setStartup(startup.checked);
      applyState({
        ...state,
        preferences: { focusMinutes: Number(duration.value), focusAtLogin: startup.checked && automatic.checked, domains: hosts }
      });
      automatic.checked = state.preferences.focusAtLogin;
      feedback.textContent = 'Settings saved.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
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

  window.addEventListener('hashchange', navigate);
  navigate();
  render();
  setInterval(() => {
    if (localDate() !== currentDay) render();
    else renderTimer();
  }, 1000);
}

boot().catch(reportError);
