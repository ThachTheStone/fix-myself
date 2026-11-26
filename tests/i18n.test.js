import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectLanguage, dictionaryKeys, setLanguage, t, translateError, LANGUAGE_KEY } from '../app/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('English and Vietnamese define the same keys and placeholders', () => {
  const english = dictionaryKeys('en');
  assert.deepEqual([...dictionaryKeys('vi')].sort(), [...english].sort());
  for (const key of english) {
    setLanguage('en');
    const en = t(key);
    setLanguage('vi');
    assert.deepEqual(placeholders(t(key)), placeholders(en), key);
  }
});

test('every key used in index.html and main.js exists', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  const keys = new Set(dictionaryKeys('en'));
  const used = [
    ...[...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)].map((match) => match[1]),
    ...[...script.matchAll(/\bt\('([a-z][\w.]*\w)'[,)]/g)].map((match) => match[1])
  ];
  for (const key of used) {
    assert.ok(keys.has(key) || (keys.has(key + '.one') && keys.has(key + '.other')), key);
  }
});

test('plurals, parameters and error messages follow the language', () => {
  setLanguage('en');
  assert.equal(t('focus.coverage', { n: 1 }), 'Blocking in 1 Chrome profile.');
  assert.equal(t('focus.coverage', { n: 3 }), 'Blocking in 3 Chrome profiles.');
  assert.equal(translateError('Enter a task title.'), 'Enter a task title.');
  setLanguage('vi');
  assert.equal(t('today.planCount', { done: 1, total: 2 }), 'Đã xong 1/2');
  assert.equal(translateError('Enter a task title.'), 'Nhập tên công việc.');
  assert.equal(translateError('The mission must be 240 characters or fewer.'), 'Sứ mệnh tối đa 240 ký tự.');
  assert.equal(translateError('Something unexpected'), 'Something unexpected');
  setLanguage('en');
});

test('language comes from the saved choice, then the system language', () => {
  const storage = (value) => ({ getItem: (key) => (key === LANGUAGE_KEY ? value : null) });
  assert.equal(detectLanguage(storage('vi'), ['en-US']), 'vi');
  assert.equal(detectLanguage(storage('en'), ['vi-VN']), 'en');
  assert.equal(detectLanguage(storage(null), ['vi-VN', 'en']), 'vi');
  assert.equal(detectLanguage(storage('fr'), ['fr-FR']), 'en');
});

test('errors from the main process lose the Electron prefix before they are translated', () => {
  const wrapped = "Error invoking remote method 'desktop:workspace-add-app': Error: Choose an app from the list.";
  setLanguage('en');
  assert.equal(translateError(wrapped), 'Choose an app from the list.');
  setLanguage('vi');
  assert.equal(translateError(wrapped), 'Hãy chọn ứng dụng từ danh sách.');
  setLanguage('en');
});
