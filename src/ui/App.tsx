import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Box, Text, useInput, useStdin, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { homedir } from 'node:os';
import { ADAPTERS, filterKeys } from '../sources/index.ts';
import { THEMES } from '../theme.ts';
import type { SourceId, TurnRecord } from '../sources/types.ts';
import type { WindowKey } from '../agg/metrics.ts';
import { fmtAgo } from '../util/fmt.ts';
import { ALL_PAGES, createKeyDecoder, cyclePage } from './keys.ts';
import type { KeyAction, Page } from './keys.ts';
import { Overview } from './Overview.tsx';
import { Timeline } from './Timeline.tsx';
import { Models } from './Models.tsx';
import { Requests } from './Requests.tsx';
import { t } from './i18n.ts';
import type { Language } from './i18n.ts';

export interface AppState {
  page: Page;
  srcFilter: string; // SourceId | 'all'
  win: WindowKey;
  themeIdx: number;
  lang: Language;
  scroll: number;
  sortCol: number;
  sortDir: 1 | -1;
}

export function initialState(): AppState {
  return { page: 'overview', srcFilter: 'all', win: '7d', themeIdx: 0, lang: 'en', scroll: 0, sortCol: 4, sortDir: -1 };
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
    case 'lang':
      return { ...state, lang: state.lang === 'en' ? 'zh' : 'en' };
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
  home?: string;
  onRefresh?: () => void;
  onQuit?: () => void;
  onStateChange?: (preferences: { page: Page; srcFilter: string; win: WindowKey; themeIdx: number; lang: Language }) => void;
  initial?: { page?: Page; srcFilter?: string; win?: WindowKey; themeIdx?: number; lang?: Language };
}

