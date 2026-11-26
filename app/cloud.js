// Account sync wiring (SYS-02, SYS-03, SYS-05, SYS-06) that does not touch the
// DOM: connection settings, the session storage choice, the Supabase client,
// the engine's memory and the sequences main.js runs around the engine.
import { createClient } from '@supabase/supabase-js';
import { mergeSync, PROTECTIONS_MESSAGE, protectionsActive, SYNCED_KEYS } from './model.js';

export const CLOUD_KEY = 'fix-myself:cloud';
export const ENGINE_PREFIX = 'fix-myself:cloud:';

const URL_PATTERN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const PUBLISHABLE_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{10,200}$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const SECRET_MESSAGE = 'Use the publishable or anon key, never the secret key.';
const CONFIG_MESSAGE = 'Check the project URL and key from Supabase → Project Settings → API.';
const INPUT_MESSAGE = 'Enter the code from the email, or paste the sign-in link without opening it.';

function jwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes))?.role ?? null;
  } catch {
    return null;
  }
}

// Returns the cleaned { url, anonKey } or throws a message the panel can show.
export function validateCloudConfig({ url, anonKey } = {}) {
  const cleanUrl = String(url ?? '').trim().replace(/\/+$/, '');
  const key = String(anonKey ?? '').trim();
  if (key.startsWith('sb_secret_')) throw new Error(SECRET_MESSAGE);
  if (!URL_PATTERN.test(cleanUrl)) throw new Error(CONFIG_MESSAGE);
  if (PUBLISHABLE_PATTERN.test(key)) return { url: cleanUrl, anonKey: key };
  if (key.length < 1000 && JWT_PATTERN.test(key)) {
    if (jwtRole(key) === 'service_role') throw new Error(SECRET_MESSAGE);
    return { url: cleanUrl, anonKey: key };
  }
  throw new Error(CONFIG_MESSAGE);
}

export function readCloudConfig(storage) {
  try {
    const saved = JSON.parse(storage.getItem(CLOUD_KEY));
    return saved ? validateCloudConfig(saved) : null;
  } catch {
    return null;
  }
}

export function saveCloudConfig(storage, config) {
  const clean = validateCloudConfig(config);
  storage.setItem(CLOUD_KEY, JSON.stringify(clean));
  return clean;
}

// On Windows the session lives in the encrypted store; elsewhere it stays in
// localStorage (a known limit on Android).
export function sessionStorageFor(desktop, storage) {
  if (typeof desktop?.secretGet === 'function') {
    return {
      getItem: (key) => desktop.secretGet(key),
      setItem: (key, value) => desktop.secretSet(key, value),
      removeItem: (key) => desktop.secretRemove(key)
    };
  }
  return storage;
}

