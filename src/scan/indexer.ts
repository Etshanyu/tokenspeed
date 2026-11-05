import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FileEntry, SourceAdapter, TurnRecord } from '../sources/types.ts';

export const CACHE_VERSION = 1;

export interface IndexStore {
  version: number;
  files: Record<string, { mtimeMs: number; size: number; records: TurnRecord[] }>;
}

export interface ScanResult {
  records: TurnRecord[];
  scanned: number;
  fromCache: number;
}

export function loadCache(cachePath: string): IndexStore | null {
  let raw: string;
  try {
    raw = readFileSync(cachePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object' &&
      parsed.version === CACHE_VERSION &&
      parsed.files && typeof parsed.files === 'object'
    ) {
      return parsed as IndexStore;
    }
    return null;
  } catch {
    return null;
  }
}

export async function scanAll(opts: {
  adapters: SourceAdapter[];
  root: string;
  cache: IndexStore | null;
  onProgress?: (p: { done: number; total: number; file: string }) => void;
}): Promise<{ store: IndexStore; result: ScanResult }> {
  const { adapters, root, cache, onProgress } = opts;

  const entries: { adapter: SourceAdapter; file: FileEntry }[] = [];
  for (const adapter of adapters) {
    if (!adapter.available(root)) continue;
    for (const file of adapter.discover(root)) {
      entries.push({ adapter, file });
    }
  }

  const store: IndexStore = { version: CACHE_VERSION, files: {} };
  const records: TurnRecord[] = [];
  let scanned = 0;
  let fromCache = 0;
  let done = 0;

  for (const { adapter, file } of entries) {
    const cached = cache?.files[file.path];
    let fileRecords: TurnRecord[];
    if (
      cached &&
      cached.mtimeMs === file.mtimeMs &&
      cached.size === file.size
    ) {
      fileRecords = cached.records;
      fromCache++;
    } else {
      try {
        fileRecords = await adapter.parse(root, file);
      } catch {
        fileRecords = []; // unreadable/rolled-mid-write: retry next scan when it changes
      }
      scanned++;
    }
    store.files[file.path] = { mtimeMs: file.mtimeMs, size: file.size, records: fileRecords };
    records.push(...fileRecords);
    done++;
    onProgress?.({ done, total: entries.length, file: path.basename(file.path) });
  }

  return { store, result: { records, scanned, fromCache } };
}

export async function saveCache(cachePath: string, store: IndexStore): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = cachePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(store));
  await fs.rename(tmp, cachePath);
}
