import { expect } from '../../../../ci/ui-fixtures.mjs';

export async function installDotWaveFinishFixture(page) {
  // Transform only the browser's game module, never production source. This
  // event arms a one-shot fixture consumed by the live animation loop, rather
  // than freshDuel (which also runs during React renders/reinitialization).
  await page.route('**/src/games/dot-wave/duel/MochiDuel.tsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const loopEntry = /const current = engine\.current;\s*if \(network\?\.matchId && network\.startsAt/;
    expect(source.match(new RegExp(loopEntry.source, 'g'))).toHaveLength(1);
    const body = source.replace(loopEntry, `
      const current = engine.current;
      if (layoutFinishRequested && current.phase === 'playing' && current.mode === 'cpu') {
        layoutFinishRequested = false;
        // Resolve a complete final exchange using the real game rules. In
        // particular, impact rendering requires an outcome and history.
        current.match = fresh('cpu', current.match.ending, 3).match;
        current.match.hp = [100, 1];
        current.exchange = createExchange(0, 0, beatAt(0));
        for (const note of current.exchange.attack.notes) note.grade = 'perfect';
        for (const note of current.exchange.defense.notes) note.grade = 'miss';
        current.outcome = resolve(current.match, current.exchange);
        current.phase = 'impact'; current.impactElapsed = 0; current.cpuStage = 3;
        current.elapsedPlayMs = 180000;
        current.score = { total: 54820, maxCombo: 42, combo: 0, bossBonus: 1200 };
        sound.current?.stop();
      }
      if (network?.matchId && network.startsAt`) + `
      let layoutFinishRequested = false;
      window.addEventListener('dot-wave-layout-finish', () => { layoutFinishRequested = true; });
    `;
    await route.fulfill({ response, body });
  });
}
