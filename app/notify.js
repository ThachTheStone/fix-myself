// Notification delivery for each platform. Android schedules reminders with the
// OS so they arrive while the app is closed. Windows (Electron) and the browser
// preview show them while the app is running.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export const nativeReminders = Capacitor.isNativePlatform();
const MAX_SCHEDULED = 60;

function numericId(text) {
  let hash = 0;
  for (const character of text) hash = (Math.imul(hash, 31) + character.codePointAt(0)) | 0;
  return Math.abs(hash) % 2_000_000_000 + 1;
}

export async function permissionState() {
  if (nativeReminders) {
    const { display } = await LocalNotifications.checkPermissions();
    return display.startsWith('prompt') ? 'prompt' : display;
  }
  if (!('Notification' in globalThis)) return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

export async function requestPermission() {
  if (nativeReminders) return (await LocalNotifications.requestPermissions()).display;
  if (!('Notification' in globalThis)) return 'unsupported';
  return Notification.requestPermission();
}

// Android 12+ may deliver reminders late unless exact alarms are allowed.
export async function exactTiming() {
  if (!nativeReminders || Capacitor.getPlatform() !== 'android') return null;
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm;
  } catch {
    return null;
  }
}

export async function openExactTimingSetting() {
  return LocalNotifications.changeExactNotificationSetting();
}

export async function showNow(title, body) {
  if (nativeReminders) return false;
  if ((await permissionState()) !== 'granted') return false;
  const notification = new Notification(title, { body, tag: 'fix-myself-' + numericId(title + body) });
  notification.addEventListener('click', () => {
    globalThis.focus?.();
    location.hash = '#today';
  });
  return true;
}

let scheduledSignature = '';

// Replaces the OS schedule with the given upcoming reminders (Android only).
export async function scheduleUpcoming(reminders) {
  if (!nativeReminders) return;
  const list = reminders.slice(0, MAX_SCHEDULED).map((reminder) => ({
    id: numericId(reminder.id),
    title: 'Fix Myself',
    body: reminder.text,
    schedule: { at: new Date(reminder.at), allowWhileIdle: true }
  }));
  const signature = JSON.stringify(list);
  if (signature === scheduledSignature) return;
  if ((await permissionState()) !== 'granted') return;
  const { notifications } = await LocalNotifications.getPending();
  if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map(({ id }) => ({ id })) });
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  scheduledSignature = signature;
}
