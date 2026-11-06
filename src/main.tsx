#!/usr/bin/env node
import React, { useEffect, useRef, useState } from 'react';
import { Box, render, Text } from 'ink';
import Spinner from 'ink-spinner';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADAPTERS } from './sources/index.ts';
import type { SourceAdapter, TurnRecord } from './sources/types.ts';
import { loadCache, saveCache, scanAll } from './scan/indexer.ts';
import type { IndexStore } from './scan/indexer.ts';
import { startWatch } from './scan/watcher.ts';
import { App } from './ui/App.tsx';
import { THEMES } from './theme.ts';
import type { WindowKey } from './agg/metrics.ts';
import { clearStoredCache, defaultCacheDir, loadPreferences, savePreferences } from './config.ts';
import type { Preferences } from './config.ts';

export const VERSION = '0.1.0';

export const HELP = `TOKEN SPEED ${VERSION} — local token telemetry

Usage:
  tokenspeed [options]

Options:
  --page <name>       overview | timeline | models | requests
  --source <name>     all | codex | claude | dsh
  --window <range>    today | 7d | 30d | all
  --theme <name|#>    theme name or zero-based index
  --lang <language>   en | zh
  --home <path>       home containing .claude, .codex and .dsh
  --cache-dir <path>  writable cache and preference directory
  --no-live           disable file watching and automatic refreshes
  --rescan            ignore cached records and parse all sources
  --clear-cache       delete the record cache, then exit
  --help              show this help
  --version           show the version

Environment:
  TOKENSPEED_HOME       same as --home
  TOKENSPEED_CACHE_DIR  same as --cache-dir
  TOKENSPEED_DEBUG=1    print non-fatal scan and preference errors

Keys:
  F1-F4 / Tab pages · 1-4 source · t/w/a window · arrows navigate
  Enter sort · l language · r refresh · x theme · q quit
`;

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

export function Boot(): React.ReactElement {
  const theme = THEMES[0];
  return (
    <Box flexDirection="column" alignItems="center" padding={1} gap={1}>
      <Text bold color={theme.accent}>TOKEN SPEED · observatory</Text>
      <Text color={theme.accent}>
        <Spinner type="dots" />{'  '}
        loading local telemetry…
      </Text>
    </Box>
  );
}

function Root(props: {
  initialRecords: TurnRecord[];
  cacheDir: string;
  root: string;
  live: boolean;
  initPage: 'overview' | 'timeline' | 'models' | 'requests';
  initSrc: string;
  initWin: WindowKey;
  initTheme: number;
  initLang: 'en' | 'zh';
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
    // 30s clock: a 1s tick re-rendered the whole tree and caused visible flicker
    const t = setInterval(() => setNow(Date.now()), 30_000);
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

  const onStateChange = (next: Preferences): void => savePreferences(props.cacheDir, next);

  return (
    <App
      records={records}
      live={props.live}
      lastRefresh={lastRefresh}
      now={now}
      home={props.root}
      onRefresh={() => { void rescan(); }}
      onStateChange={onStateChange}
      initial={{ page: props.initPage, srcFilter: props.initSrc, win: props.initWin, themeIdx: props.initTheme, lang: props.initLang }}
    />
  );
}

async function main(): Promise<void> {
  let boot: ReturnType<typeof render> | null = null;
  try {
    const { values } = parseArgs({
      options: {
        page: { type: 'string' },
        source: { type: 'string' },
        window: { type: 'string' },
        lang: { type: 'string' },
        home: { type: 'string' },
        'cache-dir': { type: 'string' },
        'no-live': { type: 'boolean' },
        rescan: { type: 'boolean' },
        'clear-cache': { type: 'boolean' },
        theme: { type: 'string' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    });
    if (values.help) {
      process.stdout.write(HELP);
      return;
    }
    if (values.version) {
      process.stdout.write(`${VERSION}\n`);
      return;
    }

    const cacheDir = values['cache-dir']
      ? path.resolve(String(values['cache-dir']))
      : defaultCacheDir();
    if (values['clear-cache']) {
      clearStoredCache(cacheDir);
      process.stdout.write(`Token Speed cache cleared: ${path.join(cacheDir, 'index.json')}\n`);
      return;
    }

    const root = values.home ? path.resolve(String(values.home)) : (process.env.TOKENSPEED_HOME ?? homedir());
    const preferences = loadPreferences(cacheDir);
    const pageValue = values.page ?? preferences.page;
    const page = ['overview', 'timeline', 'models', 'requests'].includes(String(pageValue))
      ? (pageValue as 'overview' | 'timeline' | 'models' | 'requests') : 'overview';
    const winValue = values.window ?? preferences.win;
    const win: WindowKey = ['today', '7d', '30d', 'all'].includes(String(winValue))
      ? (winValue as WindowKey) : '7d';
    const srcValue = values.source ?? preferences.srcFilter ?? 'all';
    const src = ADAPTERS.some((a) => a.id === srcValue) || srcValue === 'all' ? String(srcValue) : 'all';
    const langValue = values.lang ?? preferences.lang ?? 'en';
    const lang = langValue === 'zh' ? 'zh' : 'en';
    // --theme accepts a name ("vapor") or an index (1)
    const themeArg = String(values.theme ?? '');
    const themeIdx = !themeArg
      ? Math.min(preferences.themeIdx ?? 0, THEMES.length - 1)
      : /^\d+$/.test(themeArg)
        ? Math.min(Math.max(0, parseInt(themeArg, 10)), THEMES.length - 1)
        : Math.max(0, THEMES.findIndex((theme) => theme.name === themeArg));

    boot = render(<Boot />);
    const { records } = await buildRuntime({
      root, cacheDir, rescan: values.rescan === true,
    });
    boot.clear();
    boot.unmount();
    boot = null;

    render(
      <Root
        initialRecords={records}
        cacheDir={cacheDir}
        root={root}
        live={values['no-live'] !== true}
        initPage={page}
        initSrc={src}
        initWin={win}
        initTheme={themeIdx}
        initLang={lang}
      />,
    );
  } catch (err) {
    boot?.clear();
    boot?.unmount();
    console.error('tokenspeed failed to start:', err);
    process.exitCode = 1;
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  void main();
}
