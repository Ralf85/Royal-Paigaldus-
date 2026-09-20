// Märkmed — admini isiklikud mõtted ja kokkulepped. Pealkiri + sisu, sisu saab hiljem täiendada.
(function () {
  var mkList = [];
  var mkAvatudId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mkUuendaBadge() {
    var badge = document.getElementById('mk-badge');
    if (!badge) return;
    var lahtiseid = mkList.filter(function (m) { return !m.tehtud; }).length;
    badge.style.display = lahtiseid ? 'block' : 'none';
    badge.textContent = lahtiseid;
  }

  function kpTekst(m) {
    var d = new Date(m.uuendatud);
    var kp = String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
      + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return kp + (new Date(m.loodud).getTime() !== d.getTime() ? ' · muudetud' : '');
  }

  async function mkLaadi() {
    var r = await api('/api/markmed');
    mkList = (r && r.ok && Array.isArray(r.markmed)) ? r.markmed : [];
    mkUuendaBadge();
    mkJoonista();
  }

  function mkJoonista() {
    var div = document.getElementById('mk-sisu');
    if (!div) return;

    // Muutmisvaade: pealkiri + sisu ühes vormis, et saaks rahulikult täiendada.
    if (mkAvatudId !== null) {
      var m = mkList.find(function (x) { return x.id === mkAvatudId; }) || { pealkiri: '', tekst: '' };
      div.innerHTML = '<div style="padding:16px 24px">'
        + '<input type="text" id="mk-e-pealkiri" placeholder="Pealkiri" value="' + esc(m.pealkiri || '') + '" style="font-size:15px;font-weight:600;margin-bottom:10px">'
        + '<textarea id="mk-e-tekst" rows="10" placeholder="Sisu..." style="resize:vertical">' + esc(m.tekst || '') + '</textarea>'
        + '<div style="display:flex;gap:8px;margin-top:12px">'
        + '<button class="nupp kull" onclick="mkSalvesta()">💾 Salvesta</button>'
        + '<button class="nupp hall" onclick="mkTagasi()">← Tagasi</button>'
        + (mkAvatudId !== 'uus' ? '<button class="nupp punane" style="margin-left:auto" onclick="mkKustuta(' + mkAvatudId + ')">🗑 Kustuta</button>' : '')
        + '</div></div>';
      var p = document.getElementById('mk-e-pealkiri');
      if (p) p.focus();
      return;
    }

    // Nimekirjavaade
    var html = '<div style="padding:14px 24px;border-bottom:0.5px solid var(--piir2)">'
      + '<button class="nupp kull" style="width:100%" onclick="mkUus()">+ Uus märge</button></div>';

    if (!mkList.length) {
      div.innerHTML = html + '<div style="padding:28px;text-align:center;color:var(--hall);font-size:13px">Märkmeid pole veel.</div>';
      return;
    }

    div.innerHTML = html + mkList.map(function (m) {
      var pealkiri = m.pealkiri || (m.tekst || '').split('\n')[0].slice(0, 60) || 'Pealkirjata';
      var sisu = (m.tekst || '').replace(/\s+/g, ' ').slice(0, 120);
      return '<div style="display:flex;gap:10px;align-items:flex-start;padding:13px 24px;border-bottom:0.5px solid var(--piir3)' + (m.tehtud ? ';opacity:0.45' : '') + '">'
        + '<input type="checkbox" ' + (m.tehtud ? 'checked' : '') + ' onchange="mkTehtud(' + m.id + ', this.checked)" style="width:auto;margin-top:3px;flex-shrink:0">'
        + '<div style="flex:1;min-width:0;cursor:pointer" onclick="mkAva(' + m.id + ')">'
        + '<div style="font-size:14px;font-weight:600;color:var(--tekst)' + (m.tehtud ? ';text-decoration:line-through' : '') + '">' + esc(pealkiri) + '</div>'
        + (sisu ? '<div style="font-size:12px;color:var(--tekst3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(sisu) + '</div>' : '')
        + '<div style="font-size:11px;color:var(--hall);margin-top:4px">' + kpTekst(m) + '</div>'
        + '</div>'
        + '<span style="color:var(--hall);font-size:16px;flex-shrink:0">›</span>'
        + '</div>';
    }).join('');
  }

  window.mkAvaPaneel = function () {
    mkAvatudId = null;
    document.getElementById('mkModal').classList.add('avatud');
    mkLaadi();
  };

  window.mkSuljePaneel = function () {
    document.getElementById('mkModal').classList.remove('avatud');
    mkAvatudId = null;
  };

  window.mkUus = function () { mkAvatudId = 'uus'; mkJoonista(); };
  window.mkAva = function (id) { mkAvatudId = id; mkJoonista(); };
  window.mkTagasi = function () { mkAvatudId = null; mkJoonista(); };

  window.mkSalvesta = async function () {
    var pealkiri = document.getElementById('mk-e-pealkiri').value.trim();
    var tekst = document.getElementById('mk-e-tekst').value.trim();
    if (!pealkiri && !tekst) { alert('Märge on tühi'); return; }
    var r;
    if (mkAvatudId === 'uus') {
      r = await api('/api/markmed', { method: 'POST', body: JSON.stringify({ pealkiri: pealkiri, tekst: tekst }) });
    } else {
      r = await api('/api/markmed/' + mkAvatudId, { method: 'PUT', body: JSON.stringify({ pealkiri: pealkiri, tekst: tekst }) });
    }
    if (!r || !r.ok) { alert((r && r.veateade) || 'Salvestamine ebaõnnestus'); return; }
    mkAvatudId = null;
    await mkLaadi();
  };

  window.mkTehtud = async function (id, tehtud) {
    await api('/api/markmed/' + id + '/tehtud', { method: 'PUT', body: JSON.stringify({ tehtud: tehtud }) });
    await mkLaadi();
  };

  window.mkKustuta = async function (id) {
    if (!confirm('Kustutad selle märkme jäädavalt?')) return;
    await api('/api/markmed/' + id, { method: 'DELETE' });
    mkAvatudId = null;
    await mkLaadi();
  };

  function seadista() {
    var nupp = document.createElement('button');
    nupp.type = 'button';
    nupp.className = 'topbar-ikoon-nupp';
    nupp.title = 'Märkmed';
    nupp.onclick = window.mkAvaPaneel;
    nupp.style.padding = '7px 12px';
    nupp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="21" height="21"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>'
      + '<span id="mk-badge" style="display:none;position:absolute;top:1px;right:3px;background:var(--kuld);color:#0d0f13;font-size:9px;font-weight:800;border-radius:8px;padding:1px 5px;min-width:15px;text-align:center">0</span>';
    var kelluke = document.getElementById('kk-kelluke');
    if (kelluke && kelluke.parentNode) kelluke.parentNode.insertBefore(nupp, kelluke);

    var modal = document.createElement('div');
    modal.className = 'tootaja-modal-overlay';
    modal.id = 'mkModal';
    modal.innerHTML = '<div class="tootaja-modal-sisu" style="max-width:620px">'
      + '<div class="tm-hdr"><span>📝 Märkmed</span><span class="tm-sulge" onclick="mkSuljePaneel()">✕</span></div>'
      + '<div id="mk-sisu" style="max-height:70vh;overflow-y:auto"></div></div>';
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
