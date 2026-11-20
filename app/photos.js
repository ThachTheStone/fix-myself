// Workout photos stay in this device's IndexedDB and are never part of sync files.
const DB_NAME = 'fix-myself-photos';
const STORE = 'photos';
const MAX_EDGE = 1600;

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
    });
  } finally {
    db.close();
  }
}

async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The photo could not be read.')), 'image/jpeg', 0.85);
  });
}

export async function savePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const blob = await shrink(file);
  const id = globalThis.crypto.randomUUID();
  await run('readwrite', (store) => store.put(blob, id));
  return id;
}

export async function photoUrl(id) {
  const blob = await run('readonly', (store) => store.get(id));
  return blob ? URL.createObjectURL(blob) : null;
}

export async function deletePhoto(id) {
  await run('readwrite', (store) => store.delete(id));
}

export async function clearPhotos() {
  await run('readwrite', (store) => store.clear());
}
