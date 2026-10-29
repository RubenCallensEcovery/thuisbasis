// Controle 1: alle JavaScript moet geldig zijn.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error('Geen app-code gevonden in index.html');
scripts.forEach((s, i) => { writeFileSync(`/tmp/tb-inline-${i}.js`, s); execSync(`node --check /tmp/tb-inline-${i}.js`, { stdio: 'inherit' }); });
for (const f of ['runtime.js', 'sw.js', 'config.js']) execSync(`node --check ${f}`, { stdio: 'inherit' });
JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
console.log('✓ code is geldig');
