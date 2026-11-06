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
  if (!plugin()) {
    // pagina kwam uit een cache zonder Android-brug: één keer vers laden
    try { if (!sessionStorage.getItem('tbAppReload')) { sessionStorage.setItem('tbAppReload', '1'); setTimeout(function () { location.reload(); }, 300); } } catch (e) {}
    return;
  }

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
    var now = Date.now(), alarms = [], timers = [], horizon = now + 21 * 864e5;
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
        timers.push({ id: row.id, label: x.label || 'Machine', start: x.startedAt, end: end });
      }
    });
    alarms.sort(function (a, b) { return a.at - b.at; });
    return { alarms: alarms.slice(0, 60), timers: timers };
  }

  var busy = false, last = '';
  async function sync() {
    if (busy) return; busy = true;
    try {
      var C = window.TB_CONFIG || {}, s = json('tb-auth'), me = json('tb_me');
      var token = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      if (!C.supabaseUrl || !C.supabaseKey || !token || !me) return;
      if (s.expires_at && s.expires_at * 1000 < Date.now()) return; // de app vernieuwt de sessie zelf; straks opnieuw
      var cols = '(' + [PFX + 'reminders', PFX + 'timers'].map(function (c) { return '"' + c + '"'; }).join(',') + ')';
      var r = await fetch(C.supabaseUrl + '/rest/v1/docs?select=col,id,data&col=in.' + encodeURIComponent(cols), {
        headers: { apikey: C.supabaseKey, authorization: 'Bearer ' + token }
      });
      if (!r.ok) return;
      var out = build(await r.json(), me);
      out.conn = { url: C.supabaseUrl, key: C.supabaseKey, token: token, pfx: PFX };
      var sig = JSON.stringify([out.alarms, out.timers, token]);
      if (sig === last) return; // niets veranderd
      last = sig;
      await plugin().sync(out);
    } catch (e) {
      console.warn('thuis-app sync', e);
    } finally { busy = false; }
  }

  // even wachten tot de app ingelogd is; daarna om de 20 s zolang de app open is, en bij terugkeren
  setTimeout(sync, 1500);
  setInterval(function () { if (document.visibilityState === 'visible') sync(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { last = ''; setTimeout(sync, 800); } });
  window.addEventListener('storage', function (e) { if (e.key === 'tb_me') { last = ''; sync(); } });

  window.ThuisApp = { sync: function () { last = ''; return sync(); }, test: function (s) { return plugin().testAlarm({ seconds: s || 5 }); } };
})();
