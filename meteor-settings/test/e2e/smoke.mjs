/*
 * smoke.mjs — 実際にブラウザで開いて「起動して、狙ったものが見える」ことだけ見る
 *
 *   npm run test:e2e
 *
 * 【なぜ E2E が要るか】単体テストでは原理的に捕まらない事故が2つ実際に起きている。
 *   - 版がずれて「古い HTML ＋ 新しい JS」で起動し、画面が真っ白になった（v1.3.2）
 *   - hidden 属性がクラスの display に負けて、消えるはずの欄が出ていた（v1.7.0）
 * どちらも「ブラウザで開くまで分からない」種類のもの。
 *
 * 【最小限にとどめる理由】E2E は不安定になりやすく、1つでも Flaky があると
 * テスト結果そのものが信用されなくなる。ここは**起動と表示の確認だけ**にして、
 * 中身の正しさは Small テスト（test/*.test.js）に任せる。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const PORT = 8899;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 依存を増やさないための最小の静的サーバー */
function serve() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  OK ' : 'FAIL '} ${label}${detail ? '  — ' + detail : ''}`);
}

const server = await serve();
const browser = await chromium.launch();
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

  await page.goto(`http://localhost:${PORT}/meteor-settings/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  /* --- 1. そもそも起動したか（真っ白事故の検出） --- */
  const version = (await page.innerText('#appVersion')).trim();
  check('起動して版が表示される', /^v\d+\.\d+\.\d+/.test(version), version.replace(/\n/g, ' '));

  const planRows = await page.locator('#planList .cal-row').count();
  check('「次の流星群」が並ぶ', planRows > 0, `${planRows}件`);

  const shutter = (await page.innerText('#sumShutter')).trim();
  check('推奨設定が計算されている', shutter !== '—' && shutter !== '', shutter);

  /* --- 2. HTML と JS の版が一致しているか --- */
  const meta = await page.getAttribute('meta[name="app-version"]', 'content');
  check('HTML の版と JS の版が一致', 'v' + meta === version.split(/\s/)[0], `meta=${meta}`);

  /* --- 3. hidden がクラスの display に負けていないか（v1.7.0 の事故） --- */
  await page.click('[data-page="page-gear"]');
  await page.waitForTimeout(300);
  const tracked = await page.isChecked('#tracked').catch(() => null);
  if (tracked === true) await page.uncheck('#tracked');
  await page.waitForTimeout(400);
  const maxExpVisible = await page.locator('#maxExposureField').isVisible().catch(() => null);
  check('固定撮影では「追尾時の露出上限」が出ない', maxExpVisible === false,
    maxExpVisible === null ? '欄が見つからない（id を確認）' : '');

  /* --- 4. 主要な画面が開く ---
     タブは横スライドで動く。時間で待つと不安定になり、位置だけで待つのも足りない
     （スライドの途中で一瞬 left=0 を通過するので「着いた」と誤判定し、次のタップが
     アニメーション中に入って空振りする。実際にそうなった）。
     app.js がスライドを終えてから付ける .active を待つのが確実。 */
  const openTab = async (id) => {
    await page.click(`[data-page="${id}"]`);
    await page.waitForFunction((pid) => {
      const el = document.getElementById(pid);
      if (!el || !el.classList.contains('active')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && Math.abs(r.left) < 2;
    }, id, { timeout: 5000 });
  };

  for (const [id, label] of [['page-plan', '計画'], ['page-gear', '機材'],
    ['page-cond', '条件'], ['page-result', '結果']]) {
    let ok = true;
    try { await openTab(id); } catch { ok = false; }
    check(`${label}タブが開く`, ok);
  }

  await openTab('page-plan');
  await page.click('#btnOutlook');
  await page.waitForTimeout(700);
  const outlookRows = await page.locator('#calOutlook .cal-row').count();
  check('群別の見通しが20年ぶん出る', outlookRows === 20, `${outlookRows}件`);
  const lead = await page.innerText('#calOutlookLead');
  check('見通しの結論が出る', /年/.test(lead), lead.split('\n').filter(Boolean)[1] || '');
  await page.click('#calendarSheet .sheet__close');
  await page.waitForTimeout(300);

  /* --- 5. 3テーマ × 文字サイズ「大」で横に溢れない --- */
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  for (const theme of ['dark', 'light', 'astro']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(200);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${theme} × 文字サイズ大で横に溢れない`, !over);
  }

  check('コンソールにエラーが出ていない', errors.length === 0, errors.join(' / '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0
  ? `\n${results.length}項目すべて通りました。`
  : `\n${failed.length}/${results.length} 項目が失敗しました。`);
process.exit(failed.length === 0 ? 0 : 1);
