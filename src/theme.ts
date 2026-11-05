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
  /** 10-level intensity ramp, dim -> hot */
  heat: string[];
}

export const THEMES: Theme[] = [
  {
    name: 'observatory',
    bg: '#0a0e14',
    panel: '#11151c',
    border: '#2b3648',
    text: '#c9d1d9',
    dim: '#6b7280',
    accent: '#22d3ee',
    gradFrom: '#22d3ee',
    gradTo: '#f472b6',
    srcColors: { codex: '#f59e0b', claude: '#22d3ee', dsh: '#f472b6' },
    heat: ['#1e2a38', '#233244', '#283a50', '#2d425c', '#32506c', '#386282', '#3f7a9c', '#4896b4', '#55b2ca', '#6cd4e8'],
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
