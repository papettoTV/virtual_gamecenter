import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const panelFor = page => page.getByRole('region', { name: 'アクセス解析の設定' });

// Keep only geometry/style metadata: no page text, URLs, storage or credentials.
const observations = new WeakMap();

test.beforeEach(async ({ page }) => { observations.set(page, []); });
test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('analytics-panel-geometry', {
    body: Buffer.from(JSON.stringify(observations.get(page), null, 2)),
    contentType: 'application/json',
  });
  if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
    await testInfo.attach('analytics-panel-failure', {
      body: await page.screenshot(), contentType: 'image/png',
    });
  }
});

async function measurePanel(panel) {
  return panel.evaluate(element => new Promise(resolve => {
    const rect = node => {
      const { x, y, width, height, bottom, right } = node.getBoundingClientRect();
      return { x, y, width, height, bottom, right };
    };
    const style = node => {
      const css = getComputedStyle(node);
      return Object.fromEntries(['position', 'bottom', 'marginTop', 'marginBottom',
        'transform', 'filter', 'perspective', 'contain', 'willChange', 'display',
        'visibility', 'animationName', 'transitionProperty'].map(key => [key, css[key]]));
    };
    const sample = () => {
      const ancestors = [];
      for (let node = element.parentElement; node; node = node.parentElement) {
        ancestors.push({ tag: node.tagName, style: style(node) });
      }
      const visual = window.visualViewport;
      return {
        time: performance.now(), rect: rect(element), style: style(element), ancestors,
        viewport: { width: innerWidth, height: innerHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight },
        visualViewport: visual && { width: visual.width, height: visual.height,
          offsetTop: visual.offsetTop, offsetLeft: visual.offsetLeft, scale: visual.scale },
        scroll: { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight,
          width: document.documentElement.scrollWidth },
        fonts: document.fonts.status, readyState: document.readyState,
        styleSheets: document.styleSheets.length,
      };
    };
    // Scroll updates and layout are observed together, across consecutive frames.
    requestAnimationFrame(() => {
      const previous = sample();
      requestAnimationFrame(() => resolve({ previous, current: sample() }));
    });
  }));
}

async function expectDocked(page, phase = 'initial', scrollTarget) {
  await test.step(`固定位置: ${phase}`, async () => {
    const panel = panelFor(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('position', 'fixed');
    const samples = [];
    observations.get(page).push({ phase, scrollTarget, samples });
    try {
      await expect.poll(async () => {
        const measurement = await measurePanel(panel);
        samples.push(measurement);
        if (samples.length > 20) samples.shift();
        const { previous, current } = measurement;
        const docked = sample => sample.style.position === 'fixed'
          && Math.abs(sample.rect.bottom - sample.viewport.height) <= 1
          && sample.rect.x >= 0 && sample.rect.right <= sample.viewport.width
          && sample.rect.y >= 0 && sample.scroll.width <= sample.viewport.width;
        return docked(previous) && docked(current)
          && (scrollTarget === undefined || Math.abs(current.scroll.y - scrollTarget) <= 1)
          && previous.scroll.x === current.scroll.x && previous.scroll.y === current.scroll.y
          && previous.rect.bottom === current.rect.bottom
          && previous.rect.height === current.rect.height;
      }, { message: `同一フレームのviewport下端から1px以内、横はみ出しなし: ${phase}` }).toBe(true);
    } finally {
      // Playwright's box is a separate protocol sample, not an atomic DOM measurement.
      // Retain both sources to diagnose a scroll/compositor discrepancy on failure.
      const last = samples.at(-1);
      if (last) {
        last.playwrightBoxAfterSample = await panel.boundingBox().catch(() => null);
        last.configuredViewport = page.viewportSize();
        const box = last.playwrightBoxAfterSample;
        last.playwrightBottomMinusDomBottom = box
          ? box.y + box.height - last.current.rect.bottom : null;
      }
    }
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 664 }, { width: 320, height: 568 }]) {
  test(`画面下部への固定と再表示 ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expectDocked(page);
    await expect(panelFor(page)).toContainText('Google Analyticsによるアクセス解析');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0);
    // Initial rendering above is intentionally checked before waiting for fonts.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Preserve the original auto sweep everywhere; exercise smooth rendering on
    // the desktop viewport from the reported failure without repeating it six times.
    const behaviors = viewport.width === 1280 && testInfo.project.name === 'desktop'
      ? ['auto', 'smooth'] : ['auto'];
    for (const [cycle, behavior] of behaviors.entries()) {
      for (const fraction of [0, 0.5, 1, 0]) {
        const target = await page.evaluate(({ fraction, behavior }) => {
          const target = (document.documentElement.scrollHeight - innerHeight) * fraction;
          window.scrollTo({ top: target, left: 0, behavior });
          return target;
        }, { fraction, behavior });
        await expectDocked(page, `scroll cycle=${cycle} fraction=${fraction} behavior=${behavior}`, target);
      }
    }
    for (const name of ['拒否する', '同意する', '閉じる']) {
      await expect(panelFor(page).getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await panelFor(page).getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(panelFor(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'アクセス解析設定', exact: true }).click();
    await expectDocked(page, 'reopen undecided');
    await expect(panelFor(page)).toContainText('未選択');

    for (const [button, choice] of [['拒否する', '拒否'], ['同意する', '同意']]) {
      await panelFor(page).getByRole('button', { name: button, exact: true }).click();
      await expect(panelFor(page)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('button', { name: 'アクセス解析設定', exact: true })).toBeVisible();
      await expect(panelFor(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'アクセス解析設定', exact: true }).click();
      await expectDocked(page, `reopen ${choice}`);
      await expect(panelFor(page)).toContainText(`現在：${choice}`);
      await expect(panelFor(page)).toContainText('開発・検証環境では同意しても解析は動作しません');
    }
  });
}

test('低いビューポートでも本文と全操作に到達できる', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 568, height: 240 });
  await page.goto('/');
  await expectDocked(page);
  const panel = panelFor(page);
  await panel.evaluate(element => { element.scrollTop = 0; });
  await expect(panel.getByText('Google Analyticsによるアクセス解析', { exact: true })).toBeInViewport();
  await testInfo.attach('低い画面・パネル本文', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  for (const name of ['拒否する', '同意する', '閉じる']) {
    const button = panel.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await button.click({ trial: true });
    await testInfo.attach(`低い画面・${name}に到達`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  await panel.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
