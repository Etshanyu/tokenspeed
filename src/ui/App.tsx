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
  return { page: 'overview', srcFilter: 'all', win: '7d', themeIdx: 0, scroll: 0, sortCol: 4, sortDir: -1 };
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
  initial?: { page?: Page; srcFilter?: string; win?: WindowKey; themeIdx?: number };
}

function clock(now: number): string {
  const d = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${months[d.getMonth()]} ${p(d.getDate())} · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(absolute / 60))}:${p(absolute % 60)}`;
}

/** CODEX -> Codex, DSH stays DSH (short acronyms) */
function prettyLabel(label: string): string {
  return label.length <= 3 ? label : label[0] + label.slice(1).toLowerCase();
}

export function App(props: AppProps): React.ReactElement {
  const { records, live = false, now = Date.now() } = props;
  const [state, dispatch] = useReducer(appReducer, undefined, () => ({
    ...initialState(),
    ...(props.initial?.page !== undefined ? { page: props.initial.page } : {}),
    ...(props.initial?.srcFilter !== undefined ? { srcFilter: props.initial.srcFilter } : {}),
    ...(props.initial?.win !== undefined ? { win: props.initial.win } : {}),
    ...(props.initial?.themeIdx !== undefined && props.initial.themeIdx >= 0
      ? { themeIdx: props.initial.themeIdx }
      : {}),
  }));
  const { stdout } = useStdout();
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

  const banner = (
    <Text bold>
      <Text color={theme.accent}>❖ </Text>
      <Gradient key={`g${state.themeIdx}`} colors={[theme.gradFrom, theme.gradTo]}>TOKEN SPEED</Gradient>
      <Text color={theme.dim}>  /  observatory</Text>
    </Text>
  );

  const winLabel: Record<WindowKey, string> = { today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All time' };
  const refreshed = props.lastRefresh === undefined
    ? 'cached'
    : `refreshed ${fmtAgo(Math.max(0, now - props.lastRefresh))} ago`;
  return (
    <Box flexDirection="column" rowGap={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="column">
          {banner}
          <Text>
            {adapters.map((a, i) => (
              <React.Fragment key={a.id}>
                {i > 0 && <Text color={theme.dim}> + </Text>}
                <Text color={theme.srcColors[a.id] ?? theme.accent}>{prettyLabel(a.label)}</Text>
              </React.Fragment>
            ))}
            <Text color={theme.dim}>  ·  local token telemetry</Text>
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            <Text color={live ? theme.srcColors.codex : theme.dim}>{live ? '● LIVE' : '○ paused'}</Text>
            <Text color={theme.dim}>  Node · v0.1.0</Text>
          </Text>
          <Text color={theme.dim}>{clock(now)}</Text>
        </Box>
      </Box>

      <Box columnGap={2} marginTop={1}>
        {ALL_PAGES.map((p, i) => {
          const selected = state.page === p;
          return (
            <Text
              key={p}
              color={selected ? theme.bg : theme.dim}
              backgroundColor={selected ? theme.accent : theme.panel}
              bold={selected}
            >
              F{i + 1} {p[0].toUpperCase() + p.slice(1)}
            </Text>
          );
        })}
      </Box>

      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        <Box columnGap={1}>
          <Text color={theme.dim}>SOURCE</Text>
          {fKeys.map((f) => {
            const selected = state.srcFilter === f.src;
            const color = f.src === 'all' ? theme.accent : theme.srcColors[f.src] ?? theme.dim;
            const label = f.src === 'all' ? 'All' : prettyLabel(adapters.find((a) => a.id === f.src)?.label ?? f.src);
            return (
              <Text
                key={f.src}
                color={selected ? theme.bg : color}
                backgroundColor={selected ? color : theme.panel}
                bold={selected}
              >
                {f.key} {label}
              </Text>
            );
          })}
        </Box>
        <Box columnGap={1}>
          <Text color={theme.dim}>WINDOW</Text>
          {(['today', '7d', '30d', 'all'] as WindowKey[]).map((w) => {
            const selected = w === state.win;
            return (
              <Text
                key={w}
                color={selected ? theme.bg : theme.dim}
                backgroundColor={selected ? theme.accent : theme.panel}
                bold={selected}
              >
                {winLabel[w]}
              </Text>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column">
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

      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.dim}>
          <Text color={theme.srcColors.codex}>●</Text> Estimated request throughput · {records.length} requests · {props.scan ? `scan ${props.scan.done}/${props.scan.total}` : refreshed}
        </Text>
        {(stdout?.columns ?? 80) < 120 ? (
          <Text color={theme.dim}>Tab view · 1/2/3 source · t/w/a range · r refresh · x theme · q quit</Text>
        ) : (
          <Text color={theme.dim}>
            <Text backgroundColor={theme.border} color={theme.text}> Tab </Text> view{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> 1/2/3 </Text> source{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> t/w/a </Text> range{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> ↑/↓ </Text> select{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> Enter </Text> sort{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> r </Text> refresh{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> x </Text> theme{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> q </Text> quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
