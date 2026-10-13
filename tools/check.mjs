// 학습지 렌더링 검사: A4 한 장에 들어가는지, 옛한글 글꼴이 적용됐는지 확인하고 PNG·PDF를 만든다.
// 사용법: node tools/check.mjs <지문 id> [출력 폴더]
//   (playwright가 전역 설치돼 있으면 NODE_PATH=$(npm root -g) 로 실행)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const id = process.argv[2];
if (!id) { console.error('사용법: node tools/check.mjs <지문 id> [출력 폴더]'); process.exit(2); }
const outDir = path.resolve(process.argv[3] || 'out');
fs.mkdirSync(outDir, { recursive: true });

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const url = pathToFileURL(path.join(root, 'index.html')).href + '#/' + id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1300 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });

await page.goto(url);
await page.waitForSelector('.sheet');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const report = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  const inner = sheet.querySelector('.sheet-inner');
  const fontsOk = ['KoPubWorld Batang', 'KoPubWorld Dotum'].map((f) => [f, document.fonts.check(`16px "${f}"`, '가ᄀᆞ')]);
  // 필기끼리 겹침 검사
  const overlaps = [];
  document.querySelectorAll('.ln .notes').forEach((box) => {
    const rs = [...box.querySelectorAll('.nt')].map((n) => n.getBoundingClientRect());
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      if (rs[i].left < rs[j].right && rs[j].left < rs[i].right) overlaps.push(box.closest('.ln').dataset.li);
    }
  });
  return {
    scale: getComputedStyle(sheet).getPropertyValue('--scale').trim(),
    overflowPx: Math.max(0, inner.scrollHeight - inner.clientHeight),
    spareMm: ((inner.clientHeight - [...inner.children].reduce((a, c) => Math.max(a, c.getBoundingClientRect().bottom), 0) + inner.getBoundingClientRect().top) / 3.7795).toFixed(1),
    units: document.querySelectorAll('.sheet .bk').length,
    fontsOk,
    noteOverlapLines: [...new Set(overlaps)],
  };
});

await page.locator('.sheet').screenshot({ path: path.join(outDir, `${id}.png`) });
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: path.join(outDir, `${id}.pdf`), format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();

const pdf = fs.readFileSync(path.join(outDir, `${id}.pdf`), 'latin1');
report.pdfPages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
report.errors = errors;
console.log(JSON.stringify(report, null, 2));
const bad = report.overflowPx > 0 || report.pdfPages !== 1 || errors.length || report.noteOverlapLines.length;
process.exit(bad ? 1 : 0);
