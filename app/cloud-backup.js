// The copies of this device's plan saved before an account copy replaces it. They
// stay in IndexedDB, next to the photos, so they cannot fill localStorage. The list
// is one record, newest first, and keeps the last few copies (see addBackup).
import { addBackup } from './cloud.js';

const DB_NAME = 'fix-myself-cloud-backup';
const STORE = 'backup';
const KEY = 'cloud-backups';
const LEGACY_KEY = 'cloud-backup';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Read and write in one transaction so two saves cannot lose each other.
export const saveBackup = (payload) => run('readwrite', (store) => {
  const read = store.get(KEY);
  read.onsuccess = () => {
    store.put(addBackup(read.result, payload, new Date(), globalThis.crypto.randomUUID()), KEY);
  };
  return read;
});

export const listBackups = () => run('readonly', (store) => store.get(KEY)).then((list) => (Array.isArray(list) ? list : []));

export const deleteBackups = () => run('readwrite', (store) => {
  store.delete(LEGACY_KEY);
  return store.delete(KEY);
});
