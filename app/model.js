export const DEFAULT_DOMAINS = ['youtube.com', 'facebook.com', 'instagram.com'];
export const STORAGE_KEY = 'fix-myself:v1';

function defaultState() {
  return {
    version: 1,
    mission: '',
    tasks: [],
    focus: null,
    lastLoginDay: null,
    preferences: { focusAtLogin: false, focusMinutes: 45, domains: [...DEFAULT_DOMAINS] }
  };
}

export function readState(storage) {
  const saved = storage.getItem(STORAGE_KEY);
  if (saved === null) return defaultState();
  const state = JSON.parse(saved);
  if (state?.version !== 1 || !Array.isArray(state.tasks) || !state.preferences) {
    throw new Error('This version cannot open the saved plan.');
  }
  return state;
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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

export function updateTask(state, fields, now = new Date()) {
  const title = fields.title.trim();
  if (!title) throw new Error('Enter a task title.');
  const existing = state.tasks.find((task) => task.id === fields.id);
  const nextPinCount = state.tasks.filter((task) => task.id !== fields.id && task.pinned && !task.completedAt).length;
  if (fields.pinned && !existing?.completedAt && nextPinCount >= 3) {
    throw new Error('Unpin a priority before adding another.');
  }
  const task = {
    id: existing?.id ?? globalThis.crypto.randomUUID(),
    title,
    plannedDate: fields.plannedDate || null,
    deadline: fields.deadline || null,
    pinned: Boolean(fields.pinned),
    createdAt: existing?.createdAt ?? now.toISOString(),
    completedAt: existing?.completedAt ?? null
  };
  const tasks = existing
    ? state.tasks.map((item) => item.id === task.id ? task : item)
    : [...state.tasks, task];
  return { ...state, tasks };
}

export function toggleTask(state, id, now = new Date()) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const completedAt = task.completedAt ? null : now.toISOString();
  return {
    ...state,
    tasks: state.tasks.map((item) => item.id === id ? {
      ...item,
      completedAt,
      pinned: completedAt ? false : item.pinned
    } : item)
  };
}

export function todayTasks(state, date = localDate()) {
  return state.tasks.filter((task) => {
    if (task.completedAt) return localDate(new Date(task.completedAt)) === date;
    return task.pinned || (task.plannedDate && task.plannedDate <= date)
      || (task.deadline && localDate(new Date(task.deadline)) <= date);
  });
}

export function nextTask(tasks) {
  return tasks.find((task) => task.pinned && !task.completedAt)
    ?? tasks.find((task) => !task.completedAt)
    ?? null;
}

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
  const day = localDate(now);
  if (!state.preferences.focusAtLogin || state.lastLoginDay === day) return state;
  return { ...startFocus(state, now), lastLoginDay: day };
}

export function focusSnapshot(state, now = new Date()) {
  if (!isFocused(state.focus, now.getTime())) return null;
  return {
    ...state.focus,
    nextAction: nextTask(todayTasks(state, localDate(now)))?.title ?? null
  };
}
