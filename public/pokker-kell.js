// pokker-kell.js — TELJE POKKERI turniirikella arvutus brauseris (sama loogika mis serveris routes/pokker.js).
// Server saadab kella seisu { idx, jookseb, lopp, jaak } ja oma kellaaja (nuud). Brauser arvutab nende järgi
// iga sekundi ise, nii et kell liigub sujuvalt ka päringute vahel ja level vahetub täpselt õigel hetkel.
(function () {
  function nr(x, v) { var n = parseFloat(x); return isFinite(n) ? n : (v || 0); }
  function kestus(el, s) { return Math.round((nr(el && el.min) || (el && el.paus ? s.pausi_min : s.leveli_min)) * 60000); }
  function onUusLevel(el) { return el && !el.paus && !el.jatk; }
  function normaliseeri(kell, st, s, nuud) {
    var k = Object.assign({}, kell || { idx: 0, jookseb: false, jaak: kestus(st[0], s) });
    if (!st.length) return k;
    if (k.idx >= st.length) k.idx = st.length - 1;
    if (!k.jookseb) return k;
    var kaitse = 0;
    while (nuud >= k.lopp && kaitse++ < 200) {
      if (k.idx >= st.length - 1) { k.jookseb = false; k.jaak = 0; k.lopp = null; break; }
      k.idx += 1;
      k.lopp += kestus(st[k.idx], s);
    }
    return k;
  }
  function jaak(k, nuud) { return k.jookseb ? Math.max(0, k.lopp - nuud) : Math.max(0, k.jaak || 0); }
  function leveliNumber(st, idx) { var n = 0; for (var i = 0; i <= idx && i < st.length; i++) if (onUusLevel(st[i])) n++; return n; }
  function info(seaded, st, kell, nuud) {
    var s = seaded;
    var k = normaliseeri(kell, st, s, nuud);
    var el = st[k.idx] || null;
    var j = jaak(k, nuud);
    var jargmine = null, i;
    for (i = k.idx + 1; i < st.length; i++) {
      if (st[i].paus) continue;
      if (st[i].jatk && !(el && el.paus)) continue;
      jargmine = st[i]; break;
    }
    var pausini = null;
    if (el && !el.paus) {
      var summa = j, leitud = false;
      for (i = k.idx + 1; i < st.length; i++) { if (st[i].paus) { leitud = true; break; } summa += kestus(st[i], s); }
      pausini = leitud ? summa : null;
    }
    var levelNr = leveliNumber(st, k.idx);
    var N = s.lisaperiood_levelid || 0;
    var lisaTyyp = s.tyyp === 'rebuy' ? 'rebuy' : s.tyyp === 'reentry' ? 're-entry' : null;
    var periood = { tyyp: lisaTyyp, avatud: false, jaak: null };
    if (lisaTyyp && N > 0 && el) {
      var avatud = el.paus ? levelNr < N : levelNr <= N;
      var lopuni = null;
      if (avatud) {
        lopuni = j; var n = levelNr;
        for (i = k.idx + 1; i < st.length; i++) {
          if (onUusLevel(st[i])) { if (n >= N) break; n++; }
          else if (st[i].paus && n >= N) break;
          lopuni += kestus(st[i], s);
        }
      }
      periood = { tyyp: lisaTyyp, avatud: avatud, jaak: lopuni };
    }
    return {
      kell: k, jaak: j, element: el, level_nr: levelNr, jargmine: jargmine, pausini: pausini, periood: periood,
      addon_aeg: !!(el && el.paus && el.addon), viimane: k.idx >= st.length - 1, kokku: kestus(el, s)
    };
  }
  function aeg(ms) {
    var sek = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60), s = sek % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }
  function arv(x) { return Math.round(nr(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function raha(x) { var n = Math.round(nr(x) * 100) / 100; return (n % 1 ? n.toFixed(2).replace('.', ',') : arv(n)) + ' €'; }
  function blindid(el) {
    if (!el) return '—';
    if (el.paus) return 'PAUS';
    return arv(el.sb) + ' / ' + arv(el.bb);
  }
  function ante(el) {
    if (!el || el.paus || !el.ante) return '';
    return (el.bba ? 'BB ante ' : 'Ante ') + arv(el.ante);
  }
  // Lühike helisignaal (Web Audio, ei vaja helifaile)
  var ctx = null;
  function piiks(kordi, korgus) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      for (var i = 0; i < (kordi || 1); i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = korgus || 880;
        var t0 = ctx.currentTime + i * 0.35;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0); o.stop(t0 + 0.3);
      }
    } catch (e) {}
  }
  function avaHelid() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch (e) {} }
  window.PokkerKell = { kestus: kestus, normaliseeri: normaliseeri, info: info, aeg: aeg, arv: arv, raha: raha, blindid: blindid, ante: ante, piiks: piiks, avaHelid: avaHelid, leveliNumber: leveliNumber, onUusLevel: onUusLevel };
})();
