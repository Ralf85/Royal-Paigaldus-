// Kiire tšeki lisamine — kaamera nupp ülaribal, igal admin-lehel kättesaadav.
// Mõte: tšekk on kõige suurema kadumisohuga taskus, seega pildistatakse kohe kohapeal.
(function () {
  var tsFail = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tsTeade(tekst, varv) {
    var el = document.getElementById('ts-teade');
    if (!el) return;
    el.style.display = tekst ? 'block' : 'none';
    el.style.color = varv || 'var(--hall)';
    el.textContent = tekst || '';
  }

  window.tsAva = function () {
    tsFail = null;
    document.getElementById('tsModal').classList.add('avatud');
    document.getElementById('ts-vorm').style.display = 'none';
    document.getElementById('ts-eelvaade').style.display = 'none';
    document.getElementById('ts-alusta').style.display = 'block';
    tsTeade('');
    document.getElementById('ts-fail').value = '';
  };

  window.tsSulge = function () {
    document.getElementById('tsModal').classList.remove('avatud');
  };

  window.tsFailValitud = async function (input) {
    var f = input.files && input.files[0];
    if (!f) return;
    tsFail = f;
    document.getElementById('ts-alusta').style.display = 'none';

    if (f.type && f.type.indexOf('image/') === 0) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = document.getElementById('ts-pilt');
        img.src = e.target.result;
        document.getElementById('ts-eelvaade').style.display = 'block';
      };
      reader.readAsDataURL(f);
    }

    tsTeade('🤖 Loen tšekki...', '#a78bfa');
    var fd = new FormData();
    fd.append('fail', f);
    var r = await api('/api/arved/sisse/loe', { method: 'POST', body: fd });
    document.getElementById('ts-vorm').style.display = 'block';
    document.getElementById('ts-kuupaev').value = (r && r.kuupaev) || new Date().toISOString().split('T')[0];
    if (r && r.ok) {
      if (r.summa) document.getElementById('ts-summa').value = r.summa;
      if (r.kaibemaks) document.getElementById('ts-kaibemaks').value = r.kaibemaks;
      if (r.ettevote) document.getElementById('ts-kirjeldus').value = r.ettevote;
      if (r.ettevote_id) document.getElementById('ts-ettevote').value = r.ettevote_id;
      tsTeade('✓ Kontrolli üle ja salvesta', '#4ade80');
    } else {
      tsTeade('AI ei lugenud — täida käsitsi', '#fb923c');
    }
  };

  window.tsSalvesta = async function () {
    if (!tsFail) { alert('Pilt puudub'); return; }
    var nupp = document.getElementById('ts-salvesta-nupp');
    nupp.disabled = true;
    nupp.textContent = 'Salvestan...';
    var fd = new FormData();
    fd.append('fail', tsFail);
    fd.append('kuupaev', document.getElementById('ts-kuupaev').value);
    fd.append('ettevote_id', document.getElementById('ts-ettevote').value);
    fd.append('kirjeldus', document.getElementById('ts-kirjeldus').value);
    fd.append('summa', document.getElementById('ts-summa').value || 0);
    fd.append('kaibemaks', document.getElementById('ts-kaibemaks').value || 0);
    var r = await api('/api/arved/tsekk-kiire', { method: 'POST', body: fd });
    nupp.disabled = false;
    nupp.textContent = '💾 Salvesta tšekk';
    if (!r || !r.ok) { tsTeade((r && r.veateade) || 'Salvestamine ebaõnnestus', '#ef4444'); return; }
    tsTeade('✅ Salvestatud!', '#4ade80');
    setTimeout(function () {
      window.tsSulge();
      if (typeof laadiSisseTabel === 'function') laadiSisseTabel();
    }, 1200);
  };

  function seadista() {
    var nupp = document.createElement('button');
    nupp.type = 'button';
    nupp.className = 'topbar-ikoon-nupp';
    nupp.title = 'Lisa tšekk';
    nupp.onclick = window.tsAva;
    nupp.style.padding = '7px 12px';
    nupp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="21" height="21"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
    var kelluke = document.getElementById('kk-kelluke');
    if (kelluke && kelluke.parentNode) kelluke.parentNode.insertBefore(nupp, kelluke);

    var modal = document.createElement('div');
    modal.className = 'tootaja-modal-overlay';
    modal.id = 'tsModal';
    modal.innerHTML = '<div class="tootaja-modal-sisu" style="max-width:480px">'
      + '<div class="tm-hdr"><span>📷 Lisa tšekk</span><span class="tm-sulge" onclick="tsSulge()">✕</span></div>'
      + '<div style="padding:18px 22px">'
      + '<div id="ts-alusta">'
      + '<label style="display:block;text-align:center;background:rgba(37,99,235,0.12);border:2px dashed var(--sinine);border-radius:12px;padding:32px 16px;color:var(--sinine);font-size:15px;font-weight:700;cursor:pointer">'
      + '📷 Pildista või vali tšekk'
      + '<input type="file" id="ts-fail" accept="image/*,application/pdf" capture="environment" style="display:none" onchange="tsFailValitud(this)">'
      + '</label>'
      + '<div style="font-size:12px;color:var(--hall);text-align:center;margin-top:10px">Läheb Royal Paigalduse kuluks, staatusega makstud.</div>'
      + '</div>'
      + '<div id="ts-eelvaade" style="display:none;margin-bottom:14px"><img id="ts-pilt" style="width:100%;max-height:200px;object-fit:contain;border-radius:10px;background:var(--bg3)"></div>'
      + '<div id="ts-teade" style="display:none;font-size:13px;margin-bottom:12px;text-align:center"></div>'
      + '<div id="ts-vorm" style="display:none">'
      + '<div class="vorm-rida col2">'
      + '<div class="vorm-grupp"><label>Kuupäev</label><input type="date" id="ts-kuupaev"></div>'
      + '<div class="vorm-grupp"><label>Kuhu läheb</label><select id="ts-ettevote"></select></div>'
      + '</div>'
      + '<div class="vorm-grupp" style="margin-bottom:12px"><label>Kirjeldus</label><input type="text" id="ts-kirjeldus" placeholder="nt Lidli objekti kruvid"></div>'
      + '<div class="vorm-rida col2">'
      + '<div class="vorm-grupp"><label>Summa kokku (€)</label><input type="number" step="0.01" id="ts-summa"></div>'
      + '<div class="vorm-grupp"><label>Käibemaks (€)</label><input type="number" step="0.01" id="ts-kaibemaks"></div>'
      + '</div>'
      + '<button class="nupp roheline" id="ts-salvesta-nupp" style="width:100%;padding:13px;font-size:15px;margin-top:6px" onclick="tsSalvesta()">💾 Salvesta tšekk</button>'
      + '</div></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === this) window.tsSulge(); });

    // "Kuhu läheb" valik — vaikimisi MUU, sest enamik kaardiostudest on üldkulud.
    api('/api/admin/ettevotted').then(function (list) {
      var sel = document.getElementById('ts-ettevote');
      if (!sel || !Array.isArray(list)) return;
      sel.innerHTML = list.filter(function (e) { return e.tyyp !== 'edgf'; })
        .map(function (e) { return '<option value="' + e.id + '">' + esc(e.nimi) + '</option>'; }).join('');
      var muu = list.find(function (e) { return (e.nimi || '').toUpperCase() === 'MUU'; });
      if (muu) sel.value = muu.id;
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seadista);
  else seadista();
})();
