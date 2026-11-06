export type SourceId = string;

export interface FileEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface TurnRecord {
  src: SourceId;
  sid: string;
  proj: string;
  ts: number;
  model: string;
  inTok: number;
  cacheRead: number;
  cacheWrite: number;
  outTok: number;
  reasonTok: number;
  durMs: number;
  /** Session-only totals cannot be attributed to individual requests or time buckets. */
  kind?: 'session';
  /** Actual model calls represented by a cumulative session record. */
  requestCount?: number;
}

export interface SourceAdapter {
  id: SourceId;
  label: string;
  color: string;
  available(root: string): boolean;
  discover(root: string): FileEntry[];
  parse(root: string, file: FileEntry): Promise<TurnRecord[]>;
  /** Data directories to watch for LIVE updates. Adapters must NOT return the whole home. */
  watchDirs?(root: string): string[];
}
