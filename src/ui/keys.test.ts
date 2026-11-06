import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, enableRawMode } from './keys.ts';

test('enableRawMode toggles raw mode and restores on cleanup', () => {
  const calls: (boolean | undefined)[] = [];
  const fakeStdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(v: boolean): void {
      calls.push(v);
      this.isRaw = v;
    },
  };
  const restore = enableRawMode(fakeStdin as never);
  assert.deepEqual(calls, [true]); // enabled immediately
  restore?.();
  assert.deepEqual(calls, [true, false]); // restored
});

test('enableRawMode is a no-op without TTY or setRawMode support', () => {
  assert.equal(enableRawMode({ isTTY: false } as never), null);
  assert.equal(
    enableRawMode({ isTTY: true } as never), // no setRawMode function
    null,
  );
});

test('enableRawMode degrades safely when the terminal rejects raw mode', () => {
  const fakeStdin = {
    isTTY: true,
    setRawMode(): void { throw new Error('EPERM'); },
  };
  assert.equal(enableRawMode(fakeStdin as never), null);
});

test('F1-F4 in both escape sequence dialects map to pages', () => {
  assert.deepEqual(parseKey('\x1bOP'), { t: 'page', p: 'overview' });
  assert.deepEqual(parseKey('\x1b[11~'), { t: 'page', p: 'overview' });
  assert.deepEqual(parseKey('\x1bOQ'), { t: 'page', p: 'timeline' });
  assert.deepEqual(parseKey('\x1b[12~'), { t: 'page', p: 'timeline' });
  assert.deepEqual(parseKey('\x1bOR'), { t: 'page', p: 'models' });
  assert.deepEqual(parseKey('\x1b[13~'), { t: 'page', p: 'models' });
  assert.deepEqual(parseKey('\x1bOS'), { t: 'page', p: 'requests' });
  assert.deepEqual(parseKey('\x1b[14~'), { t: 'page', p: 'requests' });
});

test('digits map to source filter keys', () => {
  assert.deepEqual(parseKey('1'), { t: 'src', key: '1' });
  assert.deepEqual(parseKey('3'), { t: 'src', key: '3' });
  assert.deepEqual(parseKey('9'), { t: 'src', key: '9' });
});

test('window keys: t today, w cycle, a all', () => {
  assert.deepEqual(parseKey('t'), { t: 'win', w: 'today' });
  assert.deepEqual(parseKey('w'), { t: 'winCycle' });
  assert.deepEqual(parseKey('a'), { t: 'win', w: 'all' });
});

test('navigation keys', () => {
  assert.deepEqual(parseKey('\x1b[A'), { t: 'up' });
  assert.deepEqual(parseKey('\x1b[B'), { t: 'down' });
  assert.deepEqual(parseKey('\x1b[C'), { t: 'right' });
  assert.deepEqual(parseKey('\x1b[D'), { t: 'left' });
  assert.deepEqual(parseKey('j'), { t: 'down' });
  assert.deepEqual(parseKey('k'), { t: 'up' });
  assert.deepEqual(parseKey('g'), { t: 'top' });
  assert.deepEqual(parseKey('G'), { t: 'bottom' });
  assert.deepEqual(parseKey('\r'), { t: 'enter' });
  assert.deepEqual(parseKey('\t'), { t: 'tab' });
  assert.deepEqual(parseKey('\x1b[Z'), { t: 'tabBack' });
});

test('utility keys', () => {
  assert.deepEqual(parseKey('r'), { t: 'refresh' });
  assert.deepEqual(parseKey('x'), { t: 'theme' });
  assert.deepEqual(parseKey('q'), { t: 'quit' });
  assert.deepEqual(parseKey('\x03'), { t: 'quit' });
});

test('unknown input is null', () => {
  assert.equal(parseKey('z'), null);
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('\x1b[200~'), null);
});
