import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearStoredCache, defaultCacheDir, loadPreferences, savePreferences } from './config.ts';

test('defaultCacheDir follows each platform and honors explicit override', () => {
  assert.equal(
    defaultCacheDir({ LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' }, 'win32', 'C:\\Users\\demo'),
    path.win32.join('C:\\Users\\demo\\AppData\\Local', 'tokenspeed'),
  );
  assert.equal(defaultCacheDir({}, 'darwin', '/Users/demo'), '/Users/demo/Library/Caches/tokenspeed');
  assert.equal(defaultCacheDir({ XDG_CACHE_HOME: '/tmp/cache' }, 'linux', '/home/demo'), '/tmp/cache/tokenspeed');
  assert.equal(defaultCacheDir({}, 'linux', '/home/demo'), '/home/demo/.cache/tokenspeed');
  assert.equal(defaultCacheDir({ TOKENSPEED_CACHE_DIR: './custom' }, 'linux', '/home/demo'), path.resolve('./custom'));
});

test('preferences round-trip atomically and invalid fields are discarded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenspeed-preferences-'));
  try {
    savePreferences(dir, { page: 'models', srcFilter: 'dsh', win: 'all', themeIdx: 2, lang: 'zh' });
    assert.deepEqual(loadPreferences(dir), { page: 'models', srcFilter: 'dsh', win: 'all', themeIdx: 2, lang: 'zh' });
    await fs.writeFile(path.join(dir, 'preferences.json'), JSON.stringify({ page: 'bad', win: 7, themeIdx: -1, lang: 'fr', srcFilter: 'other' }));
    assert.deepEqual(loadPreferences(dir), {});
    await fs.writeFile(path.join(dir, 'preferences.json'), '{broken');
    assert.deepEqual(loadPreferences(dir), {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('clearStoredCache removes only the record index', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenspeed-clear-'));
  try {
    await fs.writeFile(path.join(dir, 'index.json'), '{}');
    savePreferences(dir, { lang: 'zh' });
    clearStoredCache(dir);
    await assert.rejects(fs.stat(path.join(dir, 'index.json')));
    assert.equal(loadPreferences(dir).lang, 'zh');
    clearStoredCache(dir); // idempotent
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
