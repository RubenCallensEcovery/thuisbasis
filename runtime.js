/* Thuisbasis runtime: laat de app buiten Claude draaien.
   Biedt dezelfde 'window.claude.use(...)' aan als binnen Claude, maar dan met:
   - db      → Supabase (tabel docs, live sync)
   - sample  → Jonah via de Supabase-functie 'jonah' (Claude API)
   - mcp     → weer via Open-Meteo (zelfde vorm als AccuWeather)
   en zorgt voor inloggen met het gezinsaccount en pushmeldingen. */
(function () {
  'use strict';
  const C = window.TB_CONFIG || {};
  const ENV = /\/test\/?/.test(location.pathname) ? 'test' : (C.env || 'live');
  const PFX = ENV === 'test' ? 'test~' : '';
  const configured = C.supabaseUrl && !/VUL_IN/.test(C.supabaseUrl) && window.supabase;
  const sb = configured ? window.supabase.createClient(C.supabaseUrl, C.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tb-auth' } }) : null;
  window.TB_ENV = ENV;

  /* ---------------- inloggen (gezinsaccount) ---------------- */
  let sessionP = null;
  function css() {
    if (document.getElementById('tb-login-css')) return;
    const s = document.createElement('style'); s.id = 'tb-login-css';
    s.textContent = `#tb-login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#F4F0E6;font-family:Jost,Futura,system-ui,sans-serif;padding:24px}
#tb-login form{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px}
#tb-login .lg{display:flex;justify-content:center;margin-bottom:14px}#tb-login .lg i{width:16px;height:16px;display:inline-block}
#tb-login h1{font-size:28px;font-weight:500;margin:0 0 4px;color:#141414}#tb-login p{margin:0 0 8px;color:#5E5A52;font-size:15px;line-height:1.4}
#tb-login input{font:inherit;font-size:16px;padding:12px 14px;border:1px solid rgba(20,20,20,.25);background:#fff;border-radius:0}
#tb-login button{font:inherit;font-size:16px;padding:12px;border:0;background:#141414;color:#fff;cursor:pointer}
#tb-login .err{color:#D7301F;font-size:14px;min-height:1em}#tb-login .env{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#D7301F}`;
    document.head.appendChild(s);
  }
  function showLogin() {
    return new Promise(resolve => {
      css();
      const d = document.createElement('div'); d.id = 'tb-login';
      d.innerHTML = `<form autocomplete="on"><div class="lg"><svg viewBox="125 95 770 725" width="120" height="113" fill="none" stroke="#141414" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M400 293 L419 130 Q482 200 503 272"/><path d="M548 295 L565 130 Q628 200 650 280 Q790 330 798 552"/><path d="M355 348 Q395 290 470 282 L548 295"/><circle cx="178" cy="305" r="29"/><path d="M355 348 L204 326 L182 432 L224 402 L258 437 L292 410 L326 440 L360 410 L396 440 L420 414 L455 498"/><path d="M455 498 L426 516 L396 494 L362 524 L330 494 L296 524 L262 494 L228 524 L194 494 L210 580 L465 606 L610 546 L562 512 L652 466 L582 432 L662 402"/><path d="M455 375 Q490 330 525 380"/><path d="M364 622 L322 676 L404 690 L350 722 L426 706 L378 790"/><path d="M735 515 L862 622 L768 602 L857 716"/><path d="M711 680 L744 754"/></svg></div>
        ${ENV === 'test' ? '<div class="env">Testversie</div>' : ''}<p>Log één keer in met het gezinsaccount. Daarna kies je gewoon wie je bent.</p>
        <input type="email" name="email" placeholder="E-mailadres gezinsaccount" autocomplete="username" required>
        <input type="password" name="password" placeholder="Wachtwoord" autocomplete="current-password" required>
        <div class="err" role="alert"></div><button type="submit">Inloggen</button></form>`;
      document.body.appendChild(d);
      const f = d.querySelector('form');
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const err = d.querySelector('.err'); err.textContent = '';
        const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (error) { err.textContent = 'Inloggen lukte niet. Kijk het e-mailadres en wachtwoord na.'; return; }
        d.remove(); resolve(data.session);
      });
    });
  }
  function getSession() {
    if (!sessionP) sessionP = (async () => {
      const { data } = await sb.auth.getSession();
      return data.session || await showLogin();
    })();
    return sessionP;
  }
  async function token() { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : (await getSession()).access_token; }
  window.TB_LOGOUT = async () => { if (sb) await sb.auth.signOut(); localStorage.removeItem('tb_me'); location.reload(); };

  /* ---------------- databank ---------------- */
  const store = new Map();      // col -> Map(id -> data)
  const listeners = new Map();  // col -> Set(fn)
  const loaded = new Set();
  const colMap = c => store.get(c) || (store.set(c, new Map()), store.get(c));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  function emit(c) { (listeners.get(c) || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  async function loadCol(c) {
    const { data, error } = await sb.from('docs').select('id,data').eq('col', PFX + c);
    if (error) throw error;
    const m = colMap(c); m.clear(); data.forEach(r => m.set(r.id, r.data)); loaded.add(c); emit(c);
  }
  let channel = null;
  function startRealtime() {
    if (channel) return;
    channel = sb.channel('tb-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      const row = p.eventType === 'DELETE' ? p.old : p.new; if (!row || !row.col) return;
      if (!row.col.startsWith(PFX) || (!PFX && row.col.includes('~'))) return;
      const c = row.col.slice(PFX.length); if (!listeners.has(c)) return;
      const m = colMap(c);
      if (p.eventType === 'DELETE') m.delete(row.id); else m.set(row.id, row.data);
      emit(c);
    }).subscribe(st => { if (st === 'SUBSCRIBED') [...listeners.keys()].forEach(c => loadCol(c).catch(() => {})); });
  }
  /* bij terugkeren naar de app (gsm uit slaap): alles opnieuw ophalen */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sb) [...listeners.keys()].forEach(c => loadCol(c).catch(() => {})); });

  function Doc(c, id) {
    return {
      id,
      async set(data) { colMap(c).set(id, data); emit(c); const { error } = await sb.from('docs').upsert({ col: PFX + c, id, data, updated_at: new Date().toISOString() }); if (error) throw error; },
      async update(patch) { const m = colMap(c); m.set(id, Object.assign({}, m.get(id) || {}, patch)); emit(c); const { error } = await sb.rpc('doc_merge', { p_col: PFX + c, p_id: id, p_patch: patch }); if (error) throw error; },
      async delete() { colMap(c).delete(id); emit(c); const { error } = await sb.from('docs').delete().eq('col', PFX + c).eq('id', id); if (error) throw error; }
    };
  }
  function Query(c, ord, lim) {
    return {
      orderBy(f, dir) { return Query(c, [f, dir], lim); },
      limit(n) { return Query(c, ord, n); },
      doc(id) { return Doc(c, id || newId()); },
      onSnapshot(cb, onErr) {
        const fn = () => {
          let docs = [...colMap(c).entries()].map(([id, d]) => ({ id, data: () => d }));
          if (ord) { const [f, dir] = ord; docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1); }); }
          if (lim) docs = docs.slice(0, lim);
          cb({ docs });
        };
        if (!listeners.has(c)) listeners.set(c, new Set());
        listeners.get(c).add(fn);
        startRealtime();
        if (loaded.has(c)) fn(); else loadCol(c).catch(e => { console.warn('laden', c, e); onErr && onErr(e); });
        return () => listeners.get(c).delete(fn);
      }
    };
  }
  const DB = { collection: c => Query(c) };

  /* ---------------- Jonah (Claude via de functie 'jonah') ---------------- */
  async function callJonah(payload, signal) {
    const r = await fetch(C.supabaseUrl + '/functions/v1/jonah', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', apikey: C.supabaseKey, authorization: 'Bearer ' + await token() },
      body: JSON.stringify(payload)
    });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) { const msg = (j && j.error && j.error.message) || txt || ('HTTP ' + r.status); const e = new Error(msg); e.code = r.status === 429 ? 'rate_limited' : 'upstream_error'; e.text = 'Melding van de server: ' + String(msg).slice(0, 200); throw e; }
    return j;
  }
  const textOf = msg => (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  async function sample(input, opts) {
    opts = opts || {};
    const tools = (opts.tools || []);
    const messages = input.map(m => ({ role: m.role, content: m.content }));
    let shown = '', truncated = false;
    for (let round = 0; round < 8; round++) {
      if (opts.signal && opts.signal.aborted) { const e = new Error('cancelled'); e.code = 'cancelled'; e.text = shown; throw e; }
      let res;
      try { res = await callJonah({ messages, tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), max_tokens: 1500 }, opts.signal); }
      catch (e) { if (e.name === 'AbortError') { e.code = 'cancelled'; e.text = shown; } throw e; }
      const t = textOf(res);
      if (t) { shown = (shown ? shown + '\n\n' : '') + t; opts.onText && opts.onText({ text: shown }); }
      truncated = res.stop_reason === 'max_tokens';
      const uses = (res.content || []).filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) break;
      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const u of uses) {
        const tool = tools.find(x => x.name === u.name);
        try { const out = tool ? await tool.execute(u.input || {}) : 'Onbekende tool'; results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out) }); }
        catch (e) { results.push({ type: 'tool_result', tool_use_id: u.id, content: String((e && e.message) || e), is_error: true }); }
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: shown, truncated };
  }
  const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  sample.json = async (prompt, opts) => {
    opts = opts || {};
    const content = [];
    for (const img of (opts.images || [])) content.push({ type: 'image', source: { type: 'base64', media_type: img.type || 'image/png', data: await toB64(img) } });
    content.push({ type: 'text', text: prompt });
    const res = await callJonah({ messages: [{ role: 'user', content }], max_tokens: 4000 });
    const t = textOf(res).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const s = t.indexOf('['), o = t.indexOf('{'); const start = s >= 0 && (o < 0 || s < o) ? s : o;
    return JSON.parse(start > 0 ? t.slice(start) : t);
  };
  sample.limits = async () => ({ tools: { maxCount: 20 }, images: true });

  /* ---------------- weer via Open-Meteo (zelfde vorm als AccuWeather) ---------------- */
  const WMO = {0:[1,'Zonnig'],1:[2,'Overwegend zonnig'],2:[4,'Gedeeltelijk bewolkt'],3:[7,'Bewolkt'],45:[11,'Mist'],48:[11,'Rijpmist'],51:[12,'Lichte motregen'],53:[12,'Motregen'],55:[12,'Dichte motregen'],56:[24,'Ijzel'],57:[24,'Ijzel'],61:[12,'Lichte regen'],63:[18,'Regen'],65:[18,'Zware regen'],66:[26,'Ijzel'],67:[26,'Ijzel'],71:[19,'Lichte sneeuw'],73:[22,'Sneeuw'],75:[22,'Zware sneeuw'],77:[19,'Sneeuwkorrels'],80:[13,'Regenbuien'],81:[14,'Regenbuien'],82:[18,'Zware buien'],85:[20,'Sneeuwbuien'],86:[22,'Zware sneeuwbuien'],95:[15,'Onweer'],96:[16,'Onweer met hagel'],99:[17,'Zwaar onweer']};
  const wmo = (c, night) => { const w = WMO[c] || [7, 'Bewolkt']; let ic = w[0]; if (night && ic <= 2) ic = 33; else if (night && ic === 4) ic = 35; return [ic, w[1]]; };
  function locOf(key) { const m = String(key || '').match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/); return m ? [m[1], m[2]] : ['50.9996', '3.3277']; }
  async function meteo(key) {
    const [lat, lon] = locOf(key);
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=Europe%2FBrussels&forecast_days=10&wind_speed_unit=kmh`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max'
      + '&hourly=weather_code,temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,is_day';
    const r = await fetch(u); if (!r.ok) throw Object.assign(new Error('weer'), { code: 'upstream_error' }); return r.json();
  }
  async function weather(tool, input) {
    const q = (input && input.queryParams) || {};
    if (tool === 'widgets-search-claude') {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?language=nl&count=6&name=' + encodeURIComponent(q.query || ''));
      const j = await r.json();
      return { payload: { results: (j.results || []).map(x => ({ locationKey: x.latitude.toFixed(4) + ',' + x.longitude.toFixed(4), name: [x.name, x.admin1, x.country_code].filter(Boolean).join(', ') })) } };
    }
    const m = await meteo(q.locationKey);
    if (tool === 'widgets-daily-claude') {
      const D = m.daily;
      return { payload: { dailyForecast: D.time.map((t, i) => {
        const [di, dp] = wmo(D.weather_code[i], false), [ni, np] = wmo(D.weather_code[i], true), rain = D.precipitation_probability_max[i] || 0;
        const ext = { rainValue: D.precipitation_sum[i] || 0, wind: Math.round(D.wind_speed_10m_max[i] || 0) + ' km/u', gusts: Math.round(D.wind_gusts_10m_max[i] || 0) };
        return { date: t + 'T07:00:00+01:00',
          day: { icon: di, phrase: dp, longPhrase: dp, temperature: D.temperature_2m_max[i], realFeelValue: D.apparent_temperature_max[i], rainProbabilityValue: rain, extended: ext },
          night: { icon: ni, phrase: np, longPhrase: np, temperature: D.temperature_2m_min[i], realFeelValue: D.apparent_temperature_min[i], rainProbabilityValue: rain, extended: ext } };
      }) }, cache: { storedAt: Date.now() } };
    }
    if (tool === 'widgets-hourly-claude') {
      const H = m.hourly, now = Date.now() - 36e5;
      const out = [];
      H.time.forEach((t, i) => { if (new Date(t).getTime() < now || out.length >= 24) return;
        const [ic, ph] = wmo(H.weather_code[i], !H.is_day[i]);
        out.push({ date: t + ':00', icon: ic, phrase: ph, temperatureValue: H.temperature_2m[i], realFeelValue: H.apparent_temperature[i], precip: H.precipitation_probability[i] || 0,
          extended: { rainProbability: String(H.precipitation_probability[i] || 0), rainValue: H.precipitation[i] || 0, windValue: Math.round(H.wind_speed_10m[i] || 0), gustsValue: Math.round(H.wind_gusts_10m[i] || 0) } }); });
      return { payload: { hourlyForecast: out }, cache: { storedAt: Date.now() } };
    }
    throw Object.assign(new Error('onbekend'), { code: 'not_in_manifest' });
  }
  const MCP = {
    listTools: async () => ({ servers: [{ server: 'AccuWeather', authStatus: 'ok' }] }),
    callTool: (server, tool, input) => weather(tool, input),
    watchTool(server, tool, input, handler, opts) {
      let stop = false;
      const run = () => weather(tool, input).then(result => { if (!stop) handler({ type: 'data', result }); }).catch(e => { if (!stop) handler({ type: 'error', error: { code: 'upstream_error' } }); });
      run(); const iv = setInterval(run, (opts && opts.refetchInterval) || 30 * 6e4);
      return () => { stop = true; clearInterval(iv); };
    }
  };

  /* ---------------- pushmeldingen ---------------- */
  const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...b].map(ch => ch.charCodeAt(0))); };
  let swReg = null;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(e => console.warn('sw', e));
  window.TB_PUSH = {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    async enable(member, ask) {
      if (!sb || !member || !this.supported() || ENV === 'test') return false;
      if (Notification.permission === 'default' && ask) await Notification.requestPermission();
      if (Notification.permission !== 'granted') return false;
      const reg = swReg || await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(C.vapidPublic) });
      const j = sub.toJSON();
      await sb.from('push_subs').upsert({ endpoint: j.endpoint, member, sub: j, updated_at: new Date().toISOString() });
      return true;
    }
  };

  /* ---------------- window.claude.use ---------------- */
  window.claude = {
    use: async name => {
      if (!sb) return null;
      if (name === 'db') { await getSession(); return DB; }
      if (name === 'sample') { await getSession(); return sample; }
      if (name === 'mcp') return MCP;
      return null; // assets, permissions: niet nodig buiten Claude
    }
  };
})();
