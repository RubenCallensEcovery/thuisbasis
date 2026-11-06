// Schrijft capacitor.config.json voor de gekozen variant.
//   TB_VARIANT=test → laadt de testversie (…/thuisbasis/test/), app "Thuisbasis test"
//   TB_VARIANT=live → laadt de live webapp (…/thuisbasis/), app "Thuisbasis"
import { writeFileSync } from 'node:fs';
const v = process.env.TB_VARIANT === 'live' ? 'live' : 'test';
const base = 'https://rubencallensecovery.github.io/thuisbasis/';
const cfg = {
  appId: 'be.callens.thuisbasis',
  appName: v === 'live' ? 'Thuisbasis' : 'Thuisbasis test',
  webDir: 'www',
  server: {
    url: v === 'live' ? base : base + 'test/',
    errorPath: 'offline.html'
  },
  plugins: { SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' } },
  android: { appendUserAgent: 'ThuisbasisApp/1' + (v === 'test' ? ' test' : '') }
};
writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2) + '\n');
console.log('capacitor.config.json →', v, cfg.server.url);
