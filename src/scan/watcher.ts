import { watch, statSync, readdirSync, existsSync } from 'node:fs';
import type { FSWatcher, Dirent } from 'node:fs';

/**
 * Debounced dirty signal over a set of directories.
 * Uses recursive fs.watch where available (Windows/macOS), falls back to polling.
 */
export function startWatch(
  dirs: string[],
  onDirty: () => void,
  opts: { pollMs?: number } = {},
): () => void {
  const pollMs = opts.pollMs ?? 5000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const watchers: FSWatcher[] = [];
  const pollers: ReturnType<typeof setInterval>[] = [];
  let lastSnapshot: Map<string, number> | null = null;

  const fire = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) onDirty();
    }, 300);
  };

  const snapshot = (): Map<string, number> => {
    const m = new Map<string, number>();
    const walk = (dir: string): void => {
      try {
        m.set(dir, statSync(dir).mtimeMs);
      } catch {
        return;
      }
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(dir + '/' + e.name);
      }
    };
    for (const d of dirs) if (existsSync(d)) walk(d);
    return m;
  };

  const mapsEqual = (a: Map<string, number>, b: Map<string, number>): boolean => {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  };

  const startPolling = (): void => {
    if (pollers.length > 0) return;
    lastSnapshot ??= snapshot();
    pollers.push(
      setInterval(() => {
        const snap = snapshot();
        if (!mapsEqual(snap, lastSnapshot!)) fire();
        lastSnapshot = snap;
      }, pollMs),
    );
  };

  let anyWatchOk = false;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const w = watch(dir, { recursive: true }, () => fire());
      w.on('error', () => startPolling());
      watchers.push(w);
      anyWatchOk = true;
    } catch {
      // this directory cannot be watched; polling covers it
    }
  }
  if (!anyWatchOk) startPolling();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
    for (const p of pollers) clearInterval(p);
  };
}
