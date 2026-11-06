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
    // 0.9995 factor: a value that rounds up to 1000.0 of a tier belongs to the next one
    if (n >= div * 0.9995) return stripTrailingZero((n / div).toFixed(1)) + suffix;
  }
  return String(n);
}

/** Compact English or Chinese duration. */
export function fmtDur(ms: number, lang: 'en' | 'zh' = 'en'): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return lang === 'zh' ? `${s}秒` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    if (lang === 'zh') return s % 60 === 0 ? `${m}分` : `${m}分${s % 60}秒`;
    return s % 60 === 0 ? `${m}m` : `${m}m${s % 60}s`;
  }
  if (m < 1440) {
    const h = Math.floor(m / 60);
    return lang === 'zh'
      ? `${h}小时${String(m % 60).padStart(2, '0')}分`
      : `${h}h${String(m % 60).padStart(2, '0')}m`;
  }
  const d = Math.floor(m / 1440);
  return lang === 'zh' ? `${d}天${Math.floor((m % 1440) / 60)}小时` : `${d}d${Math.floor((m % 1440) / 60)}h`;
}

/** Freshness suffix for the header clock. */
export function fmtAgo(ms: number, lang: 'en' | 'zh' = 'en'): string {
  if (ms < 60_000) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return lang === 'zh' ? `${s}秒` : `${s}s`;
  }
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
    return lang === 'zh' ? `${m}分${s}秒` : `${m}m${s}s`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
    return lang === 'zh' ? `${h}小时${m}分` : `${h}h${m}m`;
  }
  const d = Math.floor(ms / 86_400_000);
  return lang === 'zh' ? `${d}天` : `${d}d`;
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

/** Remove control sequences originating in logs before they reach the terminal. */
export function sanitizeText(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/** Terminal display width (CJK counts 2). */
export function displayWidth(s: string): number {
  return stringWidth(s);
}

/** Sanitize and truncate to display width w with a trailing ellipsis when needed. */
export function truncateToWidth(value: string, w: number): string {
  if (w < 1) return '';
  const s = sanitizeText(value);
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
