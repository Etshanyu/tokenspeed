/** Pure string chart primitives. All functions are terminal-safe Unicode blocks only. */

export function hexToAnsi(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** Resample values to n buckets by mean. */
function resample(values: number[], n: number): number[] {
  if (n <= 0) return [];
  if (values.length === 0) return new Array<number>(n).fill(0);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < values.length; i++) {
    const idx = Math.min(n - 1, Math.floor((i / values.length) * n));
    out[idx] += values[i];
  }
  // average buckets that received multiple values (when compressing)
  const ratio = values.length / n;
  if (ratio > 1) for (let i = 0; i < n; i++) out[i] /= Math.max(1, Math.round(ratio));
  return out;
}

const SPARK_LEVELS = '▁▂▃▄▅▆▇█';
const HEAT_LEVELS = '░▒▓█';

/** ▁▂▃▄▅▆▇█ sparkline, exactly `width` cells. */
export function sparkline(values: number[], width: number, color?: string): string {
  const v = resample(values, width);
  const max = Math.max(...v, 1);
  const body = v
    .map((x) => SPARK_LEVELS[Math.min(7, Math.round((x / max) * 7))])
    .join('');
  return color ? hexToAnsi(color) + body + '\x1b[0m' : body;
}

/** ░▒▓█ heat strip with truecolor intensity ramp, exactly `width` cells. */
export function heatStrip(values: number[], width: number, colors: string[]): string {
  if (width <= 0) return '';
  const v = resample(values, width);
  const max = Math.max(...v, 1);
  const levels = Math.max(1, colors.length);
  let out = '';
  for (const x of v) {
    const lvl = Math.min(levels - 1, Math.floor((x / max) * levels));
    out += hexToAnsi(colors[lvl]) + HEAT_LEVELS[Math.min(3, Math.floor(lvl / levels * 4))];
  }
  return out + '\x1b[0m';
}

/** Horizontal fill gauge; NaN or max<=0 renders the full track. */
export function gaugeBar(value: number, max: number, width: number, fill: string, track: string): string {
  const ratio = max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(ratio * width);
  return fill.repeat(filled) + track.repeat(Math.max(0, width - filled));
}

/**
 * Grouped vertical histogram using half-block glyphs.
 * Each of the `width` buckets gets one column per series, side by side.
 * Returns `height` rows, top row first; every row has width*series.length cells.
 */
export function histogram(
  series: { values: number[]; color: string }[],
  width: number,
  height: number,
): string[] {
  const n = series.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const sampled = series.map((s) => resample(s.values, width));
  const max = Math.max(1, ...sampled.flat());
  const pixels = height * 2; // two pixel rows per text row via ▀▄█

  // filled pixel count per column
  const fillPix = sampled.map((vals) => vals.map((x) => Math.round((x / max) * pixels)));

  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let line = '';
    const pixelRowsFromTop = (height - 1 - r) * 2; // bottom row covers pixels [0,2)
    for (let b = 0; b < width; b++) {
      for (let s = 0; s < n; s++) {
        const f = fillPix[s][b];
        const topOn = f > pixelRowsFromTop + 1;
        const bottomOn = f > pixelRowsFromTop;
        let ch = ' ';
        if (topOn && bottomOn) ch = '█';
        else if (topOn) ch = '▀';
        else if (bottomOn) ch = '▄';
        line += ch === ' ' ? ' ' : hexToAnsi(series[s].color) + ch + '\x1b[0m';
      }
    }
    rows.push(line);
  }
  return rows;
}
