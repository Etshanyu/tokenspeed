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
}

export interface SourceAdapter {
  id: SourceId;
  label: string;
  color: string;
  available(root: string): boolean;
  discover(root: string): FileEntry[];
  parse(root: string, file: FileEntry): TurnRecord[];
}
