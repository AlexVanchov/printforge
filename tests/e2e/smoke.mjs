// Quick visual smoke run: node tests/e2e/smoke.mjs <browser> <outdir> [script]
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
const [,, which = 'chromium', out = '/tmp', script = 'basic'] = process.argv;
const PORT = 8840 + (which === 'webkit' ? 1 : 0) + Math.floor(Math.random() * 100) * 2;
const home = process.env.PF_HOME || '/tmp/pfhome-' + which;
import fs from 'node:fs';
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home + '/Documents', { recursive: true });
const srv = spawn('build/printforge', ['--serve', String(PORT)], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
process.on('exit', () => srv.kill());
const browser = await (which === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#splash', { state: 'detached', timeout: 20000 });
  await page.screenshot({ path: out + '/01-welcome.png' });
  await page.click('[data-testid=welcome-start]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/02-tour.png' });
  await page.keyboard.press('Escape');
  for (let i = 0; i < 5; i++) { const b = await page.$('.tour .btn.primary'); if (b) { console.log('tour btn', JSON.stringify(await b.boundingBox()), await page.evaluate(() => [innerWidth, innerHeight, document.querySelector('.tour').style.cssText])); await b.click({ timeout: 4000 }); await page.waitForTimeout(250); } }
  await page.click('[data-testid=add-box]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/03-box.png' });
  await page.click('[data-testid=tab-functional]');
  await page.click('[data-testid=add-storage_box]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '/04-storage.png' });
} catch (e) { errors.push('TEST: ' + e.message); }
console.log(errors.join('\n') || 'no console errors');
await browser.close();
srv.kill();
