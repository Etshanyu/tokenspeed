import type { SourceAdapter, SourceId } from './types.ts';
import { codexAdapter } from './codex.ts';
import { claudeAdapter } from './claude.ts';
import { dshAdapter } from './dsh.ts';

/** Registry order drives card order, filter keys and heat-strip rows (screenshot order). */
export const ADAPTERS: SourceAdapter[] = [codexAdapter, claudeAdapter, dshAdapter];

export interface FilterKey {
  key: string;
  src: SourceId | 'all';
}

export function filterKeys(adapters: SourceAdapter[]): FilterKey[] {
  const keys: FilterKey[] = [{ key: '1', src: 'all' }];
  adapters.forEach((a, i) => keys.push({ key: String(i + 2), src: a.id }));
  return keys;
}
