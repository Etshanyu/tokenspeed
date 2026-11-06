import type { SourceId } from './sources/types.ts';

export interface Theme {
  name: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
  gradFrom: string;
  gradTo: string;
  srcColors: Record<SourceId, string>;
  srcGradients?: Record<SourceId, string[]>;
  /** 10-level intensity ramp, dim -> hot */
  heat: string[];
}

export const THEMES: Theme[] = [
  {
    name: 'observatory',
    bg: '#020610',
    panel: '#0b1420',
    border: '#26384a',
    text: '#e8fbff',
    dim: '#6f8ca6',
    accent: '#67e8f9',
    gradFrom: '#67e8f9',
    gradTo: '#c084fc',
    srcColors: { codex: '#00ffc6', claude: '#ffd166', dsh: '#ff4fa3' },
    srcGradients: {
      codex: ['#00ffc6', '#00a3ff'],
      claude: ['#fff45a', '#ff8a3d'],
      dsh: ['#ff4fa3', '#b86bff'],
    },
    heat: ['#102a3a', '#103b4b', '#104c5c', '#105d6d', '#106e7e', '#10808f', '#1091a0', '#10a3b1', '#10b4c2', '#10c6d3'],
  },
  {
    name: 'ember',
    bg: '#120d0a',
    panel: '#1a1310',
    border: '#3d2b20',
    text: '#e8d5c4',
    dim: '#8a7263',
    accent: '#fb923c',
    gradFrom: '#fbbf24',
    gradTo: '#ef4444',
    srcColors: { codex: '#f59e0b', claude: '#fbbf24', dsh: '#f87171' },
    heat: ['#2a1c12', '#33210f', '#3d2713', '#4a2e15', '#593817', '#6d4418', '#85531a', '#a1651c', '#c07b1e', '#e09a26'],
  },
  {
    name: 'vapor',
    bg: '#0d0a16',
    panel: '#141020',
    border: '#322a4a',
    text: '#d4cfe8',
    dim: '#6f688a',
    accent: '#c084fc',
    gradFrom: '#818cf8',
    gradTo: '#e879f9',
    srcColors: { codex: '#a78bfa', claude: '#818cf8', dsh: '#e879f9' },
    heat: ['#1c1730', '#221c3b', '#292147', '#31264f', '#3c2d5c', '#4b3670', '#5f428a', '#7852a6', '#9465c2', '#b480dc'],
  },
];
