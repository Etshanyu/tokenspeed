import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { WindowKey } from './agg/metrics.ts';
import type { Language } from './ui/i18n.ts';
import type { Page } from './ui/keys.ts';

export interface Preferences {
  page?: Page;
  srcFilter?: string;
  win?: WindowKey;
  themeIdx?: number;
  lang?: Language;
}

/** Per-user writable storage; never inside the installed npm package. */
export function defaultCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.TOKENSPEED_CACHE_DIR) return path.resolve(env.TOKENSPEED_CACHE_DIR);
  if (platform === 'win32') {
    return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'), 'tokenspeed');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Caches', 'tokenspeed');
  return path.posix.join(env.XDG_CACHE_HOME ?? path.posix.join(home, '.cache'), 'tokenspeed');
}

function validPreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const out: Preferences = {};
  if (['overview', 'timeline', 'models', 'requests'].includes(String(raw.page))) out.page = raw.page as Page;
  if (raw.srcFilter === 'all' || ['codex', 'claude', 'dsh'].includes(String(raw.srcFilter))) out.srcFilter = String(raw.srcFilter);
  if (['today', '7d', '30d', 'all'].includes(String(raw.win))) out.win = raw.win as WindowKey;
  if (typeof raw.themeIdx === 'number' && Number.isInteger(raw.themeIdx) && raw.themeIdx >= 0) out.themeIdx = raw.themeIdx;
  if (raw.lang === 'en' || raw.lang === 'zh') out.lang = raw.lang;
  return out;
}

export function loadPreferences(cacheDir: string): Preferences {
  try {
    return validPreferences(JSON.parse(readFileSync(path.join(cacheDir, 'preferences.json'), 'utf8')));
  } catch {
    return {};
  }
}

/** Small synchronous atomic write, invoked only when a preference actually changes. */
export function savePreferences(cacheDir: string, preferences: Preferences): void {
  const valid = validPreferences(preferences);
  try {
    mkdirSync(cacheDir, { recursive: true });
    const target = path.join(cacheDir, 'preferences.json');
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, target);
  } catch (err) {
    if (process.env.TOKENSPEED_DEBUG) console.error('[preferences] save failed:', err);
  }
}

export function clearStoredCache(cacheDir: string): void {
  rmSync(path.join(cacheDir, 'index.json'), { force: true });
}