export function createCloudClient(config, authStorage, create = createClient) {
  return create(config.url, config.anonKey, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
}

// The engine's own memory (last seen revision, binding, dirty flag).
export function engineStore(storage) {
  return {
    get(key) {
      const raw = storage.getItem(ENGINE_PREFIX + key);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(key, value) {
      storage.setItem(ENGINE_PREFIX + key, JSON.stringify(value ?? null));
    }
  };
}

// What the sign-in field accepts: a code of 6 to 10 digits, or the link from the
// default Supabase email (pasted, never opened) for this project.
export function parseSignInInput(text, projectUrl) {
  const value = String(text ?? '').trim();
  if (/^\d{6,10}$/.test(value)) return { kind: 'code', token: value };
  try {
    const link = new URL(value);
    const project = new URL(projectUrl);
    const token = link.searchParams.get('token');
    if (link.protocol === 'https:' && link.host === project.host && token) {
      const type = link.searchParams.get('type');
      return { kind: 'link', token_hash: token, type: type === 'signup' ? 'signup' : 'magiclink' };
    }
  } catch {
    // Falls through to the message below.
  }
  throw new Error(INPUT_MESSAGE);
}

// Only a change to what exportSync writes marks the plan dirty. The model is
// immutable, so a reference check is exact.
export const shouldNoteChange = (prev, next) => SYNCED_KEYS.some((key) => prev?.[key] !== next?.[key]);

// supabase-js emits SIGNED_IN again when a tab becomes visible, so the engine
// is started once per signed-in period. Work is deferred because calling the
// client from inside the callback can deadlock its auth lock. Each change of
// signed-in state starts a new epoch; a deferred step from an older epoch does
// nothing, so a late sign-out cannot overwrite what a newer sign-in reported.
// TOKEN_REFRESHED and repeated SIGNED_IN do not change the epoch.
// handler.invalidate() ends the current epoch (used by sign-out and change of connection).
export function createAuthHandler({ engine, setStatus, onSession = () => {}, defer = (fn) => setTimeout(fn, 0) }) {
  let running = false;
  let epoch = 0;
  const handler = (event, session) => {
    if ((event === 'INITIAL_SESSION' && session) || event === 'SIGNED_IN') {
      if (running) {
        onSession(session ?? null);
        return;
      }
      running = true;
      const mine = ++epoch;
      onSession(session ?? null);
      defer(() => { if (mine === epoch) return engine.start(); });
    } else if (event === 'INITIAL_SESSION') {
      // Nothing to call on the client here, so there is nothing to defer.
      running = false;
      epoch += 1;
      onSession(null);
      setStatus({ status: 'signed-out' });
    } else if (event === 'SIGNED_OUT') {
      running = false;
      const mine = ++epoch;
      defer(async () => {
        if (mine !== epoch) return;
        onSession(null);
        await engine.stop();
        if (mine === epoch) setStatus({ status: 'signed-out' });
      });
    }
  };
  handler.invalidate = () => {
    epoch += 1;
    running = false;
  };
  return handler;
}

// Local scope only: the default would sign out every device.
export async function signOutSequence({ client, engine, setStatus, auth }) {
  auth?.invalidate();
  await engine.stop();
  await client.auth.signOut({ scope: 'local' });
  setStatus({ status: 'signed-out' });
}

// Signs out, drops the old client and returns the new one. The binding is kept,
// so a different project shows up as an account change.
export async function changeConnection({ client, engine, setStatus, auth, unsubscribe = () => {}, storage, config, build }) {
  const clean = validateCloudConfig(config);
  await signOutSequence({ client, engine, setStatus, auth });
  // The sign-out above emits SIGNED_OUT; its deferred step must not reach the new connection.
  auth?.invalidate();
  unsubscribe();
  await client.removeAllChannels?.();
  saveCloudConfig(storage, clean);
  return build(clean);
}

export const MAX_BACKUPS = 5;

// Puts a new copy first and drops the oldest past MAX_BACKUPS. source is { uid, email } of the
// account whose plan this copy held, or null for a device that was not bound to an account.
export function addBackup(list, payload, now, id, source = null) {
  const kept = Array.isArray(list) ? list : [];
  return [{ id, savedAt: now.toISOString(), payload, source }, ...kept].slice(0, MAX_BACKUPS);
}

// True when a copy from another account is about to be merged into this one.
export const restoreNeedsConfirm = (item, boundUid) => Boolean(item?.source?.uid) && item.source.uid !== (boundUid ?? null);

// Restoring merges the copy into the current plan. Like a replace or an erase, it waits while
// block rules or strict blocks are active, because a copy can bring back a switched-off rule.
// The copy was written by this device, so there are no conflicts: the newer stamp of each field wins.
export function restoreBackup(state, payload, ctx) {
  if (protectionsActive(state, ctx.now)) throw new Error(PROTECTIONS_MESSAGE);
  return mergeSync(state, payload, { ...ctx, allowOwn: true });
}

// Erase flow after the user confirmed twice. A signed-in bound device erases the
// account copy through the engine; otherwise the plain erase runs. An error in the
// erase itself leaves everything as is. Once it has succeeded, the stored backups
// and the photos go too (SYS-05); a failure there is reported through onCleanupError
// and does not make the erase a failure.
export async function eraseAll({ state, engine, everywhere, plainErase, deleteBackup, clearPhotos, onCleanupError = () => {} }) {
  if (everywhere) await engine.eraseEverywhere(state);
  else plainErase();
  for (const cleanup of [deleteBackup, clearPhotos]) {
    try {
      await cleanup();
    } catch (error) {
      onCleanupError(error);
    }
  }
}
