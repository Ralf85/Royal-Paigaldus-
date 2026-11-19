// pokker.js — TELJE POKKERI rakendus (avaleht, turniiri juhtpult, edetabel, mängijad, statistika, ajalugu,
// hooajad, formaadid, seadistused). Andmed tulevad /api/pokker/* kaudu, sessioon päises x-session-token.
var K = window.PokkerKell;
var TOKEN = '';
var ROLL = null;
var AJUTINE = {};        // vahemälu: formaadid, hooajad, mangijad
var POLL = null;          // juhtpuldi värskendus
var TIKK = null;          // kella sekundilugeja
var TD = null;            // avatud turniiri andmed
var TD_NIHE = 0;
var TD_RASI = '';

// ── ABI ──────────────────────────────────────────────────────────────────
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }
var raha = K.raha, arv = K.arv;
function kp(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
function tana() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function onAdmin() { return ROLL === 'admin'; }
var KUUD = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];
function initsiaalid(n) { return String(n || '?').split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2).toUpperCase(); }
function avatar(nimi, url, cls) {
  return url ? '<img class="avatar ' + (cls || '') + '" src="' + esc(url) + '" alt="">' : '<span class="avatar ' + (cls || '') + '">' + esc(initsiaalid(nimi)) + '</span>';
}
function kohaMark(k) { return k ? '<span class="koht k' + (k <= 3 ? k : '') + '">' + k + '</span>' : '<span class="hall">—</span>'; }
function toast(t, viga) {
  var el = $('toast'); el.textContent = t; el.className = 'naha' + (viga ? ' viga' : '');
  clearTimeout(toast.t); toast.t = setTimeout(function () { el.className = viga ? 'viga' : ''; }, viga ? 4000 : 2200);
}
function modaal(html, lai) { $('modaal-kast').className = 'kast' + (lai ? ' lai' : ''); $('modaal-kast').innerHTML = html; $('modaal').classList.add('lahti'); }
function sulgeModaal() { $('modaal').classList.remove('lahti'); $('modaal-kast').innerHTML = ''; }
function modaalLahti() { return $('modaal').classList.contains('lahti'); }
function kinnita(tekst, nupuTekst, ohtlik) {
  return new Promise(function (resolve) {
    modaal('<h3>' + esc(tekst) + '</h3><div class="modaal-nupud"><button id="k-ei">Tühista</button><button id="k-jah" class="' + (ohtlik ? 'punanupp' : 'kuldnupp') + '">' + esc(nupuTekst || 'Jah') + '</button></div>');
    $('k-ei').onclick = function () { sulgeModaal(); resolve(false); };
    $('k-jah').onclick = function () { sulgeModaal(); resolve(true); };
  });
}

async function api(tee, meetod, keha) {
  var seaded = { method: meetod || 'GET', headers: { 'x-session-token': TOKEN } };
  if (keha !== undefined) { seaded.headers['Content-Type'] = 'application/json'; seaded.body = JSON.stringify(keha); }
  var r;
  try { r = await fetch('/api/pokker' + tee, seaded); } catch (e) { toast('Ühendus puudub', true); throw e; }
  if (r.status === 401) { naitaLogin(); throw new Error('401'); }
  var d = await r.json().catch(function () { return { ok: false, veateade: 'Serveri viga' }; });
  if (!d.ok && meetod && meetod !== 'GET') toast(d.veateade || 'Viga', true);
  return d;
}
async function laeAlla(tee, failinimi) {
  var r = await fetch('/api/pokker' + tee, { headers: { 'x-session-token': TOKEN } });
  if (!r.ok) return toast('Allalaadimine ebaõnnestus', true);
  var b = await r.blob(); var a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = failinimi; document.body.appendChild(a); a.click(); a.remove();
}
async function formaadid(uuesti) { if (uuesti || !AJUTINE.formaadid) AJUTINE.formaadid = (await api('/formaadid')).formaadid || []; return AJUTINE.formaadid; }
async function hooajad(uuesti) { if (uuesti || !AJUTINE.hooajad) AJUTINE.hooajad = (await api('/hooajad')).hooajad || []; return AJUTINE.hooajad; }
async function mangijad(uuesti) { if (uuesti || !AJUTINE.mangijad) AJUTINE.mangijad = (await api('/mangijad')).mangijad || []; return AJUTINE.mangijad; }

