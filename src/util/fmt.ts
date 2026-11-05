import stringWidth from 'string-width';

function stripTrailingZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 999→"999", 1234→"1.2k", 1000→"1k", 2.5e9→"2.5B" */
export function fmtTok(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const tiers: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [div, suffix] of tiers) {
    if (n >= div) return stripTrailingZero((n / div).toFixed(1)) + suffix;
  }
  return String(n);
}

/** 42s / 1m27s / 3.5h / 2d5h */
export function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = ms / 3_600_000;
  if (h < 24) return stripTrailingZero(h.toFixed(1)) + 'h';
  const d = Math.floor(h / 24);
  return `${d}d${Math.floor(h % 24)}h`;
}

/** null→"—"; <100 keep 1 decimal; ≥100 integer */
export function fmtTps(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—';
  if (x < 100) return stripTrailingZero(x.toFixed(1));
  return String(Math.round(x));
}

/** 0.925→"92.5%", 1→"100%" */
export function fmtPct(x: number): string {
  return stripTrailingZero((x * 100).toFixed(1)) + '%';
}

/** Terminal display width (CJK counts 2). */
export function displayWidth(s: string): number {
  return stringWidth(s);
}

/** Truncate to display width w with a trailing ellipsis when needed. */
export function truncateToWidth(s: string, w: number): string {
  if (w < 1) return '';
  if (displayWidth(s) <= w) return s;
  let out = '';
  let width = 0;
  for (const ch of s) {
    const cw = stringWidth(ch);
    if (width + cw > w - 1) break;
    out += ch;
    width += cw;
  }
  return out + '…';
}

/** "C--Users-x-Desktop-developer-console" → "console" */
export function projShort(proj: string): string {
  const i = proj.lastIndexOf('-');
  return i === -1 ? proj : proj.slice(i + 1);
}

/** uuid → first 8 chars */
export function sidShort(sid: string): string {
  return sid.slice(0, 8);
}
