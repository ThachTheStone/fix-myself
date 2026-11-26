// The copy of this device's plan saved before an account copy replaces it. It
// stays in IndexedDB, next to the photos, so it cannot fill localStorage.
const DB_NAME = 'fix-myself-cloud-backup';
const STORE = 'backup';
const KEY = 'cloud-backup';

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

export const saveBackup = (payload) => run('readwrite', (store) => store.put(JSON.stringify(payload), KEY));
export const readBackup = () => run('readonly', (store) => store.get(KEY)).then((value) => value ?? null);
export const deleteBackup = () => run('readwrite', (store) => store.delete(KEY));
