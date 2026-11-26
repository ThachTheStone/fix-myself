// Protected storage for the Supabase session (SYS-03). Values are encrypted with
// Electron safeStorage (Windows user protection) and never written as plain text.
const { dirname } = require('node:path');

const KEY_PATTERN = /^sb-[A-Za-z0-9._-]{1,124}$/;
const MAX_VALUE = 65536;
const MAX_KEYS = 50;

const invalid = () => new Error('Invalid secret request.');
const validKey = (key) => {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw invalid();
  return key;
};

// `fs`: { readFile(path, 'utf8'), writeFile(path, text), rename(from, to), mkdir(dir, options) } (promises)
function createSecrets({ safeStorage, fs, filePath }) {
  let chain = Promise.resolve();
  const serial = (run) => {
    const next = chain.then(run, run);
    chain = next.then(() => {}, () => {});
    return next;
  };

  async function load() {
    let data;
    try {
      data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      return {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const entries = {};
    for (const [key, value] of Object.entries(data)) {
      if (KEY_PATTERN.test(key) && typeof value === 'string') entries[key] = value;
    }
    return entries;
  }

  async function save(entries) {
    const tmp = `${filePath}.tmp`;
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(entries));
    await fs.rename(tmp, filePath);
  }

  return {
    async get(key) {
      validKey(key);
      return serial(async () => {
        const encoded = (await load())[key];
        if (encoded === undefined) return null;
        try {
          return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
        } catch {
          return null;
        }
      });
    },

    async set(key, value) {
      validKey(key);
      if (typeof value !== 'string' || value.length > MAX_VALUE) throw invalid();
      return serial(async () => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Protected storage is unavailable on this computer.');
        const entries = await load();
        if (!(key in entries) && Object.keys(entries).length >= MAX_KEYS) throw new Error('Too many stored secrets.');
        entries[key] = Buffer.from(safeStorage.encryptString(value)).toString('base64');
        await save(entries);
      });
    },

    async remove(key) {
      validKey(key);
      return serial(async () => {
        const entries = await load();
        if (!(key in entries)) return;
        delete entries[key];
        await save(entries);
      });
    }
  };
}

module.exports = { createSecrets, KEY_PATTERN, MAX_VALUE, MAX_KEYS };
