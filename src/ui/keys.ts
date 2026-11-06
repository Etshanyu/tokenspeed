import type { WindowKey } from '../agg/metrics.ts';

export type Page = 'overview' | 'timeline' | 'models' | 'requests';

export type KeyAction =
  | { t: 'page'; p: Page }
  | { t: 'src'; key: string }
  | { t: 'srcSet'; src: string }
  | { t: 'win'; w: WindowKey }
  | { t: 'winCycle' }
  | { t: 'theme' }
  | { t: 'refresh' }
  | { t: 'quit' }
  | { t: 'tab' }
  | { t: 'tabBack' }
  | { t: 'up' } | { t: 'down' } | { t: 'top' } | { t: 'bottom' }
  | { t: 'left' } | { t: 'right' } | { t: 'enter' };

const PAGES: Page[] = ['overview', 'timeline', 'models', 'requests'];

/**
 * Ink's useInput does not surface F-keys on every terminal, so the app listens
 * to raw stdin itself; this pure mapper is the single source of key truth.
 */
export function parseKey(buf: string): KeyAction | null {
  switch (buf) {
    case '\x1bOP': case '\x1b[11~': return { t: 'page', p: 'overview' };
    case '\x1bOQ': case '\x1b[12~': return { t: 'page', p: 'timeline' };
    case '\x1bOR': case '\x1b[13~': return { t: 'page', p: 'models' };
    case '\x1bOS': case '\x1b[14~': return { t: 'page', p: 'requests' };
    case '\t': return { t: 'tab' };
    case '\x1b[Z': return { t: 'tabBack' };
    case '\x1b[A': case 'k': return { t: 'up' };
    case '\x1b[B': case 'j': return { t: 'down' };
    case '\x1b[C': return { t: 'right' };
    case '\x1b[D': return { t: 'left' };
    case '\r': case '\n': return { t: 'enter' };
    case 'g': return { t: 'top' };
    case 'G': return { t: 'bottom' };
    case 't': return { t: 'win', w: 'today' };
    case 'w': return { t: 'winCycle' };
    case 'a': return { t: 'win', w: 'all' };
    case 'r': return { t: 'refresh' };
    case 'x': return { t: 'theme' };
    case 'q': case '\x03': return { t: 'quit' };
  }
  if (/^[1-9]$/.test(buf)) return { t: 'src', key: buf };
  return null;
}

export function cyclePage(p: Page, dir: 1 | -1): Page {
  const i = PAGES.indexOf(p);
  return PAGES[(i + dir + PAGES.length) % PAGES.length];
}

export const ALL_PAGES = PAGES;

interface RawModeStdin {
  isTTY?: boolean;
  setRawMode?(v: boolean): unknown;
}

/**
 * Ink only enables raw mode via useInput/useFocus; our custom stdin listener
 * must switch the terminal to raw mode itself or keys arrive line-buffered.
 * Returns a restore function, or null when raw mode is unavailable.
 */
export function enableRawMode(stdin: RawModeStdin): (() => void) | null {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return null;
  try {
    stdin.setRawMode(true);
  } catch {
    return null;
  }
  return () => {
    try {
      stdin.setRawMode!(false);
    } catch {
      // stream already destroyed
    }
  };
}
