import assert from 'node:assert/strict';
import test from 'node:test';
import secretsModule from '../desktop/secrets.cjs';

const { createSecrets } = secretsModule;
const FILE = '/data/secrets.json';

function setup({ available = true, files = {} } = {}) {
  const store = { ...files };
  const log = [];
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`),
    decryptString: (buffer) => {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('bad');
      return text.slice(4);
    }
  };
  const fs = {
    mkdir: async () => {},
    readFile: async (path) => {
      if (!(path in store)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return store[path];
    },
    writeFile: async (path, text) => { await Promise.resolve(); log.push(['write', path]); store[path] = text; },
    rename: async (from, to) => { log.push(['rename', from, to]); store[to] = store[from]; delete store[from]; }
  };
  return { secrets: createSecrets({ safeStorage, fs, filePath: FILE }), store, log };
}

const b64 = (text) => Buffer.from(`enc:${text}`).toString('base64');

test('round trip and remove', async () => {
  const { secrets, store } = setup();
  assert.equal(await secrets.get('sb-a'), null);
  await secrets.set('sb-a', 'token');
  assert.equal(await secrets.get('sb-a'), 'token');
  assert.ok(!store[FILE].includes('token'));
  await secrets.remove('sb-a');
  assert.equal(await secrets.get('sb-a'), null);
  await secrets.remove('sb-a');
});

test('validates keys and values', async () => {
  const { secrets } = setup();
  for (const key of ['a', 'sb-', 'sb-a b', `sb-${'a'.repeat(125)}`, '__proto__', 5, null]) {
    await assert.rejects(secrets.get(key), /Invalid secret request\./);
    await assert.rejects(secrets.set(key, 'x'), /Invalid secret request\./);
    await assert.rejects(secrets.remove(key), /Invalid secret request\./);
  }
  await secrets.set(`sb-${'a'.repeat(124)}`, 'x');
  await assert.rejects(secrets.set('sb-a', 5), /Invalid secret request\./);
  await assert.rejects(secrets.set('sb-a', 'x'.repeat(65537)), /Invalid secret request\./);
  await secrets.set('sb-a', 'x'.repeat(65536));
});

test('limits to 50 keys', async () => {
  const { secrets } = setup();
  for (let i = 0; i < 50; i += 1) await secrets.set(`sb-${i}`, 'v');
  await assert.rejects(secrets.set('sb-extra', 'v'));
  await secrets.set('sb-0', 'new');
  assert.equal(await secrets.get('sb-0'), 'new');
  await secrets.remove('sb-1');
  await secrets.set('sb-extra', 'v');
});

test('a corrupt file reads as empty and an undecryptable entry as missing', async () => {
  const corrupt = setup({ files: { [FILE]: '{nope' } });
  assert.equal(await corrupt.secrets.get('sb-a'), null);
  await corrupt.secrets.set('sb-a', 'v');
  assert.equal(await corrupt.secrets.get('sb-a'), 'v');

  const array = setup({ files: { [FILE]: '[1]' } });
  assert.equal(await array.secrets.get('sb-a'), null);

  const mixed = setup({ files: { [FILE]: JSON.stringify({ 'sb-bad': Buffer.from('junk').toString('base64'), 'sb-ok': b64('fine') }) } });
  assert.equal(await mixed.secrets.get('sb-bad'), null);
  assert.equal(await mixed.secrets.get('sb-ok'), 'fine');
});

test('set throws without encryption, get and remove still work, nothing is written', async () => {
  const { secrets, store } = setup({ available: false, files: { [FILE]: JSON.stringify({ 'sb-a': b64('v') }) } });
  const before = store[FILE];
  await assert.rejects(secrets.set('sb-b', 'x'), /Protected storage is unavailable on this computer\./);
  assert.equal(store[FILE], before);
  assert.equal(await secrets.get('sb-a'), 'v');
  await secrets.remove('sb-a');
  assert.equal(await secrets.get('sb-a'), null);
});

test('concurrent operations are serialised', async () => {
  const { secrets } = setup();
  await Promise.all([
    secrets.set('sb-a', '1'),
    secrets.set('sb-b', '2'),
    secrets.remove('sb-a'),
    secrets.set('sb-c', '3')
  ]);
  assert.equal(await secrets.get('sb-a'), null);
  assert.equal(await secrets.get('sb-b'), '2');
  assert.equal(await secrets.get('sb-c'), '3');
});

test('a failed operation does not block the next one', async () => {
  const { secrets } = setup();
  await Promise.allSettled([secrets.set('sb-a', 'x'.repeat(65537)), secrets.set('sb-b', 'v')]);
  assert.equal(await secrets.get('sb-b'), 'v');
});

test('writes a temp file, then renames it', async () => {
  const { secrets, log, store } = setup();
  await secrets.set('sb-a', 'v');
  assert.deepEqual(log, [['write', `${FILE}.tmp`], ['rename', `${FILE}.tmp`, FILE]]);
  assert.ok(!(`${FILE}.tmp` in store));
});