function clock(now: number, lang: Language): string {
  const d = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = lang === 'zh' ? `${p(d.getMonth() + 1)}月${p(d.getDate())}日` : `${months[d.getMonth()]} ${p(d.getDate())}`;
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date} · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${sign}${p(Math.floor(absolute / 60))}:${p(absolute % 60)}`;
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
    ...(props.initial?.lang !== undefined ? { lang: props.initial.lang } : {}),
  }));
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const theme = THEMES[state.themeIdx % THEMES.length];

  const adapters = useMemo(
    () => ADAPTERS.filter((a) => a.available(props.home ?? process.env.TOKENSPEED_HOME ?? homedir())),
    // re-check when records change: a source dir created after startup gains its card live
    [records, props.home],
  );
  const fKeys = useMemo(() => filterKeys(adapters), [adapters]);

  useEffect(() => {
    props.onStateChange?.({
      page: state.page,
      srcFilter: state.srcFilter,
      win: state.win,
      themeIdx: state.themeIdx,
      lang: state.lang,
    });
  }, [state.page, state.srcFilter, state.win, state.themeIdx, state.lang]);

  const handleAction = useCallback((action: KeyAction): void => {
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
  }, [fKeys, props.onRefresh, props.onQuit]);

  // Ink owns raw-mode setup and cleanup. Its input stream handles ordinary keys,
  // including several keys delivered in one chunk. Special keys arrive with an
  // empty input string, so translate Ink's key flags back to decoder sequences.
  const inkDecoder = useRef(createKeyDecoder());
  useInput((input, key) => {
    const sequence = key.tab
      ? (key.shift ? '\x1b[Z' : '\t')
      : key.upArrow
        ? '\x1b[A'
        : key.downArrow
          ? '\x1b[B'
          : key.rightArrow
            ? '\x1b[C'
            : key.leftArrow
              ? '\x1b[D'
              : key.return
                ? '\r'
                : input;
    for (const action of inkDecoder.current(sequence)) {
      // F-keys have a dedicated raw fallback below; never dispatch them twice.
      if (action.t !== 'page') handleAction(action);
    }
  }, { isActive: isRawModeSupported === true });

  useEffect(() => {
    // Some terminals do not surface F1-F4 through Ink. Keep a narrow raw fallback,
    // but leave raw-mode ownership and restoration entirely to Ink.
    if (!process.stdin.isTTY) return;
    const decodeKeys = createKeyDecoder();
    const onData = (buf: Buffer | string): void => {
      for (const action of decodeKeys(String(buf))) {
        if (action.t === 'page') handleAction(action);
      }
    };
    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [handleAction]);

  const banner = (
    <Text bold>
      <Text color={theme.accent}>❖ </Text>
      <Gradient key={`g${state.themeIdx}`} colors={[theme.gradFrom, theme.gradTo]}>TOKEN SPEED</Gradient>
      <Text color={theme.dim}>  /  {t(state.lang, 'observatory')}</Text>
    </Text>
  );

  const pageLabels: Record<Page, string> = {
    overview: t(state.lang, 'pageOverview'),
    timeline: t(state.lang, 'pageTimeline'),
    models: t(state.lang, 'pageModels'),
    requests: t(state.lang, 'pageRequests'),
  };
  const winLabel: Record<WindowKey, string> = {
    today: t(state.lang, 'today'),
    '7d': t(state.lang, 'sevenDays'),
    '30d': t(state.lang, 'thirtyDays'),
    all: t(state.lang, 'allTime'),
  };
  const refreshed = props.lastRefresh === undefined
    ? t(state.lang, 'cached')
    : state.lang === 'zh'
      ? `${fmtAgo(Math.max(0, now - props.lastRefresh), 'zh')}前刷新`
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
            <Text color={theme.dim}>  ·  {t(state.lang, 'localTelemetry')}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            <Text color={live ? theme.srcColors.codex : theme.dim}>{live ? `● ${t(state.lang, 'live')}` : `○ ${t(state.lang, 'paused')}`}</Text>
            <Text color={theme.dim}>  Node · v0.1.0</Text>
          </Text>
          <Text color={theme.dim}>{clock(now, state.lang)}</Text>
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
              F{i + 1} {pageLabels[p]}
            </Text>
          );
        })}
      </Box>

      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        <Box columnGap={1}>
          <Text color={theme.dim}>{t(state.lang, 'source')}</Text>
          {fKeys.map((f) => {
            const selected = state.srcFilter === f.src;
            const color = f.src === 'all' ? theme.accent : theme.srcColors[f.src] ?? theme.dim;
            const label = f.src === 'all'
              ? (state.lang === 'zh' ? '全部' : 'All')
              : prettyLabel(adapters.find((a) => a.id === f.src)?.label ?? f.src);
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
          <Text color={theme.dim}>{t(state.lang, 'window')}</Text>
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
          <Overview records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} lang={state.lang} />
        )}
        {state.page === 'timeline' && (
          <Timeline records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} lang={state.lang} />
        )}
        {state.page === 'models' && (
          <Models
            records={records} now={now} theme={theme}
            srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} lang={state.lang}
            sort={{ col: state.sortCol, dir: state.sortDir }}
            onSort={() => { /* keyboard-driven via reducer */ }}
          />
        )}
        {state.page === 'requests' && (
          <Requests records={records} now={now} theme={theme} srcFilter={state.srcFilter as SourceId | 'all'} win={state.win} scroll={state.scroll} lang={state.lang} />
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.dim}>
          <Text color={theme.srcColors.codex}>●</Text> {t(state.lang, 'statusThroughput')} · {records.length} {t(state.lang, 'records')} · {props.scan ? `${t(state.lang, 'scan')} ${props.scan.done}/${props.scan.total}` : refreshed}
        </Text>
        {(stdout?.columns ?? 80) < 120 ? (
          <Text color={theme.dim}>Tab {t(state.lang, 'view')} · 1/2/3 {t(state.lang, 'source')} · t/w/a {t(state.lang, 'range')} · l {t(state.lang, 'language')} · r {t(state.lang, 'refresh')} · x {t(state.lang, 'theme')} · q {t(state.lang, 'quit')}</Text>
        ) : (
          <Text color={theme.dim}>
            <Text backgroundColor={theme.border} color={theme.text}> Tab </Text> {t(state.lang, 'view')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> 1/2/3 </Text> {t(state.lang, 'source')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> t/w/a </Text> {t(state.lang, 'range')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> ↑/↓ </Text> {t(state.lang, 'select')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> Enter </Text> {t(state.lang, 'sort')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> l </Text> {t(state.lang, 'language')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> r </Text> {t(state.lang, 'refresh')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> x </Text> {t(state.lang, 'theme')}{'  '}
            <Text backgroundColor={theme.border} color={theme.text}> q </Text> {t(state.lang, 'quit')}
          </Text>
        )}
      </Box>
    </Box>
  );
}
