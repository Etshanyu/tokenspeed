import React, { useEffect, useMemo, useReducer } from 'react';
import { Box, Text, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { homedir } from 'node:os';
import { ADAPTERS, filterKeys } from '../sources/index.ts';
import { THEMES } from '../theme.ts';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { fmtAgo } from '../util/fmt.ts';
import { ALL_PAGES, cyclePage, enableRawMode, parseKey } from './keys.ts';
import type { KeyAction, Page } from './keys.ts';
import { Overview } from './Overview.tsx';
import { Timeline } from './Timeline.tsx';
import { Models } from './Models.tsx';
import { Requests } from './Requests.tsx';

export interface AppState {
  page: Page;
  srcFilter: string; // SourceId | 'all'
  win: WindowKey;
  themeIdx: number;
  scroll: number;
  sortCol: number;
  sortDir: 1 | -1;
}

export function initialState(): AppState {
  return { page: 'overview', srcFilter: 'all', win: '7d', themeIdx: 0, scroll: 0, sortCol: 1, sortDir: -1 };
}

const WIN_ORDER: WindowKey[] = ['today', '7d', '30d', 'all'];
const MAX_SORT_COLS = 9;

export function appReducer(state: AppState, action: KeyAction): AppState {
  switch (action.t) {
    case 'page':
      return { ...state, page: action.p, scroll: 0 };
    case 'srcSet':
      return { ...state, srcFilter: action.src };
    case 'win':
      return { ...state, win: action.w };
    case 'winCycle':
      return { ...state, win: WIN_ORDER[(WIN_ORDER.indexOf(state.win) + 1) % WIN_ORDER.length] };
    case 'theme':
      return { ...state, themeIdx: (state.themeIdx + 1) % THEMES.length };
    case 'tab':
      return { ...state, page: cyclePage(state.page, 1), scroll: 0 };
    case 'tabBack':
      return { ...state, page: cyclePage(state.page, -1), scroll: 0 };
    case 'up':
      return { ...state, scroll: Math.max(0, state.scroll - 1) };
    case 'down':
      return { ...state, scroll: state.scroll + 1 };
    case 'top':
      return { ...state, scroll: 0 };
    case 'bottom':
      return { ...state, scroll: Number.MAX_SAFE_INTEGER };
    case 'left':
      return { ...state, sortCol: Math.max(0, state.sortCol - 1) };
    case 'right':
      return { ...state, sortCol: Math.min(MAX_SORT_COLS - 1, state.sortCol + 1) };
    case 'enter':
      return { ...state, sortDir: (state.sortDir === 1 ? -1 : 1) as 1 | -1 };
    default:
      return state;
  }
}

export interface AppProps {
  records: TurnRecord[];
  scan?: { done: number; total: number } | null;
  live?: boolean;
  lastRefresh?: number;
  booting?: boolean;
  now?: number;
  onRefresh?: () => void;
  onQuit?: () => void;
  initial?: { srcFilter?: string; win?: WindowKey; themeIdx?: number };
}

function clock(now: number): string {
  const d = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** CODEX -> Codex, DSH stays DSH (short acronyms) */
function prettyLabel(label: string): string {
  return label.length <= 3 ? label : label[0] + label.slice(1).toLowerCase();
}

export function App(props: AppProps): React.ReactElement {
  const { records, live = false, now = Date.now() } = props;
  const [state, dispatch] = useReducer(appReducer, undefined, () => ({
    ...initialState(),
    ...(props.initial?.srcFilter !== undefined ? { srcFilter: props.initial.srcFilter } : {}),
    ...(props.initial?.win !== undefined ? { win: props.initial.win } : {}),
    ...(props.initial?.themeIdx !== undefined && props.initial.themeIdx >= 0
      ? { themeIdx: props.initial.themeIdx }
      : {}),
  }));
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const theme = THEMES[state.themeIdx % THEMES.length];

  const adapters = useMemo(
    () => ADAPTERS.filter((a) => a.available(process.env.TOKENSPEED_HOME ?? homedir())),
    // re-check when records change: a source dir created after startup gains its card live
    [records],
  );
  const fKeys = useMemo(() => filterKeys(adapters), [adapters]);

  useEffect(() => {
    // only a real TTY carries keys; mock stdins (tests) must not hold the loop open
    if (!process.stdin.isTTY) return;
    // raw mode is required for single-key input; Ink only enables it via useInput,
    // which we bypass for F-key escape sequences — enable it ourselves.
    const restoreRaw = enableRawMode(process.stdin);
    const onData = (buf: Buffer | string): void => {
      const action = parseKey(String(buf));
      if (!action) return;
      if (action.t === 'quit') {
        props.onQuit?.();
        process.exit(0);
      }
      if (action.t === 'refresh') {
        props.onRefresh?.();
        return;
      }
      if (action.t === 'src') {
        const hit = fKeys.find((f) => f.key === action.key);
        if (hit) dispatch({ t: 'srcSet', src: hit.src });
        return;
      }
      dispatch(action);
    };
    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
      restoreRaw?.();
    };
  }, [fKeys, props.onRefresh, props.onQuit]);

  // compact one-line header (screenshot style): big banner blocks caused flicker on every refresh
  const banner = (
    <Text bold>
      <Text color={theme.accent}>❖ </Text>
      <Gradient key={`g${state.themeIdx}`} colors={[theme.gradFrom, theme.gradTo]}>TOKEN SPEED</Gradient>
      <Text color={theme.dim}> / observatory</Text>
    </Text>
  );

  const winLabel: Record<WindowKey, string> = { today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All time' };

  return (
    <Box flexDirection="column" rowGap={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="column">
          {banner}
          <Text color={theme.dim}>{adapters.map((a) => prettyLabel(a.label)).join(' + ')} · local token telemetry</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text color={live ? theme.accent : theme.dim}>{live ? '● LIVE' : '○ paused'}</Text>
          <Text color={theme.dim}>node · v0.1.0 · {clock(now)}</Text>
          {props.lastRefresh !== undefined && (
            <Text color={theme.dim}>data {fmtAgo(Math.max(0, now - props.lastRefresh))} ago</Text>
          )}
        </Box>
      </Box>

      <Box columnGap={2}>
        {ALL_PAGES.map((p, i) => (
          <Text key={p} color={state.page === p ? theme.bg : theme.dim} backgroundColor={state.page === p ? theme.accent : undefined} bold>
            [F{i + 1}] {p[0].toUpperCase() + p.slice(1)}
          </Text>
        ))}
      </Box>

      <Box columnGap={2}>
        <Text color={theme.dim}>
          SOURCE ({fKeys.map((f) => {
            const label = f.src === 'all' ? 'All' : prettyLabel(adapters.find((a) => a.id === f.src)?.label ?? f.src);
            return `${f.key} ${label}`;
          }).join(', ')})
        </Text>
        <Text color={theme.dim}>
          WINDOW ({(['today', '7d', '30d', 'all'] as WindowKey[]).map((w, i) => (
            <React.Fragment key={w}>
              {i > 0 ? ', ' : ''}
              <Text bold={w === state.win} color={w === state.win ? theme.text : theme.dim}>
                {winLabel[w]}
              </Text>
            </React.Fragment>
          ))})
        </Text>
      </Box>

      <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1}>
        {state.page === 'overview' && (
          <Overview records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} />
        )}
        {state.page === 'timeline' && (
          <Timeline records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} />
        )}
        {state.page === 'models' && (
          <Models
            records={records} now={now} theme={theme}
            srcFilter={state.srcFilter as SourceId | 'all'} win={state.win}
            sort={{ col: state.sortCol, dir: state.sortDir }}
            onSort={() => { /* keyboard-driven via reducer */ }}
          />
        )}
        {state.page === 'requests' && (
          <Requests records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} scroll={state.scroll} />
        )}
      </Box>

      <Box justifyContent="space-between">
        <Text color={theme.dim}>1-4 src · t/w/a win · r refresh · x theme · q quit</Text>
        <Text color={theme.dim}>~ estimated · {props.scan ? `scan ${props.scan.done}/${props.scan.total}` : 'cached'}</Text>
      </Box>
    </Box>
  );
}
