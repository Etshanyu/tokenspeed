import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FileEntry, SourceAdapter, TurnRecord } from './types.ts';

export const dshAdapter: SourceAdapter = {
  id: 'dsh',
  label: 'DSH',
  color: '#f472b6',

  available(root: string): boolean {
    return existsSync(path.join(root, '.dsh', 'storages', 'session_projcache', 'sessions'));
  },

  watchDirs(root: string): string[] {
    return [path.join(root, '.dsh', 'storages')];
  },

  discover(root: string): FileEntry[] {
    const base = path.join(root, '.dsh', 'storages', 'session_projcache', 'sessions');
    if (!existsSync(base)) return [];
    const out: FileEntry[] = [];
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const p = path.join(base, e.name);
      try {
        const st = statSync(p);
        out.push({ path: p, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished */ }
    }
    return out;
  },

  async parse(_root: string, file: FileEntry): Promise<TurnRecord[]> {
    let doc: Record<string, any>;
    try {
      doc = JSON.parse(readFileSync(file.path, 'utf8'));
    } catch {
      return [];
    }
    const record = doc?.record;
    if (!record) return [];
    const identity = record.identity ?? {};
    const rows: Record<string, any> = record.rows ?? {};

    const totals = rows.tokenUsage?.val?.totals ?? {};
    const stats = rows.sessionStats?.val ?? {};
    const decodeMs = typeof stats.decodeMs === 'number' && stats.decodeMs > 0
      ? stats.decodeMs
      : (typeof stats.llmMs === 'number' && stats.llmMs > 0 ? stats.llmMs : 1000);
    const model = rows.modelSelection?.val?.lastUsed?.model;

    const name = path.basename(file.path, '.json');
    return [{
      src: 'dsh',
      sid: name.startsWith('session-') ? name.slice('session-'.length) : name,
      proj: typeof identity.cwd === 'string' ? identity.cwd : '',
      ts: typeof identity.createdAt === 'number' ? identity.createdAt : 0,
      model: typeof model === 'string' ? model : 'deepseek',
      inTok: totals.uncachedInputTokens ?? 0,
      cacheRead: totals.cacheReadTokens ?? 0,
      cacheWrite: totals.cacheWriteTokens ?? 0,
      outTok: totals.outputTokens ?? 0,
      reasonTok: 0,
      durMs: decodeMs,
    }];
  },
};
