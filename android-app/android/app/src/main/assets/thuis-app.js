/* Thuisbasis Android — koppelscript.
   Wordt ENKEL in de Android-app in de pagina geladen (door ThuisPlugin); de webapp zelf weet hier niets van.
   Leest herinneringen en machines rechtstreeks uit Supabase (alleen lezen, met de bestaande sessie)
   en geeft ze door aan Android, dat er exacte alarmen en een aftellende melding van maakt.
   Raakt de sessie niet aan (geen vernieuwing), schrijft niets in de pagina. */
(function () {
  'use strict';
  if (window.__thuisApp) return;
  if (!/(^|\.)github\.io$/.test(location.hostname)) return; // niet op de offline-pagina
  window.__thuisApp = 1;

  var plugin = function () { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Thuis; };
  var N = window.ThuisNative; // eigen kanaal naar Android (staat los van de Capacitor-brug)
  var report = function (k, v) { try { if (N) N.report(k, String(v)); } catch (e) {} };
  if (!N && !plugin()) {
    // geen verbinding met Android: één keer vers laden
    try { if (!sessionStorage.getItem('tbAppReload')) { sessionStorage.setItem('tbAppReload', '1'); setTimeout(function () { location.reload(); }, 300); } } catch (e) {}
    return;
  }
  var nat = {
    sync: function (o) { return N ? Promise.resolve(JSON.parse(N.sync(JSON.stringify(o)))) : plugin().sync(o); },
    token: function () { return N ? Promise.resolve({ token: N.pushToken() }) : plugin().pushToken(); }
  };
  report('script', 'actief (' + (N ? 'eigen kanaal' : 'Capacitor') + ')');

  /* alarmen rinkelen in de app via Android (eigen beltoon, volledig scherm); het alarmvenster van de webapp
     zou dubbel zijn en blijft anders staan nadat je al op Gedaan/Later/Stop tikte → hier onderdrukken */
  (function quietWebAlarm() {
    var css = '.alarm-ov{display:none!important}'
      /* swipen in de kalender: de webweergave mag horizontaal niets zelf doen (anders hapert het gebaar) */
      + 'html,body{overscroll-behavior-x:none}'
      + '.mgrid,.day-panel{touch-action:pan-y}';
    var addCss = function () { if (document.getElementById('thuis-app-css')) return; var st = document.createElement('style'); st.id = 'thuis-app-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); };
    var sweep = function () {
      if (!document.querySelector('.alarm-ov')) return;
      try { if (typeof alarmStop === 'function') alarmStop(); else document.querySelectorAll('.alarm-ov').forEach(function (x) { x.remove(); }); } catch (e) {}
    };
    var start = function () {
      addCss(); sweep();
      try { new MutationObserver(sweep).observe(document.body, { childList: true }); } catch (e) {}
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  })();

  var ENV = /\/test\/?/.test(location.pathname) ? 'test' : 'live';
  var PFX = ENV === 'test' ? 'test~' : '';
  var PARENTS = ['charlotte', 'ruben'];
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var json = function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  var toMs = function (a) { var p = a.split(' '), d = p[0].split('-').map(Number), t = p[1].split(':').map(Number); return new Date(d[0], d[1] - 1, d[2], t[0], t[1]).getTime(); };

  /* zelfde regels als de app: alarm op het uur of x min vooraf; 'snooze' schuift op; 'ack' = gestopt */
  function alarmAt(r) {
    if (!r || !r.alarm || r.done || !r.date) return null;
    if (r.snooze) return r.snooze;
    var d0 = r.date.split('-').map(Number), t0 = String(r.time || '08:00').split(':').map(Number);
    var d = new Date(d0[0], d0[1] - 1, d0[2], t0[0], t0[1] - (Number(r.alarmBefore) || 0));
    return iso(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function build(rows, me) {
    var now = Date.now(), alarms = [], timers = [], ask = [], horizon = now + 21 * 864e5;
    rows.forEach(function (row) {
      var col = row.col.slice(PFX.length), x = row.data || {};
      if (col === 'reminders') {
        if (x.done || !(x.who || []).includes(me)) return;
        if (x.alarm) {
          var a = alarmAt(x); if (!a || x.ack === a) return;
          var at = toMs(a); if (at < now - 15 * 6e4 || at > horizon) return;
          alarms.push({ id: row.id, key: a, at: at, kind: 'alarm', title: x.title || 'Alarm',
            body: x.time ? 'Om ' + x.time + (Number(x.alarmBefore) && !x.snooze ? ' (over ' + x.alarmBefore + ' min)' : '') : 'Alarm' });
        } else if (x.date) {
          var k = x.date + ' ' + (x.time || '08:00'), at2 = toMs(k);
          if (at2 < now - 15 * 6e4 || at2 > horizon) return;
          alarms.push({ id: row.id, key: k, at: at2, kind: 'note', title: x.title || 'Herinnering', body: x.time ? 'Om ' + x.time : '' });
        }
      } else if (col === 'timers') {
        if (!PARENTS.includes(me) || !x.startedAt || !x.minutes) return;
        var end = x.startedAt + x.minutes * 6e4;
        if (now - end > 60 * 6e4) return;
        // alarm als ze klaar is: wie gekozen werd (popup bij het starten), anders wie ze startte
        var ring = Array.isArray(x.alarmFor) ? x.alarmFor.includes(me) : x.by === me;
        timers.push({ id: row.id, label: x.label || 'Machine', start: x.startedAt, end: end, ring: ring });
        if (x.by === me && !Array.isArray(x.alarmFor) && end > now && now - x.startedAt < 3 * 6e4) ask.push({ id: row.id, label: x.label || 'Machine', start: x.startedAt, me: me });
      }
    });
    alarms.sort(function (a, b) { return a.at - b.at; });
    return { alarms: alarms.slice(0, 60), timers: timers, ask: ask };
  }

  var busy = false, last = '';
  async function sync() {
    if (busy) return; busy = true;
    try {
      var C = window.TB_CONFIG || {}, s = json('tb-auth'), me = json('tb_me');
      var token = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      if (!C.supabaseUrl || !C.supabaseKey) { report('error', 'instellingen van de site niet gevonden'); return; }
      if (!token) { report('error', 'niet ingelogd (nog geen sessie)'); return; }
      if (!me) { report('error', 'nog geen gezinslid gekozen'); return; }
      if (s.expires_at && s.expires_at * 1000 < Date.now()) return; // de app vernieuwt de sessie zelf; straks opnieuw
      var cols = '(' + [PFX + 'reminders', PFX + 'timers'].map(function (c) { return '"' + c + '"'; }).join(',') + ')';
      var r = await fetch(C.supabaseUrl + '/rest/v1/docs?select=col,id,data&col=in.' + encodeURIComponent(cols), {
        headers: { apikey: C.supabaseKey, authorization: 'Bearer ' + token }
      });
      if (!r.ok) { report('error', 'gegevens lezen mislukt: ' + r.status); return; }
      var out = build(await r.json(), me);
      // net een machine gestart? vraag wie een alarm krijgt (één keer per machine)
      out.ask.forEach(function (q) {
        var k = 'tbAppAsked:' + q.id + ':' + q.start, done = false;
        try { done = !!localStorage.getItem(k); localStorage.setItem(k, '1'); } catch (e) {}
        if (!done && N && N.askMachine) N.askMachine(JSON.stringify(q));
      });
      delete out.ask;
      out.conn = { url: C.supabaseUrl, key: C.supabaseKey, token: token, pfx: PFX };
      out.me = me;
      register(C, token, me);
      var sig = JSON.stringify([out.alarms, out.timers, token]);
      if (sig === last) return; // niets veranderd
      last = sig;
      await nat.sync(out);
      report('error', '');
    } catch (e) {
      report('error', 'sync: ' + (e && e.message || e));
      console.warn('thuis-app sync', e);
    } finally { busy = false; }
  }

  /* pushmeldingen: dit toestel (Firebase-code) bij het gezinslid zetten in push_subs; de server stuurt dan via Firebase */
  var registered = '';
  async function register(C, token, me) {
    try {
      var r = await nat.token(); var fcm = r && r.token;
      if (!fcm) { report('push', 'wacht op pushcode'); return; }
      if (registered === fcm + me) return;
      var res = await fetch(C.supabaseUrl + '/rest/v1/push_subs?on_conflict=endpoint', {
        method: 'POST',
        headers: { apikey: C.supabaseKey, authorization: 'Bearer ' + token, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ endpoint: 'fcm:' + fcm, member: me, sub: { fcm: fcm, env: ENV, app: 'planner' }, updated_at: new Date().toISOString() })
      });
      if (res.ok) { registered = fcm + me; report('push', 'ja, als ' + me + ' (' + ENV + ')'); }
      else report('push', 'mislukt: ' + res.status + ' ' + (await res.text()).slice(0, 120));
    } catch (e) { report('push', 'fout: ' + (e && e.message || e)); console.warn('thuis-app push', e); }
  }

  // even wachten tot de app ingelogd is; daarna om de 20 s zolang de app open is, en bij terugkeren
  setTimeout(sync, 1500);
  setInterval(function () { if (document.visibilityState === 'visible') sync(); }, 20000);
  // na een tik in de app (bv. machine gestart, herinnering bewaard) snel bijwerken
  var soon = null;
  document.addEventListener('click', function () { clearTimeout(soon); soon = setTimeout(function () { last = ''; sync(); }, 1500); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { last = ''; setTimeout(sync, 800); } });
  window.addEventListener('storage', function (e) { if (e.key === 'tb_me') { last = ''; sync(); } });

  window.ThuisApp = { sync: function () { last = ''; return sync(); } };
})();
