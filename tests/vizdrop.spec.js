// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('landing page', () => {
  test('loads with pricing and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/VizDrop/);
    await expect(page.locator('.hero h1')).toContainText('Drop your spreadsheet');
    await expect(page.locator('.plan.pro .price')).toContainText('$5');
    await expect(page.locator('a[href="app.html"]').first()).toBeVisible();
  });
});

test.describe('app', () => {
  test('demo link builds a full dashboard', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/app.html?demo=1');

    await expect(page.locator('#dash-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#charts .chart-body svg')).toHaveCount(6);
    await expect(page.locator('.kpi')).toHaveCount(3);
    await expect(page.locator('#dash-subtitle')).toContainText('520 rows');

    // no NaN/undefined leaked into any chart geometry
    const svgHtml = await page.locator('#charts').innerHTML();
    expect(svgHtml).not.toMatch(/NaN|undefined|Infinity/);
    expect(errors).toEqual([]);
  });

  test('chart config can switch type and field', async ({ page }) => {
    await page.goto('/app.html?demo=1');
    await expect(page.locator('#charts .chart-body svg')).toHaveCount(6, { timeout: 10000 });
    const card = page.locator('.chart-card').first();
    await card.locator('button[title="Edit this chart"]').click();
    const typeSel = card.locator('.chart-config select').first();
    await typeSel.selectOption('column');
    await expect(card.locator('.chart-body svg path.mark').first()).toBeVisible();
  });

  test('table view toggle shows aggregated data', async ({ page }) => {
    await page.goto('/app.html?demo=1');
    await expect(page.locator('#charts .chart-body svg')).toHaveCount(6, { timeout: 10000 });
    const card = page.locator('.chart-card').nth(1);
    await card.locator('button[title="Toggle table view"]').click();
    await expect(card.locator('.chart-body table')).toBeVisible();
  });

  test('license: dev key activates and removes Pro gates', async ({ page }) => {
    await page.goto('/app.html');
    const result = await page.evaluate(async () => {
      const L = await import('./assets/js/license.js');
      await L.activate('VIZDROP-DEV-PLAYWRIGHT');
      const pro = L.isPro();
      L.deactivate();
      return { pro, after: L.isPro() };
    });
    expect(result.pro).toBe(true);
    expect(result.after).toBe(false);
  });

  test('escape closes the upgrade modal', async ({ page }) => {
    await page.goto('/app.html#upgrade');
    await expect(page.locator('#upgrade-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#upgrade-modal')).toBeHidden();
  });
});

test.describe('parsing engine', () => {
  test('handles messy Indonesian CSV, JSON, EU decimals, xlsx round-trip', async ({ page }) => {
    await page.goto('/app.html');
    const out = await page.evaluate(async () => {
      const P = await import('./assets/js/parse.js');
      const PR = await import('./assets/js/profile.js');

      const messy = 'Laporan Penjualan 2026\nTanggal,Cabang,,Omzet,Diskon\n15/01/2026,Jakarta,,"Rp 1.234.567","5%"\n28/02/2026,Bandung,,"Rp 2.345.678","10%"\n05/03/2026,Surabaya,,"Rp 987.654","2,5%"\n13/04/2026,Jakarta,,"Rp 1.111.222","7%"\n';
      const t1 = P.gridToTable((await P.parseFile(new File([messy], 'laporan.csv'))).sheets[0].grid);
      const p1 = PR.profileTable(t1);

      const js = JSON.stringify({ data: [{ name: 'A', metrics: { visits: 100, rate: '12.5%' } }, { name: 'B', metrics: { visits: 250, rate: '9%' } }] });
      const t2 = P.gridToTable((await P.parseFile(new File([js], 'data.json'))).sheets[0].grid);
      const p2 = PR.profileTable(t2);

      const eu = 'Product,Value\nA,"1.234,56"\nB,(500)\nC,"2.000,00"\n';
      const t3 = P.gridToTable((await P.parseFile(new File([eu], 'eu.csv'))).sheets[0].grid);
      const p3 = PR.profileTable(t3);

      const rows = [['Order Date', 'Region', 'Amount'], [new Date(2026, 0, 15), 'East', 1500.5], [new Date(2026, 1, 20), 'West', 2300]];
      const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const t4 = P.gridToTable((await P.parseFile(new File([ab], 'orders.xlsx'))).sheets[0].grid);
      const p4 = PR.profileTable(t4);

      return {
        messyHeaders: t1.headers,
        messyTypes: p1.columns.map((c) => c.type),
        omzetSum: p1.columns.find((c) => c.name === 'Omzet')?.sum,
        omzetUnit: p1.columns.find((c) => c.name === 'Omzet')?.unit,
        jsonHeaders: t2.headers,
        euValues: p3.columns[1].values,
        xlsxTypes: p4.columns.map((c) => c.type),
        xlsxSum: p4.columns[2].sum,
      };
    });

    expect(out.messyHeaders).toEqual(['Tanggal', 'Cabang', 'Omzet', 'Diskon']);
    expect(out.messyTypes).toEqual(['date', 'category', 'number', 'number']);
    expect(out.omzetSum).toBe(5679121);
    expect(out.omzetUnit).toBe('Rp ');
    expect(out.jsonHeaders).toEqual(['name', 'metrics.visits', 'metrics.rate']);
    expect(out.euValues).toEqual([1234.56, -500, 2000]);
    expect(out.xlsxTypes).toEqual(['date', 'category', 'number']);
    expect(out.xlsxSum).toBe(3800.5);
  });
});

test.describe('exports', () => {
  test('dashboard PNG canvas composes at 2x with watermark', async ({ page }) => {
    await page.goto('/app.html?demo=1');
    await expect(page.locator('#charts .chart-body svg')).toHaveCount(6, { timeout: 10000 });
    const out = await page.evaluate(async () => {
      const E = await import('./assets/js/export.js');
      const dbg = window.VizDropDebug;
      const canvas = await E.buildDashboardCanvas(dbg.state, dbg.makeOpts, { watermark: true, scale: 2 });
      return { w: canvas.width, h: canvas.height };
    });
    expect(out.w).toBe(2480);
    expect(out.h).toBeGreaterThan(2000);
  });
});
