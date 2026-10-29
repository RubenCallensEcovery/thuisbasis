// Controle 2: de app moet opstarten en de belangrijkste schermen tonen zonder fouten.
// Draait zonder databank (lokale modus), zodat er nooit echte gegevens geraakt worden.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = join(process.cwd(), p);
  if (!existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f)); }).listen(4173);
const b = await chromium.launch(); const errors = [];
for (const [w, h] of [[390, 844], [1024, 768]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errors.push(`${w}px: ${e.message}`));
  await p.route(/supabase-js|jsdelivr/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await p.addInitScript(() => { localStorage.setItem('tb_me', '"ruben"'); });
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(1200);
  for (const v of ['home', 'agenda', 'food', 'house', 'opvang', 'school', 'settings']) {
    await p.evaluate(v => ACT.nav(v), v); await p.waitForTimeout(250);
    const txt = await p.evaluate(() => document.getElementById('main')?.innerText || '');
    if (/Er ging iets mis/.test(txt)) errors.push(`${w}px: scherm ${v} toont een fout`);
  }
  await p.evaluate(() => ACT['ev-new']('2026-11-02')); await p.waitForTimeout(200);
  await p.evaluate(() => { closeSheet(); chatSheet(); }); await p.waitForTimeout(200);
  await p.close();
}
await b.close(); srv.close();
if (errors.length) { console.error('✗ fouten:\n' + errors.join('\n')); process.exit(1); }
console.log('✓ app start en alle schermen werken');
