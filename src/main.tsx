import React, { useEffect, useRef, useState } from 'react';
import { Box, render, Text } from 'ink';
import Spinner from 'ink-spinner';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADAPTERS } from './sources/index.ts';
import type { SourceAdapter, TurnRecord } from './sources/types.ts';
import { loadCache, saveCache, scanAll } from './scan/indexer.ts';
import type { IndexStore } from './scan/indexer.ts';
import { startWatch } from './scan/watcher.ts';
import { App } from './ui/App.tsx';
import { THEMES } from './theme.ts';
import { gaugeBar } from './ui/comp/chart.ts';
import type { WindowKey } from './agg/metrics.ts';

const VERSION = '0.1.0';

export async function buildRuntime(opts: {
  root: string;
  cacheDir: string;
  adapters?: SourceAdapter[];
  rescan?: boolean;
  onProgress?: (p: { done: number; total: number; file: string }) => void;
}): Promise<{ records: TurnRecord[]; cachePath: string; store: IndexStore; scanned: number; fromCache: number }> {
  const adapters = opts.adapters ?? ADAPTERS;
  const cachePath = path.join(opts.cacheDir, 'index.json');
  const cache = opts.rescan ? null : loadCache(cachePath);
  const { store, result } = await scanAll({
    adapters, root: opts.root, cache, onProgress: opts.onProgress,
  });
  await saveCache(cachePath, store);
  return {
    records: result.records, cachePath, store,
    scanned: result.scanned, fromCache: result.fromCache,
  };
}

function Boot(props: { done: number; total: number; file: string }): React.ReactElement {
  const theme = THEMES[0];
  const pct = props.total > 0 ? props.done / props.total : 0;
  return (
    <Box flexDirection="column" alignItems="center" padding={1} gap={1}>
      <Text bold color={theme.accent}>TOKEN SPEED · observatory</Text>
      <Text color={theme.accent}>
        <Spinner type="dots" />{'  '}
        scanning local telemetry {props.done}/{props.total}
      </Text>
      <Text>{gaugeBar(props.done, Math.max(1, props.total), 40, '█', '░')}</Text>
      <Text color={theme.dim}>{Math.round(pct * 100)}% · {props.file}</Text>
    </Box>
  );
}

function Root(props: {
  initialRecords: TurnRecord[];
  cacheDir: string;
  root: string;
  live: boolean;
  initSrc: string;
  initWin: WindowKey;
  initTheme: number;
}): React.ReactElement {
  const [records, setRecords] = useState(props.initialRecords);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const storeRef = useRef<IndexStore | null>(null);
  const scanning = useRef(false);

  const rescan = async (): Promise<void> => {
    if (scanning.current) return;
    scanning.current = true;
    try {
      const cache = storeRef.current ?? loadCache(path.join(props.cacheDir, 'index.json'));
      const { store, result } = await scanAll({ adapters: ADAPTERS, root: props.root, cache });
      if (process.env.TOKENSPEED_DEBUG) console.error(`[live] rescan: records=${result.records.length} scanned=${result.scanned}`);
      storeRef.current = store;
      // persist only when something actually changed (avoid churning a ~4MB file every 5s)
      if (result.scanned > 0) {
        await saveCache(path.join(props.cacheDir, 'index.json'), store);
      }
      setRecords(result.records);
      setLastRefresh(Date.now());
    } catch (err) {
      // infrastructure failure must not kill the TUI; next poll retries
      if (process.env.TOKENSPEED_DEBUG) console.error('[live] rescan failed:', err);
    } finally {
      scanning.current = false;
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!props.live) return;
    // adapter-owned watch dirs only — never watch the whole home (see SourceAdapter.watchDirs)
    const dirs = ADAPTERS
      .filter((a) => a.available(props.root) && a.watchDirs)
      .flatMap((a) => a.watchDirs!(props.root));
    const stop = startWatch(dirs, () => { void rescan(); });
    const poll = setInterval(() => { void rescan(); }, 5000);
    return () => {
      stop();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.live, props.root]);

  return (
    <App
      records={records}
      live={props.live}
      lastRefresh={lastRefresh}
      now={now}
      onRefresh={() => { void rescan(); }}
      initial={{ srcFilter: props.initSrc, win: props.initWin, themeIdx: props.initTheme }}
    />
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      window: { type: 'string' },
      'no-live': { type: 'boolean' },
      rescan: { type: 'boolean' },
      theme: { type: 'string' },
    },
  });
  const root = process.env.TOKENSPEED_HOME ?? homedir();
  const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data');

  const boot = render(<Boot done={0} total={0} file="" />);
  try {
    const { records } = await buildRuntime({
      root, cacheDir, rescan: values.rescan === true,
      onProgress: (p) => boot.rerender(<Boot done={p.done} total={p.total} file={p.file} />),
    });
    boot.unmount();

    const win: WindowKey = ['today', '7d', '30d', 'all'].includes(String(values.window))
      ? (values.window as WindowKey) : '7d';
    const src = ADAPTERS.some((a) => a.id === values.source) || values.source === 'all'
      ? String(values.source ?? 'all') : 'all';
    // --theme accepts a name ("vapor") or an index (1)
    const themeArg = String(values.theme ?? '');
    const themeIdx = /^\d+$/.test(themeArg)
      ? Math.min(Math.max(0, parseInt(themeArg, 10)), THEMES.length - 1)
      : Math.max(0, THEMES.findIndex((t) => t.name === themeArg));

    render(
      <Root
        initialRecords={records}
        cacheDir={cacheDir}
        root={root}
        live={values['no-live'] !== true}
        initSrc={src}
        initWin={win}
        initTheme={themeIdx}
      />,
    );
  } catch (err) {
    boot.unmount();
    console.error('tokenspeed failed to start:', err);
    process.exit(1);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  void main();
}
