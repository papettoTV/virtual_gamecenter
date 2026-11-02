import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../src/features/game/GameScreen.tsx', import.meta.url), 'utf8');
const showcaseStyles = readFileSync(new URL('../src/features/arcade/showcase.css', import.meta.url), 'utf8');

test('トップの固定背景はフッターも含む共通の描画階層に置く', () => {
  assert.match(showcaseStyles, /body:has\(\.showroom-shell\)\s*\{\s*isolation:\s*isolate;/);
  assert.match(showcaseStyles, /body:has\(\.showroom-shell\)::before\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*-1;/);
  assert.doesNotMatch(showcaseStyles, /\.showroom-shell\s*\{[^}]*isolation:/);
  assert.doesNotMatch(showcaseStyles, /\.showroom-shell::before/);
});

test('モバイル観戦だけHUD上の共有アイコンを隠す', () => {
  assert.match(styles, /@media\s*\(max-width:\s*820px\)\s*\{\s*\.is-spectator \.game-share-button\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(styles, /\.is-spectator \.spectator-share-button\s*\{[^}]*display:\s*none/);
  assert.match(screen, /className="spectator-share-button"[\s\S]*?このライブを共有/);
});

test('観戦ゲーム領域からの縦スクロールを維持する', () => {
  assert.match(styles, /\.is-spectator \.game-frame,\s*\.is-spectator canvas\s*\{\s*touch-action: pan-y pinch-zoom;/);
});