// ── SISSELOGIMINE ────────────────────────────────────────────────────────
function naitaLogin() {
  peataPoll();
  $('rakendus').classList.add('peidus'); $('login').classList.remove('peidus');
  setTimeout(function () { $('pin').focus(); }, 50);
}
async function logiSisse(e) {
  e.preventDefault();
  var pin = $('pin').value.trim();
  var r = await fetch('/api/pokker/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin }) });
  var d = await r.json();
  if (!d.ok) { $('login-viga').textContent = d.veateade || 'Vale PIN'; $('pin').value = ''; return; }
  TOKEN = d.token; ROLL = d.roll;
  try { localStorage.setItem('pokkerToken', TOKEN); } catch (er) {}
  $('pin').value = ''; $('login-viga').textContent = '';
  kaivitaRakendus();
}
async function logiValja() {
  if (!(await kinnita('Kas logid välja?', 'Logi välja'))) return;
  try { await fetch('/api/pokker/logout', { method: 'POST', headers: { 'x-session-token': TOKEN } }); } catch (e) {}
  try { localStorage.removeItem('pokkerToken'); } catch (e) {}
  TOKEN = ''; ROLL = null; AJUTINE = {};
  naitaLogin();
}
async function alusta() {
  var voimalikud = [];
  try { voimalikud = [localStorage.getItem('pokkerToken'), localStorage.getItem('adminToken')].filter(Boolean); } catch (e) {}
  for (var i = 0; i < voimalikud.length; i++) {
    try {
      var r = await fetch('/api/pokker/sessioon', { headers: { 'x-session-token': voimalikud[i] } });
      var d = await r.json();
      if (d.roll) { TOKEN = voimalikud[i]; ROLL = d.roll; return kaivitaRakendus(); }
    } catch (e) {}
  }
  naitaLogin();
}
function kaivitaRakendus() {
  $('login').classList.add('peidus'); $('rakendus').classList.remove('peidus');
  $('roll-silt').textContent = onAdmin() ? 'ADMIN' : 'MÄNGIJA';
  $('roll-silt').className = 'roll' + (onAdmin() ? ' admin' : '');
  document.querySelectorAll('.ainult-admin').forEach(function (el) { el.classList.toggle('peidus', !onAdmin()); });
  marsruut();
}

// ── MARSRUUDID ───────────────────────────────────────────────────────────
window.addEventListener('hashchange', marsruut);
function peataPoll() { clearInterval(POLL); clearInterval(TIKK); POLL = null; TIKK = null; TD = null; TD_RASI = ''; }
async function marsruut() {
  if (!ROLL) return;
  peataPoll();
  sulgeModaal();
  var osad = (location.hash.replace(/^#/, '') || 'avaleht').split('/');
  var leht = osad[0], id = osad[1];
  document.querySelectorAll('#menyy a[data-leht]').forEach(function (a) {
    var l = a.dataset.leht;
    a.classList.toggle('aktiivne', l === leht || (l === 'mangijad' && leht === 'mangija'));
  });
  $('sisu').innerHTML = '<div class="tyhi">Laen…</div>';
  window.scrollTo(0, 0);
  try {
    if (leht === 'turniir' && id) return await turniirVaade(id);
    if (leht === 'ajalugu' && id) return await turniirVaade(id);
    if (leht === 'turniir') return await turniiridLeht();
    if (leht === 'edetabel') return await edetabelLeht(id);
    if (leht === 'mangijad') return await mangijadLeht();
    if (leht === 'mangija' && id) return await mangijaLeht(id);
    if (leht === 'statistika') return await statistikaLeht();
    if (leht === 'ajalugu') return await ajaluguLeht();
    if (leht === 'hooajad') return await hooajadLeht();
    if (leht === 'formaadid') return await formaadidLeht();
    if (leht === 'seaded' && onAdmin()) return await seadedLeht();
    return await avaleht();
  } catch (e) {
    if (e.message !== '401') { console.error(e); $('sisu').innerHTML = '<div class="tyhi">Lehe laadimine ebaõnnestus.</div>'; }
  }
}

// ── AVALEHT ──────────────────────────────────────────────────────────────
async function avaleht() {
  var d = await api('/avaleht');
  var h = '<div class="kaart kangelane"><img src="/pokker-logo.png" alt=""><div class="tekst">' +
    '<div class="suurtekst kuldne">TELJE POKKER</div><div class="hall">Privaatne pokkeriklubi • EST. 2015 • ' + (new Date().getFullYear() - 2015) + ' aastat igakuiseid turniire</div>' +
    '<div class="statid" style="margin-top:14px"><div class="stat"><div class="s">TURNIIRE</div><div class="v num kuldne">' + d.kokku.turniire + '</div></div>' +
    '<div class="stat"><div class="s">MÄNGIJAID</div><div class="v num kuldne">' + d.kokku.mangijaid + '</div></div></div></div></div>';
  h += '<div class="ruudustik">';
  // Järgmine / käimasolev turniir
  h += '<div class="kaart"><h2>' + (d.jargmine && d.jargmine.staatus === 'kaib' ? '● TURNIIR KÄIB' : 'JÄRGMINE TURNIIR') + '</h2>';
  if (d.jargmine) {
    h += '<div style="font-size:20px;font-weight:900">' + esc(d.jargmine.nimi) + '</div><div class="hall">' + kp(d.jargmine.kuupaev) + ' • ' + esc(d.jargmine.formaadi_nimi || '') + '</div>' +
      '<div class="rida" style="margin-top:12px"><a class="nupp punanupp" href="/pokker-tv" target="_blank">📺 LIVE TV</a>' +
      '<a class="nupp kuldnupp" href="#turniir/' + d.jargmine.id + '">' + (onAdmin() ? '🎛 Juhtpult' : 'Vaata turniiri') + '</a></div>';
  } else {
    h += '<div class="hall">Järgmist turniiri pole veel välja kuulutatud.</div>' + (onAdmin() ? '<div style="margin-top:12px"><button class="kuldnupp" onclick="uusTurniir()">+ Kuuluta välja uus turniir</button></div>' : '');
  }
  h += '</div>';
  // Viimane turniir
  h += '<div class="kaart"><h2>VIIMANE TURNIIR</h2>';
  if (d.viimane) {
    h += '<div style="font-size:18px;font-weight:900">' + esc(d.viimane.nimi) + '</div><div class="hall">' + kp(d.viimane.kuupaev) + ' • ' + esc(d.viimane.formaadi_nimi || '') + '</div>' +
      (d.viimane.voitja ? '<div style="margin-top:12px;font-size:17px">🏆 Võitja: <b class="kuldne">' + esc(d.viimane.voitja) + '</b></div>' : '') +
      '<div style="margin-top:12px"><a class="nupp" href="#ajalugu/' + d.viimane.id + '">Vaata tulemusi</a></div>';
  } else h += '<div class="hall">Lõpetatud turniire pole veel.</div>';
  h += '</div>';
  // Hooaja TOP 5
  h += '<div class="kaart"><h2>' + esc(d.hooaeg ? d.hooaeg.nimi.toUpperCase() : 'HOOAEG') + ' • TOP 5</h2>';
  if (d.top.length) {
    h += '<table>' + d.top.map(function (r) {
      return '<tr class="klikk" onclick="location.hash=\'mangija/' + r.mangija_id + '\'"><td style="width:40px">' + kohaMark(r.koht) + '</td><td><div class="mangija-nimi">' + avatar(r.nimi, r.foto_url) + esc(r.nimi) + '</div></td><td class="r num"><b>' + r.punktid + '</b> p</td></tr>';
    }).join('') + '</table><div style="margin-top:10px"><a href="#edetabel">Kogu edetabel →</a></div>';
  } else h += '<div class="hall">Punkte pole veel jagatud.</div>';
  h += '</div></div>';
  $('sisu').innerHTML = h;
}

// ── TURNIIRID (nimekiri + loomine) ───────────────────────────────────────
async function turniiridLeht() {
  var d = await api('/turniirid?staatus=aktiivsed');
  var h = '<h1 class="leht kuldne">TURNIIR</h1>';
  if (onAdmin()) h += '<div class="rida" style="margin-bottom:14px"><button class="kuldnupp suur" onclick="uusTurniir()">+ Uus turniir</button><a class="nupp" href="#ajalugu">Lisa varasem turniir (ajaloost)</a></div>';
  if (!d.turniirid.length) h += '<div class="kaart tyhi">Käimasolevaid ega tulevasi turniire pole.' + (onAdmin() ? '' : ' Vaata <a href="#ajalugu">ajalugu</a>.') + '</div>';
  d.turniirid.slice().reverse().forEach(function (t) {
    h += '<div class="kaart"><div class="rida"><div class="vahe"><div style="font-size:19px;font-weight:900">' + esc(t.nimi) + '</div>' +
      '<div class="hall">' + kp(t.kuupaev) + ' • ' + esc(t.formaadi_nimi || '') + ' • ' + t.osalejaid + ' mängijat' + (t.punktiturniir ? ' • ' + esc(t.hooaja_nimi || 'hooajata') : '') + '</div></div>' +
      (t.staatus === 'kaib' ? '<span class="silt punane">● KÄIB</span>' : '<span class="silt kuld">TULEMAS</span>') + (t.punktiturniir ? '' : '<span class="silt sinine">SÕPRUSMÄNG</span>') +
      '<a class="nupp kuldnupp" href="#turniir/' + t.id + '">' + (onAdmin() ? '🎛 Juhtpult' : 'Ava') + '</a></div></div>';
  });
  $('sisu').innerHTML = h;
}

var SEADE_VALJAD = [
  ['buyin', 'Buy-in €', 'koik'], ['bounty', 'Bounty €', 'koik'], ['algstack', 'Algstack', 'koik'],
  ['rebuy_summa', 'Rebuy €', 'rebuy'], ['rebuy_stack', 'Rebuy stack', 'rebuy'],
  ['reentry_summa', 'Re-entry € (ilma bountyta)', 'reentry'], ['reentry_stack', 'Re-entry stack', 'reentry'],
  ['addon_summa', 'Add-on € (0 = puudub)', 'koik'], ['addon_stack', 'Add-on stack', 'koik'],
  ['lisaperiood_levelid', 'Rebuy/re-entry periood (levelit)', 'lisa'], ['hiline_reg_levelid', 'Hiline registreerimine (levelit)', 'koik'],
  ['leveli_min', 'Leveli pikkus (min)', 'koik'], ['pausi_min', 'Pausi pikkus (min)', 'koik']
];
function seadedVorm(s, eesliide) {
  eesliide = eesliide || 's';
  var h = '<div class="vorm" id="' + eesliide + '-vorm"><label class="v">Tüüp<select data-s="tyyp" onchange="naitaSeadeValjad(\'' + eesliide + '\')">' +
    [['rebuy', 'Rebuy'], ['reentry', 'Re-entry'], ['freezeout', 'Freezeout']].map(function (x) { return '<option value="' + x[0] + '"' + (s.tyyp === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>';
  SEADE_VALJAD.forEach(function (v) {
    h += '<label class="v" data-grupp="' + v[2] + '">' + v[1] + '<input type="number" step="any" min="0" data-s="' + v[0] + '" value="' + esc(s[v[0]] != null ? s[v[0]] : '') + '"></label>';
  });
  return h + '</div>';
}
function naitaSeadeValjad(eesliide) {
  var v = $(eesliide + '-vorm'); if (!v) return;
  var tyyp = v.querySelector('[data-s=tyyp]').value;
  v.querySelectorAll('[data-grupp]').forEach(function (l) {
    var g = l.dataset.grupp;
    l.style.display = (g === 'koik' || g === tyyp || (g === 'lisa' && tyyp !== 'freezeout')) ? '' : 'none';
  });
}
function loeSeaded(eesliide) {
  var v = $(eesliide + '-vorm'), s = {};
  v.querySelectorAll('[data-s]').forEach(function (i) { s[i.dataset.s] = i.tagName === 'SELECT' ? i.value : parseFloat(i.value) || 0; });
  if (s.tyyp !== 'rebuy') { s.rebuy_summa = 0; s.rebuy_stack = 0; }
  if (s.tyyp !== 'reentry') { s.reentry_summa = 0; s.reentry_stack = 0; }
  return s;
}
function hooajaValik(valitud, tyhiTekst) {
  return '<option value="">' + esc(tyhiTekst || 'Automaatselt kuupäeva järgi') + '</option>' + (AJUTINE.hooajad || []).map(function (h) {
    return '<option value="' + h.id + '"' + (String(valitud) === String(h.id) ? ' selected' : '') + '>' + esc(h.nimi) + (h.lopetatud ? ' (lõpetatud)' : '') + '</option>';
  }).join('');
}

async function uusTurniir() {
  var f = await formaadid(), m = await mangijad(true); await hooajad();
  var aktiivsed = f.filter(function (x) { return !x.arhiveeritud; });
  if (!aktiivsed.length) return toast('Loo enne mõni formaat', true);
  var d = new Date();
  modaal('<h3>UUS TURNIIR</h3><div class="vorm">' +
    '<label class="v">Nimi<input id="ut-nimi" value="TELJE POKKER • ' + KUUD[d.getMonth()] + ' ' + d.getFullYear() + '"></label>' +
    '<label class="v">Kuupäev<input type="date" id="ut-kp" value="' + tana() + '"></label>' +
    '<label class="v">Formaat<select id="ut-formaat" onchange="utFormaat()">' + aktiivsed.map(function (x) { return '<option value="' + x.id + '">' + esc(x.nimi) + '</option>'; }).join('') + '</select></label>' +
    '<label class="v">Hooaeg<select id="ut-hooaeg">' + hooajaValik('') + '</select></label></div>' +
    '<div class="rida" style="margin:12px 0"><label class="c"><input type="checkbox" id="ut-punktid" checked> Hooaja punktiturniir (märgi maha = sõprusmäng ilma punktideta)</label></div>' +
    '<details style="margin-bottom:12px"><summary class="hall" style="cursor:pointer;font-weight:700">Summad ja stackid (vaikimisi formaadist — muudetav)</summary><div id="ut-seaded" style="margin-top:10px"></div></details>' +
    '<h2>OSALEJAD</h2><div class="rida" style="margin-bottom:8px"><button class="vaikenupp" onclick="document.querySelectorAll(\'.ut-m\').forEach(function(c){c.checked=true})">Vali kõik</button><button class="vaikenupp" onclick="document.querySelectorAll(\'.ut-m\').forEach(function(c){c.checked=false})">Tühjenda</button><span class="hall vaike">Mängijaid saab lisada ka turniiri ajal.</span></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px">' +
    m.filter(function (x) { return !x.arhiveeritud; }).map(function (x) { return '<label class="c"><input type="checkbox" class="ut-m" value="' + x.id + '"> ' + esc(x.nimi) + '</label>'; }).join('') + '</div>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" onclick="looTurniir()">Loo turniir</button></div>', true);
  utFormaat();
}
function utFormaat() {
  var f = AJUTINE.formaadid.find(function (x) { return String(x.id) === $('ut-formaat').value; });
  $('ut-seaded').innerHTML = seadedVorm(f.seaded, 'ut'); naitaSeadeValjad('ut');
}
async function looTurniir() {
  var keha = {
    nimi: $('ut-nimi').value, kuupaev: $('ut-kp').value, formaat_id: parseInt($('ut-formaat').value, 10),
    hooaeg_id: $('ut-hooaeg').value || null, punktiturniir: $('ut-punktid').checked, seaded: loeSeaded('ut'),
    mangijad: Array.from(document.querySelectorAll('.ut-m:checked')).map(function (c) { return parseInt(c.value, 10); })
  };
  var d = await api('/turniirid', 'POST', keha);
  if (d.ok) { sulgeModaal(); toast('Turniir loodud'); location.hash = 'turniir/' + d.id; }
}

// ── TURNIIRI VAADE / JUHTPULT ────────────────────────────────────────────
async function turniirVaade(id) {
  var d = await api('/turniirid/' + id);
  if (!d.ok) { $('sisu').innerHTML = '<div class="tyhi">' + esc(d.veateade || 'Turniiri ei leitud') + '</div>'; return; }
  if (onAdmin()) { await mangijad(); await hooajad(); }
  TD = d; TD_NIHE = d.nuud - Date.now(); TD_RASI = '';
  joonistaTurniir();
  var lopp = d.turniir.staatus === 'lopetatud' || d.turniir.staatus === 'kinnitatud';
  if (!lopp) {
    POLL = setInterval(async function () {
      if (document.hidden) return;
      try {
        var u = await api('/turniirid/' + id);
        if (u.ok && TD && TD.turniir.id === u.turniir.id) { TD = u; TD_NIHE = u.nuud - Date.now(); joonistaTurniir(); }
      } catch (e) {}
    }, 2500);
    TIKK = setInterval(tiksJuht, 250);
  }
}
async function uuendaTurniir() {
  if (!TD) return;
  var u = await api('/turniirid/' + TD.turniir.id);
  if (u.ok) {
    var olnudLopp = ['lopetatud', 'kinnitatud'].indexOf(TD.turniir.staatus) >= 0;
    var nuudLopp = ['lopetatud', 'kinnitatud'].indexOf(u.turniir.staatus) >= 0;
    TD = u; TD_NIHE = u.nuud - Date.now();
    if (olnudLopp !== nuudLopp) return marsruut();
    TD_RASI = ''; joonistaTurniir();
  }
}
function joonistaTurniir() {
  var d = TD, t = d.turniir;
  // Ära joonista üle, kui midagi pole muutunud (sisestusväli jääb fookusesse) või modaal on lahti.
  // Rebuy/add-on nupud sõltuvad perioodist — joonistame uuesti ka siis, kui periood avaneb/sulgub.
  var ki = d.kell ? kellaInfoNyyd() : null;
  var rasi = JSON.stringify([t, d.osalejad, d.summad, d.kell && d.kell.kell, ki && [ki.periood.avatud, ki.addon_aeg]]);
  if (rasi === TD_RASI) return;
  if (modaalLahti() && TD_RASI) return;
  TD_RASI = rasi;
  var lopp = t.staatus === 'lopetatud' || t.staatus === 'kinnitatud';
  var s = t.seaded;
  var h = '<h1 class="leht"><a class="tagasi" href="#' + (lopp ? 'ajalugu' : 'turniir') + '">←</a><span class="kuldne">' + esc(t.nimi) + '</span></h1>' +
    '<div class="rida" style="margin:-6px 0 14px"><span class="hall">' + kp(t.kuupaev) + ' • ' + esc(t.formaadi_nimi || '') + '</span>' +
    (t.punktiturniir ? '<span class="silt kuld">' + esc(t.hooaja_nimi || 'Hooajata') + '</span>' : '<span class="silt sinine">SÕPRUSMÄNG</span>') +
    ({ ootel: '<span class="silt">TULEMAS</span>', kaib: '<span class="silt punane">● KÄIB</span>', lopetatud: '<span class="silt">LÕPETATUD — kinnitamata</span>', kinnitatud: '<span class="silt roheline">✔ KINNITATUD</span>' }[t.staatus] || '') +
    (t.ajalooline ? '<span class="silt">Käsitsi lisatud</span>' : '') + '</div>';
  if (!lopp) h += kellaKaart();
  h += summadKaart();
  if (lopp) h += tulemusteKaart();
  else h += mangijateKaart();
  if (onAdmin() && d.tegevused && d.tegevused.length && !lopp) h += tegevusteKaart();
  $('sisu').innerHTML = h;
  tiksJuht();
}
function kellaKaart() {
  var t = TD.turniir;
  var h = '<div class="kaart"><div class="juht-kell"><div><div class="lvl kuldne" id="j-lvl"></div><div class="aeg num kuldne" id="j-aeg">--:--</div>' +
    '<div class="bl num" id="j-bl"></div><div class="jarg num" id="j-ante"></div><div class="jarg num" id="j-jarg"></div><div class="jarg num" id="j-paus"></div>' +
    '<div id="j-periood" style="margin-top:8px"></div></div>' +
    '<div style="text-align:right"><a class="nupp punanupp" href="/pokker-tv" target="_blank">📺 TV</a></div></div>';
  if (onAdmin()) {
    h += '<div class="juht-nupud" id="j-nupud"></div>' +
      '<div class="rida" style="margin-top:10px">' +
      '<button onclick="muudaLevelit()">✎ Muuda blinde</button><button onclick="seadedModaal()">⚙ Seaded &amp; blindid</button>' +
      '<button onclick="votaTagasi()">↩ Võta tagasi</button><button onclick="loosiKohad()">🪑 Loosi istekohad</button>' +
      '<span class="vahe"></span><button class="punanupp" onclick="lopetaTurniir()">🏁 Lõpeta turniir</button></div>';
  }
  return h + '</div>';
}
function kellaInfoNyyd() { var t = TD.turniir; return K.info(t.seaded, t.struktuur, TD.kell.kell, Date.now() + TD_NIHE); }
function tiksJuht() {
  if (!TD || !TD.kell || !$('j-aeg')) return;
  var t = TD.turniir, info = kellaInfoNyyd(), el = info.element, paus = !!(el && el.paus), jookseb = info.kell.jookseb;
  $('j-lvl').textContent = paus ? (el.addon ? 'PAUS + ADD-ON' : 'PAUS') : 'LEVEL ' + info.level_nr;
  $('j-aeg').textContent = K.aeg(info.jaak);
  $('j-aeg').className = 'aeg num kuldne' + (jookseb ? '' : ' peatatud') + (jookseb && !paus && info.jaak <= 60000 ? ' hoiatus' : '');
  $('j-bl').textContent = paus ? 'Järgmisena ' + K.blindid(info.jargmine) : K.blindid(el);
  $('j-ante').textContent = paus ? K.ante(info.jargmine) : K.ante(el);
  $('j-jarg').textContent = !paus && info.jargmine ? 'Järgmised: ' + K.blindid(info.jargmine) + (info.jargmine.ante ? ' (' + K.ante(info.jargmine) + ')' : '') : '';
  $('j-paus').textContent = paus ? 'Pausi lõpuni ' + K.aeg(info.jaak) : (info.pausini != null ? 'Järgmise pausini ' + K.aeg(info.pausini) : '');
  var p = '';
  if (info.addon_aeg && t.seaded.addon_summa > 0) p = '<span class="periood addon">ADD-ON AEG</span>';
  else if (info.periood.tyyp) p = info.periood.avatud ? '<span class="periood avatud">' + info.periood.tyyp.toUpperCase() + ' AVATUD' + (info.periood.jaak != null ? ' • ' + K.aeg(info.periood.jaak) : '') + '</span>' : '<span class="periood suletud">' + info.periood.tyyp.toUpperCase() + ' LÕPPENUD</span>';
  $('j-periood').innerHTML = p;
  var nupud = $('j-nupud');
  if (nupud) {
    var olek = [jookseb, paus, t.staatus, info.kell.idx === 0, info.viimane].join();
    if (nupud.dataset.olek !== olek) {
      nupud.dataset.olek = olek;
      var b = [];
      if (t.staatus === 'ootel' && !jookseb) b.push('<button class="kuldnupp" onclick="kell(\'start\')">▶ KÄIVITA TURNIIR</button>');
      else if (jookseb) b.push('<button class="kuldnupp" onclick="kell(\'peata\')">⏸ PEATA</button>');
      else b.push('<button class="kuldnupp" onclick="kell(\'jatka\')">▶ JÄTKA</button>');
      b.push('<button onclick="kell(\'eelmine\')"' + (info.kell.idx === 0 ? ' disabled' : '') + '>⏮ Eelmine level</button>');
      b.push('<button onclick="kell(\'jargmine\')"' + (info.viimane ? ' disabled' : '') + '>⏭ Järgmine level</button>');
      b.push('<button onclick="kell(\'lisa\',-60)">− 1 min</button>');
      b.push('<button onclick="kell(\'lisa\',60)">+ 1 min</button>');
      b.push('<button onclick="kell(\'level_algusesse\')">↺ Level algusest</button>');
      if (paus) { b.push('<button onclick="kell(\'lisa\',300)">+ 5 min pausi</button>'); b.push('<button class="rohenupp" onclick="kell(\'lopeta_paus\')">⏭ Lõpeta paus</button>'); }
      else b.push('<button onclick="kaivitaPaus()">☕ Käivita paus</button>');
      nupud.innerHTML = b.join('');
    }
  }
}
async function kell(tegevus, sekundid, lisa) {
  var keha = Object.assign({ tegevus: tegevus, sekundid: sekundid || 0 }, lisa || {});
  var d = await api('/turniirid/' + TD.turniir.id + '/kell', 'POST', keha);
  if (d.ok) await uuendaTurniir();
}
async function kaivitaPaus() {
  modaal('<h3>KÄIVITA PAUS</h3><p class="hall" style="margin-bottom:12px">Pooleli olev level peatub ja jätkub pärast pausi sealt, kus see pooleli jäi.</p>' +
    '<label class="v">Pausi pikkus (min)<input type="number" id="pp-min" value="' + TD.turniir.seaded.pausi_min + '" min="1"></label>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="pp-ok">Käivita paus</button></div>');
  $('pp-ok').onclick = async function () { var m = parseFloat($('pp-min').value) || 10; sulgeModaal(); await kell('kaivita_paus', 0, { minutid: m }); };
}
function summadKaart() {
  var s = TD.summad, se = TD.turniir.seaded, k = [];
  k.push(['MÄNGIJAID', s.aktiivseid + ' / ' + s.mangijaid]);
  k.push(['AVG STACK', arv(s.keskmine_stack)]);
  k.push(['ŽETOONE', arv(s.zetoonid)]);
  if (se.tyyp === 'rebuy') k.push(['REBUY', s.rebuyd]);
  if (se.tyyp === 'reentry') k.push(['RE-ENTRY', s.reentryd]);
  if (se.addon_summa > 0) k.push(['ADD-ON', s.addonid]);
  k.push(['AUHINNAFOND', raha(s.auhinnafond)]);
  if (se.bounty > 0) k.push(['BOUNTY FOND', raha(s.bountyfond)]);
  var detail = 'Buy-in ' + raha(s.buyinid) + (s.rebuy_summa ? ' • Rebuy ' + raha(s.rebuy_summa) : '') + (s.reentry_summa ? ' • Re-entry ' + raha(s.reentry_summa) : '') +
    (s.addon_summa ? ' • Add-on ' + raha(s.addon_summa) : '') + (se.bounty ? ' • Bounty ' + raha(s.bountyfond) : '') + ' • Kokku kogutud ' + raha(s.kogusumma);
  return '<div class="kaart"><div class="statid">' + k.map(function (x) { return '<div class="stat"><div class="s">' + x[0] + '</div><div class="v num kuldne">' + x[1] + '</div></div>'; }).join('') +
    '</div><div class="hall vaike" style="margin-top:10px">' + detail + '</div></div>';
}
function mangijateKaart() {
  var t = TD.turniir, s = t.seaded, info = TD.kell ? kellaInfoNyyd() : null;
  var h = '<div class="kaart"><div class="rida" style="margin-bottom:10px"><h2 style="margin:0">MÄNGIJAD</h2><span class="vahe"></span>' +
    (info && t.seaded.hiline_reg_levelid ? (info.level_nr <= t.seaded.hiline_reg_levelid ? '<span class="silt roheline">Registreerimine avatud</span>' : '<span class="silt">Hiline registreerimine läbi</span>') : '') + '</div>';
  if (onAdmin()) {
    var registreeritud = {}; TD.osalejad.forEach(function (o) { registreeritud[o.mangija_id] = 1; });
    var vabad = (AJUTINE.mangijad || []).filter(function (m) { return !m.arhiveeritud && !registreeritud[m.id]; });
    h += '<div class="rida" style="margin-bottom:12px"><select id="lisa-m" style="flex:1;min-width:160px"><option value="">— vali mängija —</option>' +
      vabad.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nimi) + '</option>'; }).join('') + '</select>' +
      '<input id="lisa-uus" placeholder="…või uue mängija nimi" style="flex:1;min-width:160px"><button class="kuldnupp" onclick="registreeri()">+ Registreeri</button></div>';
  }
  if (!TD.osalejad.length) h += '<div class="tyhi">Mängijaid pole veel registreeritud.</div>';
  h += '<div class="mangijad-juht">';
  var aktiivseid = 0;
  TD.osalejad.forEach(function (o, i) {
    if (!o.valjas) aktiivseid++;
    var lisad = [];
    if (o.rebuyd) lisad.push('<span class="silt kuld">Rebuy ×' + o.rebuyd + '</span>');
    if (o.reentryd) lisad.push('<span class="silt kuld">Re-entry ×' + o.reentryd + '</span>');
    if (o.addonid) lisad.push('<span class="silt kuld">Add-on' + (o.addonid > 1 ? ' ×' + o.addonid : '') + '</span>');
    if (o.bounty_arv) lisad.push('<span class="silt roheline">🎯 ' + o.bounty_arv + (s.bounty ? ' • ' + raha(o.bounty_eur) : '') + '</span>');
    if (o.valjas && o.valja_loi_nimi) lisad.push('<span class="silt">lõi välja: ' + esc(o.valja_loi_nimi) + '</span>');
    if (onAdmin()) lisad.push('<span class="silt ' + (o.makstud ? 'roheline' : 'punane') + '" title="Kogukulu">' + raha(o.kulu) + (o.makstud ? ' ✔' : '') + '</span>');
    var nupud = '';
    if (onAdmin()) {
      if (!o.valjas) {
        var lisaAvatud = !info || info.periood.avatud;
        if (s.tyyp === 'rebuy' && lisaAvatud) nupud += '<button onclick="tegevus(' + o.id + ',\'rebuy\')">+ Rebuy</button>';
        if (s.tyyp === 'reentry' && lisaAvatud) nupud += '<button onclick="tegevus(' + o.id + ',\'reentry\')">Re-entry</button>';
        // Add-on pakutakse pausil (add-on paus) või pärast rebuy perioodi; parandusi saab teha ✎ alt.
        if (s.addon_summa > 0 && (!info || info.addon_aeg || !info.periood.avatud)) nupud += '<button onclick="tegevus(' + o.id + ',\'addon\')">+ Add-on</button>';
        nupud += '<button class="punanupp" onclick="tegevus(' + o.id + ',\'valja\')">OUT</button>';
      } else {
        if (s.tyyp === 'reentry' && info && info.periood.avatud) nupud += '<button onclick="tegevus(' + o.id + ',\'reentry\')">Re-entry</button>';
        nupud += '<button class="rohenupp" onclick="tegevus(' + o.id + ',\'taasta\')">↺ Taasta</button>';
      }
      nupud += '<button class="serv" onclick="muudaOsalejat(' + o.id + ')">✎</button>';
    }
    h += '<div class="mj' + (o.valjas ? ' out' : '') + '"><div class="nimi"><span class="hall num" style="width:24px;text-align:right">' + (i + 1) + '.</span>' +
      avatar(o.nimi, o.foto_url) + '<span class="n">' + esc(o.nimi) + '</span>' + (o.valjas ? '<span class="silt punane">OUT</span>' : '') + '</div>' +
      '<div class="lisad">' + lisad.join('') + '</div>' + (nupud ? '<div class="tegevused">' + nupud + '</div>' : '') + '</div>';
  });
  h += '</div>';
  if (onAdmin() && aktiivseid === 1 && TD.osalejad.length > 1) h += '<div class="kaart" style="margin:14px 0 0;text-align:center"><div style="font-size:18px;font-weight:900;margin-bottom:10px">🏆 Alles on üks mängija!</div><button class="kuldnupp suur" onclick="lopetaTurniir(true)">🏁 Lõpeta turniir ja koosta tulemused</button></div>';
  return h + '</div>';
}
function tegevusteKaart() {
  var nimed = {}; TD.osalejad.forEach(function (o) { nimed[o.id] = o.nimi; });
  var tekst = { rebuy: 'Rebuy', reentry: 'Re-entry', addon: 'Add-on', valja: 'OUT', taasta: 'Taastatud', registreeri: 'Registreeritud' };
  return '<div class="kaart tume"><h2>VIIMASED TEGEVUSED</h2><table>' + TD.tegevused.slice(0, 8).map(function (g) {
    var a = g.andmed || {};
    return '<tr style="' + (g.tagasi ? 'opacity:.4;text-decoration:line-through' : '') + '"><td class="hall num" style="width:60px">' + new Date(g.aeg).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' }) + '</td>' +
      '<td><b>' + esc(tekst[g.tyyp] || g.tyyp) + '</b> — ' + esc(nimed[a.osaleja] || '?') + (a.loi ? ' <span class="hall">(lõi ' + esc(nimed[a.loi] || '?') + ')</span>' : '') + '</td></tr>';
  }).join('') + '</table></div>';
}
async function registreeri() {
  var mid = $('lisa-m').value, uus = $('lisa-uus').value.trim();
  if (!mid && !uus) return toast('Vali mängija või kirjuta nimi', true);
  var d = await api('/turniirid/' + TD.turniir.id + '/osalejad', 'POST', mid ? { mangija_id: parseInt(mid, 10) } : { uus_nimi: uus });
  if (d.ok) { if (uus) await mangijad(true); toast('Registreeritud'); await uuendaTurniir(); }
}
async function tegevus(oid, tyyp, loi) {
  var t = TD.turniir, s = t.seaded, o = TD.osalejad.find(function (x) { return x.id === oid; });
  var info = kellaInfoNyyd();
  if ((tyyp === 'rebuy' || tyyp === 'reentry') && info.periood.tyyp && !info.periood.avatud && loi === undefined) {
    if (!(await kinnita(info.periood.tyyp.toUpperCase() + ' periood on läbi. Kas ikka lisad ' + o.nimi + ' ' + tyyp + '-i?', 'Lisa ikkagi'))) return;
  }
  // Väljalangemisel ja re-entry puhul küsime, kes välja lõi (bounty)
  if ((tyyp === 'valja' || (tyyp === 'reentry' && s.bounty > 0)) && loi === undefined) {
    var teised = TD.osalejad.filter(function (x) { return !x.valjas && x.id !== oid; });
    modaal('<h3>' + (tyyp === 'valja' ? 'OUT: ' : 'RE-ENTRY: ') + esc(o.nimi) + '</h3><p class="hall" style="margin-bottom:12px">Kes lõi välja?' + (s.bounty ? ' (saab bounty ' + raha(s.bounty) + ')' : '') + '</p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">' +
      teised.map(function (x) { return '<button class="suur" onclick="sulgeModaal();tegevus(' + oid + ',\'' + tyyp + '\',' + x.id + ')">' + esc(x.nimi) + '</button>'; }).join('') + '</div>' +
      '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" onclick="sulgeModaal();tegevus(' + oid + ',\'' + tyyp + '\',0)">' + (tyyp === 'valja' ? 'OUT ilma märketa' : 'Re-entry ilma märketa') + '</button></div>');
    return;
  }
  var d = await api('/osalejad/' + oid + '/tegevus', 'POST', { tyyp: tyyp, loi: loi || null });
  if (d.ok) {
    toast({ rebuy: 'Rebuy lisatud', reentry: 'Re-entry lisatud', addon: 'Add-on lisatud', valja: o.nimi + ' OUT', taasta: o.nimi + ' taastatud' }[tyyp]);
    await uuendaTurniir();
  }
}
async function votaTagasi() {
  if (!(await kinnita('Võtta viimane tegevus tagasi?', 'Võta tagasi'))) return;
  var d = await api('/turniirid/' + TD.turniir.id + '/tagasi', 'POST', {});
  if (d.ok) { toast('Tagasi võetud: ' + (d.kirjeldus || 'tegevus')); await uuendaTurniir(); }
}
function muudaOsalejat(oid) {
  var o = TD.osalejad.find(function (x) { return x.id === oid; });
  var v = function (k, silt, samm) { return '<label class="v">' + silt + '<input type="number" min="0" step="' + (samm || 1) + '" id="mo-' + k + '" value="' + o[k] + '"></label>'; };
  modaal('<h3>' + esc(o.nimi) + '</h3><div class="vorm">' + v('rebuyd', 'Rebuy\'d') + v('reentryd', 'Re-entry\'d') + v('addonid', 'Add-on\'id') +
    v('bounty_arv', 'Bounty\'d (tk)') + v('bounty_eur', 'Bounty €', 'any') + v('auhind', 'Auhind €', 'any') + '</div>' +
    '<div style="margin-top:12px"><label class="c"><input type="checkbox" id="mo-makstud"' + (o.makstud ? ' checked' : '') + '> Makstud (' + raha(o.kulu) + ')</label></div>' +
    '<div class="modaal-nupud"><button class="punanupp" onclick="eemaldaOsaleja(' + oid + ')">Eemalda turniirilt</button><span class="vahe"></span><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" onclick="salvestaOsaleja(' + oid + ')">Salvesta</button></div>');
}
async function salvestaOsaleja(oid) {
  var keha = {};
  ['rebuyd', 'reentryd', 'addonid', 'bounty_arv', 'bounty_eur', 'auhind'].forEach(function (k) { keha[k] = parseFloat($('mo-' + k).value) || 0; });
  keha.makstud = $('mo-makstud').checked;
  var d = await api('/osalejad/' + oid, 'PUT', keha);
  if (d.ok) { sulgeModaal(); toast('Salvestatud'); await uuendaTurniir(); }
}
async function eemaldaOsaleja(oid) {
  var o = TD.osalejad.find(function (x) { return x.id === oid; });
  if (!(await kinnita('Eemaldada ' + o.nimi + ' turniirilt? (ekslik registreerimine)', 'Eemalda', true))) return;
  var d = await api('/osalejad/' + oid, 'DELETE');
  if (d.ok) { toast('Eemaldatud'); await uuendaTurniir(); }
}
function muudaLevelit() {
  var info = kellaInfoNyyd(), el = info.element, idx = info.kell.idx;
  if (!el || el.paus) return toast('Pausi ajal muuda pausi pikkust nupuga "+5 min" või Seadetes', true);
  modaal('<h3>MUUDA LEVEL ' + info.level_nr + ' BLINDE</h3><div class="vorm">' +
    '<label class="v">Small blind<input type="number" id="ml-sb" value="' + el.sb + '" oninput="$(\'ml-bb\').value=(parseFloat(this.value)||0)*2"></label><label class="v">Big blind<input type="number" id="ml-bb" value="' + el.bb + '"></label>' +
    '<label class="v">Ante<input type="number" id="ml-ante" value="' + (el.ante || 0) + '"></label><label class="v">Pikkus (min)<input type="number" step="any" id="ml-min" value="' + el.min + '"></label></div>' +
    '<div style="margin-top:12px"><label class="c"><input type="checkbox" id="ml-bba"' + (el.bba ? ' checked' : '') + '> Big blind ante</label></div>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="ml-ok">Salvesta</button></div>');
  $('ml-ok').onclick = async function () {
    var d = await api('/turniirid/' + TD.turniir.id + '/level/' + idx, 'PUT', { sb: +$('ml-sb').value, bb: +$('ml-bb').value, ante: +$('ml-ante').value, min: +$('ml-min').value, bba: $('ml-bba').checked });
    if (d.ok) { sulgeModaal(); toast('Blindid muudetud'); await uuendaTurniir(); }
  };
}
function seadedModaal() {
  var t = TD.turniir;
  REDAKTOR.st = JSON.parse(JSON.stringify(t.struktuur));
  REDAKTOR.praegune = TD.kell ? TD.kell.kell.idx : -1;
  modaal('<h3>TURNIIRI SEADED JA BLINDID</h3><div class="vorm">' +
    '<label class="v">Nimi<input id="ts-nimi" value="' + esc(t.nimi) + '"></label><label class="v">Kuupäev<input type="date" id="ts-kp" value="' + t.kuupaev + '"></label>' +
    '<label class="v">Hooaeg<select id="ts-hooaeg">' + hooajaValik(t.hooaeg_id) + '</select></label></div>' +
    '<div style="margin:12px 0"><label class="c"><input type="checkbox" id="ts-punktid"' + (t.punktiturniir ? ' checked' : '') + '> Hooaja punktiturniir</label></div>' +
    seadedVorm(t.seaded, 'ts') + '<h2 style="margin-top:18px">BLINDIDE STRUKTUUR</h2><div id="redaktor"></div>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" onclick="salvestaTurniiriSeaded()">Salvesta</button></div>', true);
  naitaSeadeValjad('ts'); joonistaRedaktor();
}
async function salvestaTurniiriSeaded() {
  var d = await api('/turniirid/' + TD.turniir.id, 'PUT', {
    nimi: $('ts-nimi').value, kuupaev: $('ts-kp').value, hooaeg_id: $('ts-hooaeg').value || null, punktiturniir: $('ts-punktid').checked,
    seaded: loeSeaded('ts'), struktuur: REDAKTOR.st
  });
  if (d.ok) { sulgeModaal(); toast('Salvestatud'); await uuendaTurniir(); }
}
function loosiKohad() {
  var aktiivsed = TD.osalejad.filter(function (o) { return !o.valjas; });
  var vaike = Math.max(1, Math.ceil(aktiivsed.length / 9));
  modaal('<h3>🪑 LOOSI ISTEKOHAD</h3><div class="rida"><label class="v" style="width:140px">Laudu<input type="number" id="lk-lauad" min="1" value="' + vaike + '"></label>' +
    '<button class="kuldnupp" style="align-self:flex-end" onclick="loosi()">🎲 Loosi</button></div><div id="lk-tulemus" style="margin-top:14px"></div>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Sulge</button></div>');
  loosi();
}
function loosi() {
  var a = TD.osalejad.filter(function (o) { return !o.valjas; }).map(function (o) { return o.nimi; });
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
  var n = Math.max(1, parseInt($('lk-lauad').value, 10) || 1), lauad = [];
  for (i = 0; i < n; i++) lauad.push([]);
  a.forEach(function (nimi, i) { lauad[i % n].push(nimi); });
  $('lk-tulemus').innerHTML = '<div class="ruudustik">' + lauad.map(function (l, i) {
    return '<div class="kaart tume"><h2>LAUD ' + (i + 1) + '</h2>' + l.map(function (nimi, k) { return '<div style="padding:4px 0"><b class="kuldne num">' + (k + 1) + '.</b> ' + esc(nimi) + '</div>'; }).join('') + '</div>';
  }).join('') + '</div>';
}
async function lopetaTurniir(vaikne) {
  var aktiivseid = TD.osalejad.filter(function (o) { return !o.valjas; }).length;
  var tekst = aktiivseid > 1 ? 'Mängus on veel ' + aktiivseid + ' mängijat. Kas lõpetad turniiri? (Nende kohad saad tulemustes ise paika panna)' : 'Lõpetada turniir ja koostada lõppjärjestus?';
  if (!(await kinnita(tekst, 'Lõpeta turniir'))) return;
  var d = await api('/turniirid/' + TD.turniir.id + '/lopeta', 'POST', {});
  if (d.ok) { toast('Turniir lõpetatud'); marsruut(); }
}
function tulemusteKaart() {
  var t = TD.turniir, s = t.seaded, adm = onAdmin();
  var os = TD.osalejad.slice().sort(function (a, b) { return (a.koht || 999) - (b.koht || 999); });
  var h = '<div class="kaart"><div class="rida" style="margin-bottom:10px"><h2 style="margin:0">LÕPPJÄRJESTUS</h2><span class="vahe"></span>';
  if (adm) {
    h += '<button onclick="jaotaAuhinnad()">💰 Jaota auhinnafond</button>';
    if (t.staatus === 'lopetatud') h += '<button class="kuldnupp" onclick="kinnitaTulemused()">✔ Kinnita tulemused</button>';
  }
  h += '</div><div class="tabelikast"><table><tr><th>Koht</th><th>Mängija</th>' + (t.punktiturniir ? '<th class="r">Punktid</th>' : '') +
    (s.tyyp === 'rebuy' ? '<th class="c">Rebuy</th>' : '') + (s.tyyp === 'reentry' ? '<th class="c">Re-entry</th>' : '') + (s.addon_summa ? '<th class="c">Add-on</th>' : '') +
    (s.bounty ? '<th class="c">Bounty</th>' : '') + '<th class="r">Kulu</th><th class="r">Auhind</th>' + (adm ? '<th class="c">Makstud</th>' : '') + '</tr>';
  os.forEach(function (o) {
    h += '<tr><td>' + (adm ? '<input type="number" min="1" value="' + (o.koht || '') + '" style="width:64px" onchange="paranda(' + o.id + ',\'koht\',this.value)">' : kohaMark(o.koht)) + '</td>' +
      '<td><a class="mangija-nimi" style="text-decoration:none;color:inherit" href="#mangija/' + o.mangija_id + '">' + avatar(o.nimi, o.foto_url) + esc(o.nimi) + '</a>' +
      (o.valja_loi_nimi ? '<div class="hall vaike">välja lõi ' + esc(o.valja_loi_nimi) + '</div>' : '') + '</td>' +
      (t.punktiturniir ? '<td class="r num"><b class="kuldne">' + o.punktid + '</b></td>' : '') +
      (s.tyyp === 'rebuy' ? '<td class="c num">' + (o.rebuyd || '') + '</td>' : '') + (s.tyyp === 'reentry' ? '<td class="c num">' + (o.reentryd || '') + '</td>' : '') +
      (s.addon_summa ? '<td class="c num">' + (o.addonid || '') + '</td>' : '') +
      (s.bounty ? '<td class="c num">' + (o.bounty_arv ? o.bounty_arv + ' • ' + raha(o.bounty_eur) : '') + '</td>' : '') +
      '<td class="r num hall">' + raha(o.kulu) + '</td>' +
      '<td class="r">' + (adm ? '<input type="number" min="0" step="any" value="' + (o.auhind || '') + '" style="width:90px;text-align:right" onchange="paranda(' + o.id + ',\'auhind\',this.value)">' : (o.auhind ? '<b>' + raha(o.auhind) + '</b>' : '')) + '</td>' +
      (adm ? '<td class="c"><input type="checkbox"' + (o.makstud ? ' checked' : '') + ' onchange="paranda(' + o.id + ',\'makstud\',this.checked)"></td>' : '') + '</tr>';
  });
  h += '</table></div>';
  if (adm) h += '<div class="rida" style="margin-top:14px"><button onclick="muudaOsalejaid()">✎ Paranda rebuy/bounty jm</button><button onclick="seadedModaal()">⚙ Seaded</button>' +
    (t.ajalooline ? '' : '<button onclick="taasava()">↺ Ava turniir uuesti</button>') + '<span class="vahe"></span><button class="punanupp" onclick="kustutaTurniir()">Kustuta turniir</button></div>';
  return h + '</div>';
}
function muudaOsalejaid() {
  modaal('<h3>VALI MÄNGIJA</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">' +
    TD.osalejad.map(function (o) { return '<button onclick="muudaOsalejat(' + o.id + ')">' + esc(o.nimi) + '</button>'; }).join('') + '</div><div class="modaal-nupud"><button onclick="sulgeModaal()">Sulge</button></div>');
}
async function paranda(oid, voti, vaartus) {
  var keha = {}; keha[voti] = vaartus;
  var d = await api('/osalejad/' + oid, 'PUT', keha);
  if (d.ok) { toast('Salvestatud'); await uuendaTurniir(); }
}
async function jaotaAuhinnad() {
  var s = await api('/seaded').catch(function () { return null; });
  var jaotus = (s && s.seaded && s.seaded.auhinnajaotus) || [50, 30, 20];
  modaal('<h3>💰 JAOTA AUHINNAFOND ' + raha(TD.summad.auhinnafond) + '</h3><label class="v">Protsendid kohtade kaupa (komaga eraldatud)<input id="ja-p" value="' + jaotus.join(', ') + '"></label>' +
    '<p class="hall vaike" style="margin-top:8px">Summad ümardatakse täiseurodeni, jääk läheb võitjale. Iga summat saab hiljem tabelis käsitsi muuta. Bounty raha ei ole auhinnafondis.</p>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="ja-ok">Jaota</button></div>');
  $('ja-ok').onclick = async function () {
    var p = $('ja-p').value.split(/[,;\s]+/).map(parseFloat).filter(function (x) { return x > 0; });
    var d = await api('/turniirid/' + TD.turniir.id + '/jaota-auhinnad', 'POST', { jaotus: p });
    if (d.ok) { sulgeModaal(); toast('Auhinnad jaotatud'); await uuendaTurniir(); }
  };
}
async function kinnitaTulemused() {
  if (!(await kinnita('Kinnitada tulemused? Punktid lähevad hooaja arvestusse (hiljem saab veel parandada).', 'Kinnita'))) return;
  var d = await api('/turniirid/' + TD.turniir.id + '/kinnita', 'POST', {});
  if (d.ok) { toast('Tulemused kinnitatud'); await uuendaTurniir(); }
}
async function taasava() {
  if (!(await kinnita('Avada turniir uuesti? Kohad ja punktid nullitakse, kell jätkab sealt, kus jäi.', 'Ava uuesti'))) return;
  var d = await api('/turniirid/' + TD.turniir.id + '/taasava', 'POST', {});
  if (d.ok) { location.hash = 'turniir/' + TD.turniir.id; marsruut(); }
}
async function kustutaTurniir() {
  if (!(await kinnita('Kustutada turniir "' + TD.turniir.nimi + '" jäädavalt koos tulemustega?', 'Kustuta', true))) return;
  var d = await api('/turniirid/' + TD.turniir.id, 'DELETE');
  if (d.ok) { toast('Kustutatud'); location.hash = 'ajalugu'; }
}

// ── BLINDIDE STRUKTUURI REDAKTOR ─────────────────────────────────────────
var REDAKTOR = { st: [], praegune: -1 };
function joonistaRedaktor() {
  var st = REDAKTOR.st, lvl = 0;
  var h = '<div class="tabelikast"><table class="struktuur"><tr><th>#</th><th>SB</th><th>BB</th><th>Ante</th><th class="c">BB ante</th><th>Min</th><th></th></tr>';
  st.forEach(function (el, i) {
    var cls = (el.paus ? 'paus' : '') + (i === REDAKTOR.praegune ? ' praegune' : '');
    var nupud = '<td style="white-space:nowrap"><button class="vaikenupp" onclick="rLiiguta(' + i + ',-1)">↑</button><button class="vaikenupp" onclick="rLiiguta(' + i + ',1)">↓</button><button class="vaikenupp punanupp" onclick="rKustuta(' + i + ')">✕</button></td>';
    if (el.paus) {
      h += '<tr class="' + cls + '"><td><b class="kuldne">PAUS</b></td><td colspan="3"><label class="c"><input type="checkbox" ' + (el.addon ? 'checked' : '') + ' onchange="rMuuda(' + i + ',\'addon\',this.checked)"> Add-on</label></td><td></td>' +
        '<td><input type="number" step="any" id="r-min-' + i + '" value="' + el.min + '" oninput="rMin(' + i + ',this)"></td>' + nupud + '</tr>';
    } else {
      if (!el.jatk) lvl++;
      h += '<tr class="' + cls + '"><td class="num"><b>' + (el.jatk ? lvl + '↪' : lvl) + '</b></td>' +
        // SB sisestamisel täidetakse BB automaatselt (2 × SB); Enter viib järgmise leveli SB lahtrisse.
        '<td><input type="number" class="r-sb" value="' + (el.sb || 0) + '" oninput="rSb(' + i + ',this)" onkeydown="rEnter(event,this)"></td>' +
        '<td><input type="number" id="r-bb-' + i + '" value="' + (el.bb || 0) + '" oninput="rMuuda(' + i + ',\'bb\',this.value)"></td>' +
        '<td><input type="number" value="' + (el.ante || 0) + '" oninput="rMuuda(' + i + ',\'ante\',this.value)"></td>' +
        '<td class="c"><input type="checkbox" ' + (el.bba ? 'checked' : '') + ' onchange="rMuuda(' + i + ',\'bba\',this.checked)"></td>' +
        '<td><input type="number" step="any" id="r-min-' + i + '" value="' + el.min + '" oninput="rMin(' + i + ',this)"></td>' + nupud + '</tr>';
    }
  });
  h += '</table></div><div class="rida" style="margin-top:10px"><button onclick="rLisa(false)">+ Level</button><button onclick="rLisa(true)">+ Paus</button>' +
    '<span class="hall vaike">SB kirjutamisel täitub BB automaatselt (2 × SB). Leveli minutite muutmisel saavad sama pikkuse ka kõik järgmised levelid (pausid mitte). Enter viib järgmise leveli SB lahtrisse.</span></div>';
  $('redaktor').innerHTML = h;
}
function rSb(i, input) {
  var sb = parseFloat(input.value) || 0;
  REDAKTOR.st[i].sb = sb;
  REDAKTOR.st[i].bb = sb * 2;
  var bb = $('r-bb-' + i); if (bb) bb.value = sb * 2;
}
// Leveli pikkuse muutmisel saavad sama pikkuse ka kõik järgmised levelid (pausid jäävad oma pikkusega).
function rMin(i, input) {
  var min = parseFloat(input.value);
  if (!(min > 0)) return;
  var st = REDAKTOR.st;
  for (var j = i; j < st.length; j++) {
    if (st[j].paus) continue;
    st[j].min = min;
    var el = $('r-min-' + j); if (el && j !== i) el.value = min;
  }
}
function rEnter(e, input) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var koik = Array.from(document.querySelectorAll('#redaktor .r-sb'));
  var j = koik.indexOf(input);
  if (j >= 0 && j < koik.length - 1) { koik[j + 1].focus(); koik[j + 1].select(); }
}
function rMuuda(i, k, v) { REDAKTOR.st[i][k] = typeof v === 'boolean' ? v : parseFloat(v) || 0; if (k === 'sb' || k === 'bb' || k === 'ante') return; joonistaRedaktor(); }
function rLiiguta(i, suund) {
  var j = i + suund, st = REDAKTOR.st; if (j < 0 || j >= st.length) return;
  var x = st[i]; st[i] = st[j]; st[j] = x; joonistaRedaktor();
}
function rKustuta(i) { REDAKTOR.st.splice(i, 1); joonistaRedaktor(); }
function rLisa(paus) {
  var st = REDAKTOR.st;
  var seaded = $('ts-vorm') ? loeSeaded('ts') : ($('fs-vorm') ? loeSeaded('fs') : { leveli_min: 20, pausi_min: 10 });
  if (paus) st.push({ paus: true, addon: false, min: seaded.pausi_min || 10 });
  else {
    var viimane = null; for (var i = st.length - 1; i >= 0; i--) if (!st[i].paus) { viimane = st[i]; break; }
    var sb = viimane ? Math.round(viimane.sb * 1.5 / 100) * 100 || viimane.sb * 2 : 25;
    var bb = viimane ? sb * 2 : 50;
    st.push({ sb: sb, bb: bb, ante: 0, bba: false, min: (viimane && viimane.min) || seaded.leveli_min || 20 });
  }
  joonistaRedaktor();
}

// ── EDETABEL ─────────────────────────────────────────────────────────────
var EDETABEL_VAADE = 'tabel';
async function edetabelLeht(hooaegId) {
  var hh = await hooajad(true);
  var d = await api('/edetabel' + (hooaegId ? '?hooaeg_id=' + hooaegId : ''));
  if (!d.hooaeg) { $('sisu').innerHTML = '<h1 class="leht kuldne">EDETABEL</h1><div class="kaart tyhi">Hooaegu pole veel loodud.</div>'; return; }
  var h = '<h1 class="leht kuldne">EDETABEL</h1><div class="rida" style="margin-bottom:14px"><select style="max-width:260px" onchange="location.hash=\'edetabel/\'+this.value">' +
    hh.map(function (x) { return '<option value="' + x.id + '"' + (x.id === d.hooaeg.id ? ' selected' : '') + '>' + esc(x.nimi) + '</option>'; }).join('') + '</select>' +
    '<button class="' + (EDETABEL_VAADE === 'tabel' ? 'kuldnupp' : '') + '" onclick="EDETABEL_VAADE=\'tabel\';marsruut()">Tabel</button>' +
    '<button class="' + (EDETABEL_VAADE === 'kuu' ? 'kuldnupp' : '') + '" onclick="EDETABEL_VAADE=\'kuu\';marsruut()">Kuuvaade</button>' +
    '<span class="vahe"></span><button onclick="laeAlla(\'/eksport/excel?hooaeg_id=' + d.hooaeg.id + '\',\'telje-pokker-edetabel.xlsx\')">📥 Excel</button></div>' +
    '<div class="hall vaike" style="margin:-6px 0 12px">' + kp(d.hooaeg.algus) + ' – ' + kp(d.hooaeg.lopp) + ' • ' + d.turniirid.length + ' punktiturniiri' + (d.hooaeg.lopetatud ? ' • LÕPETATUD' : '') + '</div>';
  if (!d.read.length) h += '<div class="kaart tyhi">Selles hooajas pole veel punkte.</div>';
  else if (EDETABEL_VAADE === 'kuu') h += kuuvaade(d);
  else {
    var onKor = d.read.some(function (r) { return r.korrektsioon; });
    h += '<div class="kaart"><div class="tabelikast"><table><tr><th>Koht</th><th>Mängija</th><th class="r">Punktid</th><th class="c">Turniire</th><th class="c">Võite</th><th class="c">TOP 3</th><th class="c peida-mob">Kesk. koht</th>' +
      '<th class="c peida-mob">Rebuy</th><th class="c peida-mob">Re-entry</th><th class="c peida-mob">Add-on</th><th class="r peida-mob">Bounty</th></tr>' +
      d.read.map(function (r) {
        return '<tr class="klikk" onclick="location.hash=\'mangija/' + r.mangija_id + '\'"><td>' + kohaMark(r.koht) + '</td><td><div class="mangija-nimi">' + avatar(r.nimi, r.foto_url) + esc(r.nimi) + '</div></td>' +
          '<td class="r num"><b class="kuldne" style="font-size:17px">' + r.punktid + '</b>' + (r.korrektsioon ? '<span class="hall">*</span>' : '') + '</td><td class="c num">' + r.turniire + '</td><td class="c num">' + (r.voite || '') + '</td><td class="c num">' + (r.top3 || '') + '</td>' +
          '<td class="c num peida-mob">' + (r.keskmine_koht || '—') + '</td><td class="c num peida-mob">' + (r.rebuyd || '') + '</td><td class="c num peida-mob">' + (r.reentryd || '') + '</td>' +
          '<td class="c num peida-mob">' + (r.addonid || '') + '</td><td class="r num peida-mob">' + (r.bounty_eur ? raha(r.bounty_eur) : '') + '</td></tr>';
      }).join('') + '</table></div>' + (onKor ? '<div class="hall vaike" style="margin-top:10px">* sisaldab varasemaid (Excelist üle toodud või käsitsi lisatud) punkte — vt Hooajad.</div>' : '') + '</div>';
  }
  $('sisu').innerHTML = h;
}
function kuuvaade(d) {
  var onKor = d.read.some(function (r) { return r.korrektsioon; });
  var h = '<div class="kaart"><div class="tabelikast"><table class="kuuvaade"><tr><th>#</th><th>Mängija</th>' + (onKor ? '<th class="kp">Varasem</th>' : '') +
    d.turniirid.map(function (t) { return '<th class="kp" title="' + esc(t.nimi) + '">' + kp(t.kuupaev).slice(0, 5) + '</th>'; }).join('') + '<th class="r">Kokku</th></tr>';
  d.read.forEach(function (r) {
    h += '<tr><td class="num">' + r.koht + '.</td><td style="white-space:nowrap;font-weight:700">' + esc(r.nimi) + '</td>' + (onKor ? '<td class="p">' + (r.korrektsioon || '') + '</td>' : '') +
      d.turniirid.map(function (t) {
        var x = r.tulemused[t.id];
        return '<td class="p num' + (x && x.koht === 1 ? ' v' : '') + (x ? '' : ' t') + '" title="' + (x ? x.koht + '. koht' : '') + '">' + (x ? x.punktid : '·') + '</td>';
      }).join('') + '<td class="r num"><b class="kuldne">' + r.punktid + '</b></td></tr>';
  });
  return h + '</table></div><div class="hall vaike" style="margin-top:10px">Kuldsega on märgitud turniiri võit. Iga veerg on üks turniir (kuupäev).</div></div>';
}

// ── MÄNGIJAD ─────────────────────────────────────────────────────────────
var NAITA_ARHIIV = false;
async function mangijadLeht() {
  var m = await mangijad(true);
  var h = '<h1 class="leht kuldne">MÄNGIJAD</h1><div class="rida" style="margin-bottom:14px">' + (onAdmin() ? '<button class="kuldnupp" onclick="lisaMangija()">+ Lisa mängija</button>' : '') +
    '<label class="c"><input type="checkbox" ' + (NAITA_ARHIIV ? 'checked' : '') + ' onchange="NAITA_ARHIIV=this.checked;marsruut()"> Näita arhiveerituid</label></div><div class="mangijakaardid">';
  m.filter(function (x) { return NAITA_ARHIIV || !x.arhiveeritud; }).forEach(function (x) {
    h += '<div class="mk' + (x.arhiveeritud ? ' arhiiv' : '') + '" onclick="location.hash=\'mangija/' + x.id + '\'">' + avatar(x.nimi, x.foto_url) + '<div class="n">' + esc(x.nimi) + '</div>' +
      '<div class="hall vaike">' + x.turniire + ' turniiri' + (x.voite ? ' • 🏆 ' + x.voite : '') + '</div></div>';
  });
  $('sisu').innerHTML = h + '</div>';
}
function lisaMangija() {
  modaal('<h3>UUS MÄNGIJA</h3><label class="v">Nimi<input id="um-nimi" placeholder="Ees- ja perekonnanimi"></label><div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="um-ok">Lisa</button></div>');
  $('um-nimi').focus();
  $('um-ok').onclick = async function () {
    var d = await api('/mangijad', 'POST', { nimi: $('um-nimi').value });
    if (d.ok) { sulgeModaal(); toast('Mängija lisatud'); AJUTINE.mangijad = null; marsruut(); }
  };
}
async function mangijaLeht(id) {
  var d = await api('/mangijad/' + id);
  if (!d.ok) { $('sisu').innerHTML = '<div class="tyhi">Mängijat ei leitud</div>'; return; }
  var m = d.mangija, k = d.kokku, p = d.praegune;
  var h = '<h1 class="leht"><a class="tagasi" href="#mangijad">←</a></h1><div class="kaart"><div class="rida" style="gap:18px">' + avatar(m.nimi, m.foto_url, 'suur') +
    '<div class="vahe"><div style="font-size:26px;font-weight:900" class="kuldne">' + esc(m.nimi) + '</div>' +
    (p ? '<div class="hall">' + esc(p.nimi) + ': <b style="color:var(--tekst)">' + p.punktid + ' punkti</b>' + (p.koht ? ' • ' + p.koht + '. koht edetabelis' : '') + '</div>' : '') +
    (m.arhiveeritud ? '<span class="silt">ARHIVEERITUD</span>' : '') + '</div>';
  if (onAdmin()) h += '<div class="rida"><button onclick="muudaMangijat(' + m.id + ')">✎ Muuda</button><label class="nupp">📷 Pilt<input type="file" accept="image/*" style="display:none" onchange="laeFoto(' + m.id + ',this)"></label></div>';
  h += '</div></div>';
  var st = [
    ['HOOAJA PUNKTID', p ? p.punktid : 0], ['KOHT EDETABELIS', p && p.koht ? p.koht + '.' : '—'], ['KÕIGI AEGADE PUNKTID', k.punktid],
    ['TURNIIRE', k.turniire], ['VÕITE', k.voite], ['2. KOHTI', k.teisi], ['3. KOHTI', k.kolmandaid], ['TOP 3', k.top3],
    ['KESKMINE KOHT', k.keskmine_koht || '—'], ['PARIM TULEMUS', k.parim ? k.parim + '.' : '—'],
    ['REBUY\'D', k.rebuyd], ['RE-ENTRY\'D', k.reentryd], ['ADD-ON\'ID', k.addonid], ['BOUNTY\'D', raha(k.bounty_eur)], ['VÄLJA LÖÖDUD', k.valja_loodud]
  ];
  h += '<div class="kaart"><div class="statid">' + st.map(function (x) { return '<div class="stat"><div class="s">' + x[0] + '</div><div class="v num kuldne">' + x[1] + '</div></div>'; }).join('') + '</div></div>';
  h += '<div class="ruudustik">';
  h += '<div class="kaart"><h2>HOOAEGADE KAUPA</h2><div class="tabelikast"><table><tr><th>Hooaeg</th><th class="c">Koht</th><th class="r">Punktid</th><th class="c">Turn.</th><th class="c">Võite</th><th class="c">Kesk.</th></tr>' +
    d.hooajad.map(function (x) {
      return '<tr class="klikk" onclick="' + (x.hooaeg_id ? 'location.hash=\'edetabel/' + x.hooaeg_id + '\'' : '') + '"><td>' + esc(x.nimi) + '</td><td class="c">' + (x.koht ? kohaMark(x.koht) : '—') + '</td><td class="r num"><b>' + x.punktid + '</b>' + (x.korrektsioon ? '<span class="hall">*</span>' : '') + '</td><td class="c num">' + x.turniire + '</td><td class="c num">' + (x.voite || '') + '</td><td class="c num">' + (x.keskmine_koht || '—') + '</td></tr>';
    }).join('') + '</table></div></div>';
  h += '<div class="kaart"><h2>MÄNGUFORMAATIDE KAUPA</h2><div class="tabelikast"><table><tr><th>Formaat</th><th class="c">Turn.</th><th class="c">Võite</th><th class="c">TOP 3</th><th class="c">Kesk.</th><th class="r">Punktid</th></tr>' +
    d.formaadid.map(function (x) { return '<tr><td>' + esc(x.formaat) + '</td><td class="c num">' + x.turniire + '</td><td class="c num">' + (x.voite || '') + '</td><td class="c num">' + (x.top3 || '') + '</td><td class="c num">' + (x.keskmine_koht || '—') + '</td><td class="r num">' + x.punktid + '</td></tr>'; }).join('') +
    '</table></div>' + (d.formaadid.length ? '' : '<div class="tyhi">Andmeid pole</div>') + '</div></div>';
  h += '<div class="kaart"><h2>TURNIIRIDE TULEMUSED</h2>' + (d.tulemused.length ? '<div class="tabelikast"><table><tr><th>Kuupäev</th><th>Turniir</th><th class="c">Koht</th><th class="r">Punktid</th><th class="c peida-mob">R / RE / A</th><th class="r peida-mob">Bounty</th></tr>' +
    d.tulemused.map(function (x) {
      return '<tr class="klikk" onclick="location.hash=\'ajalugu/' + x.turniir_id + '\'"><td class="num">' + kp(x.kuupaev) + '</td><td>' + esc(x.turniir) + '<div class="hall vaike">' + esc(x.formaat) + (x.punktiturniir ? '' : ' • sõprusmäng') + '</div></td>' +
        '<td class="c">' + kohaMark(x.koht) + '<div class="hall vaike">/ ' + x.osalejaid + '</div></td><td class="r num"><b>' + (x.punktiturniir ? x.punktid : '—') + '</b></td>' +
        '<td class="c num peida-mob">' + x.rebuyd + ' / ' + x.reentryd + ' / ' + x.addonid + '</td><td class="r num peida-mob">' + (x.bounty_eur ? raha(x.bounty_eur) : '') + '</td></tr>';
    }).join('') + '</table></div>' : '<div class="tyhi">Turniire pole veel mängitud.</div>') + '</div>';
  $('sisu').innerHTML = h;
}
function muudaMangijat(id) {
  var m = (AJUTINE.mangijad || []).find(function (x) { return x.id === id; }) || {};
  api('/mangijad/' + id).then(function (d) {
    var mm = d.mangija;
    modaal('<h3>MUUDA MÄNGIJAT</h3><label class="v">Nimi<input id="mm-nimi" value="' + esc(mm.nimi) + '"></label>' +
      '<div style="margin-top:12px"><label class="c"><input type="checkbox" id="mm-arhiiv"' + (mm.arhiveeritud ? ' checked' : '') + '> Arhiveeritud (ei kuvata uue turniiri nimekirjas, tulemused säilivad)</label></div>' +
      (mm.foto_url ? '<div style="margin-top:12px"><button class="punanupp vaikenupp" id="mm-foto-x">Eemalda pilt</button></div>' : '') +
      '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="mm-ok">Salvesta</button></div>');
    $('mm-ok').onclick = async function () {
      var r = await api('/mangijad/' + id, 'PUT', { nimi: $('mm-nimi').value, arhiveeritud: $('mm-arhiiv').checked });
      if (r.ok) { sulgeModaal(); toast('Salvestatud'); AJUTINE.mangijad = null; marsruut(); }
    };
    if ($('mm-foto-x')) $('mm-foto-x').onclick = async function () { var r = await api('/mangijad/' + id + '/foto', 'DELETE'); if (r.ok) { sulgeModaal(); marsruut(); } };
  });
}
async function laeFoto(id, input) {
  if (!input.files || !input.files[0]) return;
  var fd = new FormData(); fd.append('foto', input.files[0]);
  toast('Laen pilti üles…');
  var r = await fetch('/api/pokker/mangijad/' + id + '/foto', { method: 'POST', headers: { 'x-session-token': TOKEN }, body: fd });
  var d = await r.json();
  if (d.ok) { toast('Pilt salvestatud'); AJUTINE.mangijad = null; marsruut(); } else toast(d.veateade || 'Pildi üleslaadimine ebaõnnestus', true);
}

// ── STATISTIKA ───────────────────────────────────────────────────────────
async function statistikaLeht() {
  var d = await api('/statistika'), k = d.kokku;
  var h = '<h1 class="leht kuldne">STATISTIKA</h1><div class="kaart"><div class="statid">' + [
    ['AASTAID', k.aastaid], ['TURNIIRE', k.turniire], ['OSAVÕTTE', k.osavotte], ['KESKMISELT MÄNGIJAID', k.keskmiselt],
    ['AUHINNAFONDID KOKKU', raha(k.koguFond)], ['SUURIM FOND', k.suurimFond ? raha(k.suurimFond.summa) : '—']
  ].map(function (x) { return '<div class="stat"><div class="s">' + x[0] + '</div><div class="v num kuldne">' + x[1] + '</div></div>'; }).join('') + '</div>' +
    (k.esimene ? '<div class="hall vaike" style="margin-top:10px">Rakenduses on tulemusi alates ' + kp(k.esimene) + '. TELJE POKKER asutati 2015.</div>' : '') + '</div>';
  // Kuulsuste hall
  h += '<div class="kaart"><h2>🏆 KUULSUSTE HALL</h2>' + (d.hall.length ? '<div class="ruudustik">' + d.hall.map(function (x) {
    return '<div class="kaart tume" style="margin:0"><div style="font-weight:900;margin-bottom:8px">' + esc(x.nimi) + (x.lopetatud ? '' : ' <span class="silt kuld">KÄIB</span>') + '</div>' +
      (x.top3.length ? x.top3.map(function (r, i) { return '<div class="mangija-nimi" style="padding:4px 0">' + kohaMark(i + 1) + avatar(r.nimi, r.foto_url) + esc(r.nimi) + '<span class="vahe"></span><span class="num hall">' + r.punktid + ' p</span></div>'; }).join('') : '<div class="hall">—</div>') + '</div>';
  }).join('') + '</div>' : '<div class="tyhi">Hooaegu pole</div>') + '</div>';
  // Rekordid
  var rek = d.rekordid, rr = [['Kõige rohkem võite', rek.voite, 'voite', ''], ['Kõige rohkem turniire', rek.turniire, 'turniire', ''], ['Kõige rohkem bounty\'sid', rek.bounty, 'bounty_arv', ''],
    ['Rebuy kuningas', rek.rebuyd, 'rebuyd', ''], ['Re-entry kuningas', rek.reentryd, 'reentryd', '']];
  h += '<div class="ruudustik"><div class="kaart"><h2>REKORDID</h2><table>' + rr.filter(function (x) { return x[1] && x[1][x[2]]; }).map(function (x) {
    return '<tr class="klikk" onclick="location.hash=\'mangija/' + x[1].mangija_id + '\'"><td class="hall">' + x[0] + '</td><td><b>' + esc(x[1].nimi) + '</b></td><td class="r num kuldne"><b>' + x[1][x[2]] + '</b></td></tr>';
  }).join('') + '</table>' + (k.suurimFond ? '<div class="hall vaike" style="margin-top:10px">Suurim auhinnafond: ' + raha(k.suurimFond.summa) + ' — ' + esc(k.suurimFond.nimi) + ' (' + kp(k.suurimFond.kuupaev) + ')</div>' : '') + '</div>';
  h += '<div class="kaart"><h2>FORMAADID</h2><table><tr><th>Formaat</th><th class="c">Turniire</th><th class="c">Kesk. mängijaid</th><th class="r">Fondid kokku</th></tr>' +
    d.formaadid.map(function (f) { return '<tr><td>' + esc(f.formaat) + '</td><td class="c num">' + f.turniire + '</td><td class="c num">' + f.keskmiselt + '</td><td class="r num">' + raha(f.fond) + '</td></tr>'; }).join('') + '</table></div></div>';
  // Kõikide aegade edetabel
  h += '<div class="kaart"><h2>KÕIKIDE AEGADE EDETABEL</h2><div class="tabelikast"><table><tr><th>#</th><th>Mängija</th><th class="r">Punktid</th><th class="c">Turniire</th><th class="c">Võite</th><th class="c">TOP 3</th><th class="c peida-mob">Kesk. koht</th><th class="r peida-mob">Bounty</th></tr>' +
    d.koik_ajad.map(function (r) {
      return '<tr class="klikk" onclick="location.hash=\'mangija/' + r.mangija_id + '\'"><td>' + kohaMark(r.koht) + '</td><td><div class="mangija-nimi">' + avatar(r.nimi, r.foto_url) + esc(r.nimi) + '</div></td><td class="r num"><b class="kuldne">' + r.punktid + '</b></td>' +
        '<td class="c num">' + r.turniire + '</td><td class="c num">' + (r.voite || '') + '</td><td class="c num">' + (r.top3 || '') + '</td><td class="c num peida-mob">' + (r.keskmine_koht || '—') + '</td><td class="r num peida-mob">' + (r.bounty_eur ? raha(r.bounty_eur) : '') + '</td></tr>';
    }).join('') + '</table></div></div>';
  $('sisu').innerHTML = h;
}

// ── AJALUGU ──────────────────────────────────────────────────────────────
var AJ_FILTER = { hooaeg: '', formaat: '' };
async function ajaluguLeht() {
  var hh = await hooajad(true), ff = await formaadid(true);
  var q = '?staatus=lopetatud' + (AJ_FILTER.hooaeg ? '&hooaeg_id=' + AJ_FILTER.hooaeg : '') + (AJ_FILTER.formaat ? '&formaat=' + encodeURIComponent(AJ_FILTER.formaat) : '');
  var d = await api('/turniirid' + q);
  var formaadiNimed = {}; ff.forEach(function (f) { formaadiNimed[f.nimi] = 1; }); d.turniirid.forEach(function (t) { if (t.formaadi_nimi) formaadiNimed[t.formaadi_nimi] = 1; });
  var h = '<h1 class="leht kuldne">AJALUGU</h1><div class="rida" style="margin-bottom:14px">' +
    '<select style="max-width:220px" onchange="AJ_FILTER.hooaeg=this.value;marsruut()">' + hooajaValik(AJ_FILTER.hooaeg, 'Kõik hooajad') + '</select>' +
    '<select style="max-width:220px" onchange="AJ_FILTER.formaat=this.value;marsruut()"><option value="">Kõik formaadid</option>' + Object.keys(formaadiNimed).map(function (f) { return '<option' + (AJ_FILTER.formaat === f ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select>' +
    '<span class="vahe"></span>' + (onAdmin() ? '<button class="kuldnupp" onclick="ajaloolineTurniir()">+ Lisa varasem turniir</button>' : '') + '</div>';
  if (!d.turniirid.length) h += '<div class="kaart tyhi">Lõpetatud turniire pole.</div>';
  else h += '<div class="kaart"><div class="tabelikast"><table><tr><th>Kuupäev</th><th>Turniir</th><th class="peida-mob">Hooaeg</th><th class="c">Mängijaid</th><th>Võitja</th><th class="r peida-mob">Auhinnafond</th></tr>' +
    d.turniirid.map(function (t) {
      return '<tr class="klikk" onclick="location.hash=\'ajalugu/' + t.id + '\'"><td class="num">' + kp(t.kuupaev) + '</td><td><b>' + esc(t.nimi) + '</b><div class="hall vaike">' + esc(t.formaadi_nimi || '') +
        (t.punktiturniir ? '' : ' • <span style="color:var(--sinine)">sõprusmäng</span>') + (t.staatus === 'lopetatud' ? ' • <span style="color:#ff9c94">kinnitamata</span>' : '') + '</div></td>' +
        '<td class="peida-mob hall">' + esc(t.hooaja_nimi || '—') + '</td><td class="c num">' + t.osalejaid + '</td><td>' + (t.voitja ? '🏆 ' + esc(t.voitja) : '—') + '</td><td class="r num peida-mob">' + raha(t.auhinnafond) + '</td></tr>';
    }).join('') + '</table></div></div>';
  $('sisu').innerHTML = h;
}
async function ajaloolineTurniir() {
  var ff = await formaadid(), hh = await hooajad();
  modaal('<h3>LISA VARASEM TURNIIR</h3><div class="vorm">' +
    '<label class="v">Nimi<input id="at-nimi" value="TELJE POKKER"></label><label class="v">Kuupäev<input type="date" id="at-kp"></label>' +
    '<label class="v">Formaat<select id="at-formaat"><option value="">— muu / teadmata —</option>' + ff.map(function (f) { return '<option value="' + f.id + '">' + esc(f.nimi) + '</option>'; }).join('') + '</select></label>' +
    '<label class="v">Hooaeg<select id="at-hooaeg">' + hooajaValik('') + '</select></label></div>' +
    '<div style="margin:12px 0"><label class="c"><input type="checkbox" id="at-punktid" checked> Punktiturniir (jagab hooaja punkte)</label></div>' +
    '<label class="v">Tulemused — üks mängija rea kohta, võitja esimesena. Võib kleepida ka Excelist.<textarea id="at-read" rows="10" oninput="atEelvaade()" placeholder="Liis Rogov\nGerli Rüüberg\nAndrus Aavik\n…\n\nVõi täpsemalt (semikooloniga):\nkoht; nimi; rebuy; re-entry; add-on; bounty arv; auhind €"></textarea></label>' +
    '<div id="at-eelvaade" class="hall vaike" style="margin-top:8px"></div>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" onclick="salvestaAjalooline()">Salvesta turniir</button></div>', true);
}
function atLoe() {
  var read = $('at-read').value.split('\n').map(function (r) { return r.trim(); }).filter(Boolean);
  return read.map(function (r, i) {
    var o = r.split(/\t|;/).map(function (x) { return x.trim(); });
    var koht = i + 1;
    if (/^\d+\.?$/.test(o[0]) && o.length > 1) { koht = parseInt(o[0], 10); o.shift(); }
    else { var m = o[0].match(/^(\d+)[.)]\s+(.+)$/); if (m) { koht = parseInt(m[1], 10); o[0] = m[2]; } }
    return { koht: koht, nimi: o[0], rebuyd: +o[1] || 0, reentryd: +o[2] || 0, addonid: +o[3] || 0, bounty_arv: +o[4] || 0, auhind: parseFloat(String(o[5] || '').replace(',', '.')) || 0 };
  }).filter(function (x) { return x.nimi; });
}
function atEelvaade() {
  var r = atLoe(), olemas = {}; (AJUTINE.mangijad || []).forEach(function (m) { olemas[m.nimi.toLowerCase()] = 1; });
  $('at-eelvaade').innerHTML = r.length ? r.length + ' mängijat: ' + r.map(function (x) { return x.koht + '. ' + esc(x.nimi) + (olemas[x.nimi.toLowerCase()] ? '' : ' <span style="color:var(--kuld2)">(uus)</span>'); }).join(', ') : '';
}
async function salvestaAjalooline() {
  var read = atLoe();
  if (!$('at-kp').value) return toast('Vali kuupäev', true);
  if (!read.length) return toast('Lisa tulemused', true);
  var d = await api('/turniirid/ajalooline', 'POST', { nimi: $('at-nimi').value, kuupaev: $('at-kp').value, formaat_id: $('at-formaat').value || null,
    hooaeg_id: $('at-hooaeg').value || null, punktiturniir: $('at-punktid').checked, osalejad: read });
  if (d.ok) { sulgeModaal(); toast('Turniir lisatud'); AJUTINE.mangijad = null; location.hash = 'ajalugu/' + d.id; }
}

// ── HOOAJAD ──────────────────────────────────────────────────────────────
async function hooajadLeht() {
  var hh = await hooajad(true); await mangijad();
  var h = '<h1 class="leht kuldne">HOOAJAD</h1>' + (onAdmin() ? '<div style="margin-bottom:14px"><button class="kuldnupp" onclick="muudaHooaega()">+ Uus hooaeg</button></div>' : '');
  if (!hh.length) h += '<div class="kaart tyhi">Hooaegu pole.</div>';
  hh.forEach(function (x) {
    h += '<div class="kaart"><div class="rida"><div class="vahe"><div style="font-size:19px;font-weight:900">' + esc(x.nimi) + '</div><div class="hall">' + kp(x.algus) + ' – ' + kp(x.lopp) + ' • ' + x.turniire + ' turniiri</div></div>' +
      (x.lopetatud ? '<span class="silt">LÕPETATUD</span>' : '<span class="silt roheline">AKTIIVNE</span>') +
      '<a class="nupp" href="#edetabel/' + x.id + '">Edetabel</a>' + (onAdmin() ? '<button onclick="muudaHooaega(' + x.id + ')">✎ Muuda</button>' : '') + '</div>' +
      '<div class="hall vaike" style="margin-top:8px">Punktid: ' + x.punktid.map(function (p, i) { return (i + 1) + '.→' + p; }).join(' • ') + ' (edasi ' + x.punktid[x.punktid.length - 1] + ')</div>';
    if (x.korrektsioonid.length || onAdmin()) {
      h += '<details style="margin-top:10px"' + (onAdmin() && x.korrektsioonid.length ? '' : '') + '><summary style="cursor:pointer;font-weight:700" class="hall">Varasemad / käsitsi lisatud punktid (' + x.korrektsioonid.length + ')</summary>' +
        '<div class="tabelikast" style="margin-top:8px"><table><tr><th>Mängija</th><th class="r">Punktid</th><th class="c">Turniire</th><th class="c">Võite</th><th>Märkus</th>' + (onAdmin() ? '<th></th>' : '') + '</tr>' +
        x.korrektsioonid.map(function (k) {
          return '<tr><td>' + esc(k.nimi) + '</td><td class="r num"><b>' + k.punktid + '</b></td><td class="c num">' + (k.turniire || '') + '</td><td class="c num">' + (k.voite || '') + '</td><td class="hall vaike">' + esc(k.markus || '') + '</td>' +
            (onAdmin() ? '<td style="white-space:nowrap"><button class="vaikenupp" onclick=\'muudaKorrektsiooni(' + JSON.stringify(k).replace(/'/g, '&#39;') + ')\'>✎</button><button class="vaikenupp punanupp" onclick="kustutaKorrektsioon(' + k.id + ')">✕</button></td>' : '') + '</tr>';
        }).join('') + '</table></div>' + (onAdmin() ? '<button class="vaikenupp" style="margin-top:8px" onclick="muudaKorrektsiooni({hooaeg_id:' + x.id + '})">+ Lisa punkte käsitsi</button>' : '') + '</details>';
    }
    h += '</div>';
  });
  $('sisu').innerHTML = h;
}
function muudaHooaega(id) {
  var x = id ? AJUTINE.hooajad.find(function (h) { return h.id === id; }) : { nimi: 'Hooaeg ' + new Date().getFullYear(), algus: new Date().getFullYear() + '-01-01', lopp: new Date().getFullYear() + '-12-31', punktid: [10, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1], lopetatud: false };
  modaal('<h3>' + (id ? 'MUUDA HOOAEGA' : 'UUS HOOAEG') + '</h3><div class="vorm"><label class="v">Nimi<input id="ho-nimi" value="' + esc(x.nimi) + '"></label>' +
    '<label class="v">Algus<input type="date" id="ho-algus" value="' + x.algus + '"></label><label class="v">Lõpp<input type="date" id="ho-lopp" value="' + x.lopp + '"></label></div>' +
    '<label class="v" style="margin-top:12px">Punktisüsteem (1. koht, 2. koht, …; viimane väärtus kehtib ka kõigile järgmistele kohtadele)<input id="ho-punktid" value="' + x.punktid.join(', ') + '"></label>' +
    (id ? '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px"><label class="c"><input type="checkbox" id="ho-umber"> Arvuta selle hooaja turniiride punktid uue süsteemi järgi ümber</label>' +
      '<label class="c"><input type="checkbox" id="ho-lopetatud"' + (x.lopetatud ? ' checked' : '') + '> Hooaeg on lõpetatud</label></div>' : '') +
    '<div class="modaal-nupud">' + (id ? '<button class="punanupp" onclick="kustutaHooaeg(' + id + ')">Kustuta</button><span class="vahe"></span>' : '') + '<button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="ho-ok">Salvesta</button></div>');
  $('ho-ok').onclick = async function () {
    var keha = { nimi: $('ho-nimi').value, algus: $('ho-algus').value, lopp: $('ho-lopp').value, punktid: $('ho-punktid').value.split(/[,;\s]+/).filter(Boolean).map(parseFloat) };
    if (id) { keha.arvuta_umber = $('ho-umber').checked; keha.lopetatud = $('ho-lopetatud').checked; }
    var d = await api('/hooajad' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', keha);
    if (d.ok) { sulgeModaal(); toast('Salvestatud'); marsruut(); }
  };
}
async function kustutaHooaeg(id) {
  if (!(await kinnita('Kustutada hooaeg?', 'Kustuta', true))) return;
  var d = await api('/hooajad/' + id, 'DELETE'); if (d.ok) { toast('Kustutatud'); marsruut(); }
}
function muudaKorrektsiooni(k) {
  modaal('<h3>' + (k.id ? 'MUUDA PUNKTE' : 'LISA PUNKTE KÄSITSI') + '</h3><div class="vorm">' +
    (k.id ? '<label class="v">Mängija<input disabled value="' + esc(k.nimi) + '"></label>' : '<label class="v">Mängija<select id="ko-m">' + AJUTINE.mangijad.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nimi) + '</option>'; }).join('') + '</select></label>') +
    '<label class="v">Punktid<input type="number" step="any" id="ko-p" value="' + (k.punktid || 0) + '"></label><label class="v">Turniire<input type="number" id="ko-t" value="' + (k.turniire || 0) + '"></label>' +
    '<label class="v">Võite<input type="number" id="ko-v" value="' + (k.voite || 0) + '"></label></div><label class="v" style="margin-top:12px">Märkus<input id="ko-markus" value="' + esc(k.markus || '') + '"></label>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="ko-ok">Salvesta</button></div>');
  $('ko-ok').onclick = async function () {
    var keha = { punktid: +$('ko-p').value, turniire: +$('ko-t').value, voite: +$('ko-v').value, markus: $('ko-markus').value };
    var d = k.id ? await api('/korrektsioonid/' + k.id, 'PUT', keha) : await api('/hooajad/' + k.hooaeg_id + '/korrektsioon', 'POST', Object.assign(keha, { mangija_id: +$('ko-m').value }));
    if (d.ok) { sulgeModaal(); toast('Salvestatud'); marsruut(); }
  };
}
async function kustutaKorrektsioon(id) {
  if (!(await kinnita('Kustutada see punktirida?', 'Kustuta', true))) return;
  var d = await api('/korrektsioonid/' + id, 'DELETE'); if (d.ok) marsruut();
}

// ── FORMAADID ────────────────────────────────────────────────────────────
async function formaadidLeht() {
  var ff = await formaadid(true);
  var tyypNimi = { rebuy: 'Rebuy', reentry: 'Re-entry', freezeout: 'Freezeout' };
  var h = '<h1 class="leht kuldne">FORMAADID</h1>' + (onAdmin() ? '<div style="margin-bottom:14px"><button class="kuldnupp" onclick="muudaFormaati()">+ Uus formaat</button></div>' : '') + '<div class="ruudustik">';
  ff.forEach(function (f) {
    var s = f.seaded, levelid = f.struktuur.filter(function (x) { return !x.paus; }).length, pausid = f.struktuur.length - levelid;
    var read = [['Tüüp', tyypNimi[s.tyyp]], ['Buy-in', raha(s.buyin) + (s.bounty ? ' + ' + raha(s.bounty) + ' bounty' : '')], ['Algstack', arv(s.algstack)]];
    if (s.tyyp === 'rebuy') read.push(['Rebuy', raha(s.rebuy_summa) + ' → ' + arv(s.rebuy_stack)]);
    if (s.tyyp === 'reentry') read.push(['Re-entry', raha(s.reentry_summa) + (s.bounty ? ' + ' + raha(s.bounty) : '') + ' → ' + arv(s.reentry_stack)]);
    if (s.tyyp !== 'freezeout') read.push(['Periood', 'esimesed ' + s.lisaperiood_levelid + ' levelit']);
    read.push(['Add-on', s.addon_summa ? raha(s.addon_summa) + ' → ' + arv(s.addon_stack) : 'puudub']);
    read.push(['Levelid', levelid + ' × ' + s.leveli_min + ' min, ' + pausid + ' paus(i)']);
    h += '<div class="kaart' + (f.arhiveeritud ? ' tume' : '') + '" style="' + (f.arhiveeritud ? 'opacity:.55' : '') + '"><div style="font-size:19px;font-weight:900" class="kuldne">' + esc(f.nimi) + '</div>' +
      '<table style="margin-top:8px">' + read.map(function (r) { return '<tr><td class="hall">' + r[0] + '</td><td class="r"><b>' + r[1] + '</b></td></tr>'; }).join('') + '</table>' +
      '<div class="rida" style="margin-top:12px"><button onclick="vaataStruktuuri(' + f.id + ')">Blindid</button>' +
      (onAdmin() ? '<button onclick="muudaFormaati(' + f.id + ')">✎ Muuda</button><button onclick="kopeeriFormaat(' + f.id + ')">⧉ Kopeeri</button>' : '') + '</div></div>';
  });
  $('sisu').innerHTML = h + '</div>';
}
function vaataStruktuuri(id) {
  var f = AJUTINE.formaadid.find(function (x) { return x.id === id; }), lvl = 0;
  modaal('<h3>' + esc(f.nimi) + ' — BLINDID</h3><table><tr><th>Level</th><th>Blinds</th><th>Ante</th><th class="r">Min</th></tr>' + f.struktuur.map(function (el) {
    if (el.paus) return '<tr style="background:rgba(212,175,55,.06)"><td colspan="3"><b class="kuldne">PAUS' + (el.addon ? ' + ADD-ON' : '') + '</b></td><td class="r num">' + el.min + '</td></tr>';
    if (!el.jatk) lvl++;
    return '<tr><td class="num">' + lvl + '</td><td class="num"><b>' + K.blindid(el) + '</b></td><td class="num hall">' + (K.ante(el) || '') + '</td><td class="r num">' + el.min + '</td></tr>';
  }).join('') + '</table><div class="modaal-nupud"><button onclick="sulgeModaal()">Sulge</button></div>');
}
function muudaFormaati(id) {
  var f = id ? AJUTINE.formaadid.find(function (x) { return x.id === id; }) : { nimi: '', seaded: { tyyp: 'freezeout', buyin: 20, bounty: 0, algstack: 10000, addon_summa: 0, addon_stack: 0, lisaperiood_levelid: 0, hiline_reg_levelid: 4, leveli_min: 20, pausi_min: 10 }, struktuur: [{ sb: 25, bb: 50, ante: 0, bba: false, min: 20 }] };
  REDAKTOR.st = JSON.parse(JSON.stringify(f.struktuur)); REDAKTOR.praegune = -1;
  modaal('<h3>' + (id ? 'MUUDA FORMAATI' : 'UUS FORMAAT') + '</h3><label class="v">Nimi<input id="fs-nimi" value="' + esc(f.nimi) + '"></label><div style="margin-top:12px">' + seadedVorm(f.seaded, 'fs') + '</div>' +
    (id ? '<div style="margin-top:12px"><label class="c"><input type="checkbox" id="fs-arhiiv"' + (f.arhiveeritud ? ' checked' : '') + '> Arhiveeritud (ei pakuta uue turniiri loomisel)</label></div>' : '') +
    '<h2 style="margin-top:18px">BLINDIDE STRUKTUUR</h2><div id="redaktor"></div>' +
    '<p class="hall vaike" style="margin-top:8px">Muudatus mõjub järgmistele turniiridele. Juba loodud turniiridel on oma koopia (muuda neid turniiri juhtpuldist).</p>' +
    '<div class="modaal-nupud"><button onclick="sulgeModaal()">Tühista</button><button class="kuldnupp" id="fs-ok">Salvesta</button></div>', true);
  naitaSeadeValjad('fs'); joonistaRedaktor();
  $('fs-ok').onclick = async function () {
    var keha = { nimi: $('fs-nimi').value, seaded: loeSeaded('fs'), struktuur: REDAKTOR.st, arhiveeritud: id ? $('fs-arhiiv').checked : false };
    var d = await api('/formaadid' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', keha);
    if (d.ok) { sulgeModaal(); toast('Formaat salvestatud'); AJUTINE.formaadid = null; marsruut(); }
  };
}
async function kopeeriFormaat(id) {
  var d = await api('/formaadid/' + id + '/kopeeri', 'POST', {});
  if (d.ok) { toast('Koopia loodud'); AJUTINE.formaadid = null; await formaadid(true); muudaFormaati(d.id); }
}

// ── SEADISTUSED ──────────────────────────────────────────────────────────
async function seadedLeht() {
  var d = await api('/seaded'), s = d.seaded;
  var tvLink = location.origin + '/pokker-tv?voti=' + s.tv_voti;
  var h = '<h1 class="leht kuldne">SEADISTUSED</h1>';
  if (!s.klubi_pin || !s.admin_pin) h += '<div class="kaart" style="border-color:var(--kuld)"><b class="kuldne">Alusta siit:</b> määra klubi-PIN (sõbrad näevad tulemusi) ja admin-PIN (turniiri juhtimine). Royal Paigalduse admin pääseb alati ligi.</div>';
  h += '<div class="ruudustik"><div class="kaart"><h2>LIGIPÄÄS</h2><div class="vorm">' +
    '<label class="v">Klubi-PIN (mängijad, vaatamine)<input id="se-klubi" value="' + esc(s.klubi_pin) + '" maxlength="20"></label>' +
    '<label class="v">Admin-PIN (turniiri juhtimine)<input id="se-admin" value="' + esc(s.admin_pin) + '" maxlength="20"></label></div>' +
    '<p class="hall vaike" style="margin-top:8px">PIN-i muutmine logib selle rolliga seadmed välja. 3 vale katset → 15 min lukk.</p></div>';
  h += '<div class="kaart"><h2>📺 TV-LINK</h2><p class="hall vaike" style="margin-bottom:10px">Ava see link teleri brauseris — PIN-i pole vaja. Näitab ainult käimasolevat turniiri.</p>' +
    '<input readonly value="' + esc(tvLink) + '" onclick="this.select()"><div class="rida" style="margin-top:10px"><button onclick="navigator.clipboard.writeText(\'' + tvLink + '\').then(function(){toast(\'Kopeeritud\')})">Kopeeri</button>' +
    '<a class="nupp" href="' + esc(tvLink) + '" target="_blank">Ava</a><button class="punanupp" onclick="uusTvVoti()">Loo uus link</button></div></div></div>';
  h += '<div class="ruudustik"><div class="kaart"><h2>PUNKTID JA AUHINNAD</h2>' +
    '<label class="v">Vaikimisi punktisüsteem uutele hooaegadele<input id="se-punktid" value="' + s.punktid.join(', ') + '"></label>' +
    '<label class="v" style="margin-top:12px">Auhinnafondi jaotus % (1., 2., 3. koht …)<input id="se-jaotus" value="' + s.auhinnajaotus.join(', ') + '"></label>' +
    '<div style="margin-top:12px"><label class="c"><input type="checkbox" id="se-helid"' + (s.helid ? ' checked' : '') + '> Helisignaalid TV-vaates</label></div></div>';
  h += '<div class="kaart"><h2>ANDMED</h2><div class="rida"><button onclick="laeAlla(\'/eksport/excel\',\'telje-pokker.xlsx\')">📥 Ekspordi Excelisse</button>' +
    '<button onclick="laeAlla(\'/eksport/varukoopia\',\'telje-pokker-varukoopia.json\')">💾 Varukoopia (JSON)</button></div>' +
    '<p class="hall vaike" style="margin-top:10px">Varasemaid tulemusi saab lisada AJALUGU → "Lisa varasem turniir" (nimekirja saab kleepida otse Excelist). Hooaja kogupunkte saab lisada HOOAJAD lehel.</p></div></div>';
  h += '<div class="rida"><button class="kuldnupp suur" onclick="salvestaSeaded()">Salvesta seaded</button></div>';
  $('sisu').innerHTML = h;
}
async function salvestaSeaded() {
  var arvud = function (id) { return $(id).value.split(/[,;\s]+/).filter(Boolean).map(parseFloat).filter(function (x) { return !isNaN(x); }); };
  var d = await api('/seaded', 'PUT', { klubi_pin: $('se-klubi').value, admin_pin: $('se-admin').value, punktid: arvud('se-punktid'), auhinnajaotus: arvud('se-jaotus'), helid: $('se-helid').checked });
  if (d.ok) toast('Seaded salvestatud');
}
async function uusTvVoti() {
  if (!(await kinnita('Luua uus TV-link? Vana link lakkab töötamast.', 'Loo uus'))) return;
  var d = await api('/seaded/uus-tv-voti', 'POST', {}); if (d.ok) { toast('Uus link loodud'); marsruut(); }
}

alusta();
