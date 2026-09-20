// Märkmed — admini isiklikud kiired mõtted ja kokkulepped.
// Eraldi failis, sest admin.html on liiga suur, et sinna turvaliselt koodi kleepida.
(function () {
  var mkList = [];

  function mkUuendaBadge() {
    var badge = document.getElementById('mk-badge');
    if (!badge) return;
    var lahtiseid = mkList.filter(function (m) { return !m.tehtud; }).length;
    badge.style.display = lahtiseid ? 'block' : 'none';
    badge.textContent = lahtiseid;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function mkLaadi() {
    var div = document.getElementById('mk-nimekiri');
    div.innerHTML = '<div style="padding:20px;text-align:center;color:var(--hall);font-size:13px">Laadimine...</div>';
    var r = await api('/api/markmed');
    mkList = (r && r.ok && Array.isArray(r.markmed)) ? r.markmed : [];
    mkUuendaBadge();
    if (!mkList.length) {
      div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall);font-size:13px">Märkmeid pole veel. Kirjuta esimene ülalt.</div>';
      return;
    }
    div.innerHTML = mkList.map(function (m, i) {
      var d = new Date(m.uuendatud);
      var kp = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
        + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      var muudetud = new Date(m.loodud).getTime() !== d.getTime();
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:12px 24px;border-bottom:0.5px solid var(--piir3)' + (m.tehtud ? ';opacity:0.5' : '') + '">'
        + '<input type="checkbox" ' + (m.tehtud ? 'checked' : '') + ' onchange="mkTehtud(' + m.id + ', this.checked)" style="width:auto;margin-top:3px;flex-shrink:0">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:13px;color:var(--tekst);white-space:pre-wrap' + (m.tehtud ? ';text-decoration:line-through' : '') + '">' + esc(m.tekst) + '</div>'
        + '<div style="font-size:11px;color:var(--hall);margin-top:4px">' + kp + (muudetud ? ' · muudetud' : '') + '</div>'
        + '</div>'
        + '<button class="av-tegevus-ikoon" title="Muuda" onclick="mkMuuda(' + i + ')">✏️</button>'
        + '<button class="av-tegevus-ikoon kustuta" title="Kustuta" onclick="mkKustuta(' + m.id + ')">🗑</button>'
        + '</div>';
    }).join('');
  }

  window.mkAvaPaneel = function () {
    document.getElementById('mkModal').classList.add('avatud');
    document.getElementById('mk-uus-tekst').value = '';
    mkLaadi();
  };

  window.mkSuljePaneel = function () {
    document.getElementById('mkModal').classList.remove('avatud');
  };

  window.mkLisa = async function () {
    var el = document.getElementById('mk-uus-tekst');
    var tekst = el.value.trim();
    if (!tekst) return;
    var r = await api('/api/markmed', { method: 'POST', body: JSON.stringify({ tekst: tekst }) });
    if (!r || !r.ok) { alert((r && r.veateade) || 'Salvestamine ebaõnnestus'); return; }
    el.value = '';
    await mkLaadi();
  };

  window.mkMuuda = async function (i) {
    var m = mkList[i];
    if (!m) return;
    var uus = prompt('Muuda märget:', m.tekst);
    if (uus === null || !uus.trim() || uus.trim() === m.tekst) return;
    var r = await api('/api/markmed/' + m.id, { method: 'PUT', body: JSON.stringify({ tekst: uus.trim() }) });
    if (!r || !r.ok) { alert((r && r.veateade) || 'Salvestamine ebaõnnestus'); return; }
    await mkLaadi();
  };

  window.mkTehtud = async function (id, tehtud) {
    await api('/api/markmed/' + id + '/tehtud', { method: 'PUT', body: JSON.stringify({ tehtud: tehtud }) });
    await mkLaadi();
  };

  window.mkKustuta = async function (id) {
    if (!confirm('Kustutad selle märkme jäädavalt?')) return;
    await api('/api/markmed/' + id, { method: 'DELETE' });
    await mkLaadi();
  };

  function seadista() {
    var nupp = document.createElement('button');
    nupp.type = 'button';
    nupp.className = 'topbar-ikoon-nupp';
    nupp.title = 'Märkmed';
    nupp.onclick = window.mkAvaPaneel;
    nupp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>'
      + '<span id="mk-badge" style="display:none;position:absolute;top:2px;right:2px;background:var(--kuld);color:#0d0f13;font-size:9px;font-weight:800;border-radius:8px;padding:1px 5px;min-width:14px;text-align:center">0</span>';
    var kelluke = document.getElementById('kk-kelluke');
    if (kelluke && kelluke.parentNode) kelluke.parentNode.insertBefore(nupp, kelluke);

    var modal = document.createElement('div');
    modal.className = 'tootaja-modal-overlay';
    modal.id = 'mkModal';
    modal.innerHTML = '<div class="tootaja-modal-sisu" style="max-width:600px">'
      + '<div class="tm-hdr"><span>📝 Märkmed</span><span class="tm-sulge" onclick="mkSuljePaneel()">✕</span></div>'
      + '<div style="padding:16px 24px;border-bottom:0.5px solid var(--piir2)">'
      + '<textarea id="mk-uus-tekst" rows="2" placeholder="Kirjuta mõte või kokkulepe..." style="resize:vertical"></textarea>'
      + '<button class="nupp kull" style="margin-top:8px" onclick="mkLisa()">+ Lisa märge</button>'
      + '</div>'
      + '<div id="mk-nimekiri" style="padding:8px 0;max-height:60vh;overflow-y:auto"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === this) window.mkSuljePaneel(); });

    api('/api/markmed').then(function (r) {
      mkList = (r && r.ok && Array.isArray(r.markmed)) ? r.markmed : [];
      mkUuendaBadge();
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seadista);
  else seadista();
})();
