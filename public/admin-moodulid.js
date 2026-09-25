// admin-moodulid.js — Projektid, Raport, Audit logi, Fotod, X-seeria.
// ── PROJEKTID (EDGF/Rally jms) ────────────────────────────────────
let pkAktiivneId = null;
let pkKoikProjektid = [];

async function pkLaadiTab() {
  const r = await api('/api/projektid/admin/nimekiri');
  pkKoikProjektid = Array.isArray(r) ? r : [];
  const div = document.getElementById('pk-valik');
  div.innerHTML = pkKoikProjektid.map(p => `
    <button class="nupp ${pkAktiivneId===p.id?'kull':'hall'}" onclick="pkValiProjekt(${p.id})">${p.ikoon||'📁'} ${p.nimi}</button>
  `).join('');
  if (pkAktiivneId && pkKoikProjektid.some(p=>p.id===pkAktiivneId)) {
    document.getElementById('pk-sisu').style.display = 'block';
    pkValiProjekt(pkAktiivneId, true);
  } else if (pkKoikProjektid.length) {
    pkValiProjekt(pkKoikProjektid[0].id);
  } else {
    document.getElementById('pk-sisu').style.display = 'none';
  }
}

function pkToggleUusVorm() {
  const el = document.getElementById('pk-uus-vorm');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function pkLooProjekt() {
  const nimi = document.getElementById('pk-uus-nimi').value.trim();
  const ikoon = document.getElementById('pk-uus-ikoon').value.trim() || '📁';
  const varv = document.getElementById('pk-uus-varv').value;
  if (!nimi) return naitaTeade('pk-uus-teade','viga','Sisesta projekti nimi');
  const r = await api('/api/projektid/admin/nimekiri', { method:'POST', body: JSON.stringify({ nimi, ikoon, varv }) });
  if (r && r.ok) {
    naitaTeade('pk-uus-teade','ok','✅ Loodud!');
    document.getElementById('pk-uus-nimi').value='';
    pkToggleUusVorm();
    pkAktiivneId = r.id;
    await pkLaadiTab();
  } else naitaTeade('pk-uus-teade','viga', (r&&r.veateade)||'Viga');
}

function pkValiProjekt(id, skipRender) {
  pkAktiivneId = id;
  const p = pkKoikProjektid.find(x=>x.id===id);
  if (!p) return;
  document.getElementById('pk-sisu').style.display = 'block';
  document.getElementById('pk-nimi-1').textContent = p.nimi;
  document.getElementById('pk-nimi-2').textContent = p.nimi;
  if (!skipRender) {
    document.querySelectorAll('#pk-valik .nupp').forEach(b => b.classList.remove('kull'));
  }
  pkLaadiLubatud();
  const t = new Date();
  const kSel = document.getElementById('pk-filter-kuu'), aSel = document.getElementById('pk-filter-aasta');
  if (kSel && !kSel.options.length) {
    KUUD.forEach((k,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=k;if(i===t.getMonth())o.selected=true;kSel.appendChild(o);});
    for(let y=t.getFullYear();y>=t.getFullYear()-2;y--){const o=document.createElement('option');o.value=y;o.textContent=y;if(y===t.getFullYear())o.selected=true;aSel.appendChild(o);}
  }
  pkLaadiKulud();
  const chevronBtns = document.querySelectorAll('#pk-valik .nupp');
  chevronBtns.forEach(b => { b.classList.remove('kull'); b.classList.add('hall'); });
  const idx = pkKoikProjektid.findIndex(x=>x.id===id);
  if (chevronBtns[idx]) { chevronBtns[idx].classList.remove('hall'); chevronBtns[idx].classList.add('kull'); }
}

async function pkLaadiLubatud() {
  const div = document.getElementById('pkLubatudSisu');
  div.innerHTML = '<div style="color:var(--hall);font-size:13px">Laadimine...</div>';
  const [workers, lubatud] = await Promise.all([
    api('/api/admin/tootajad'),
    api(`/api/projektid/admin/${pkAktiivneId}/lubatud`)
  ]);
  const lubMap = {};
  (Array.isArray(lubatud)?lubatud:[]).forEach(w => lubMap[w.id]=!!w.lubatud);
  div.innerHTML = (Array.isArray(workers)?workers:[]).filter(w=>w.aktiivne).map(w => `
    <div class="ettevote-rida">
      <div class="ettevote-rida-vasak"><span class="ettevote-nimi">${w.nimi}</span></div>
      <label class="toggle-switch"><input type="checkbox" ${lubMap[w.id]?'checked':''} onchange="pkToggleLubatud(${w.id}, this.checked)"><span class="toggle-slider"></span></label>
    </div>`).join('');
}

async function pkToggleLubatud(workerId, lubatud) {
  await api(`/api/projektid/admin/${pkAktiivneId}/lubatud/${workerId}`, { method:'POST', body: JSON.stringify({ lubatud }) });
}

async function pkLaadiKulud() {
  const kuu = document.getElementById('pk-filter-kuu').value;
  const aasta = document.getElementById('pk-filter-aasta').value;
  await pkLaadiKuludReal(`?kuu=${kuu}&aasta=${aasta}`);
}
async function pkLaadiKoik() { await pkLaadiKuludReal(''); }

async function pkLaadiKuludReal(query) {
  const div = document.getElementById('pkKuludSisu');
  div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Laadimine...</div>';
  const r = await api(`/api/projektid/admin/${pkAktiivneId}/kulud${query}`);
  const list = Array.isArray(r) ? r : [];
  if (!list.length) { div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Kulusid pole selle perioodi kohta</div>'; return; }
  const kokku = list.reduce((s,k)=>s+parseFloat(k.summa||0),0);
  div.innerHTML = `<div style="padding:10px 18px;font-size:12px;color:var(--hall)">Kokku: <b style="color:var(--tekst)">${kokku.toFixed(2)} €</b> (${list.length} kirjet)</div>
    <table><thead><tr><th>Kuupäev</th><th>Töötaja</th><th>Kirjeldus</th><th style="text-align:right">Summa</th></tr></thead><tbody>` +
    list.map(k => `<tr><td>${formatKp(k.kuupaev)}</td><td>${k.worker_nimi||'—'}</td><td>${k.kirjeldus||'—'}</td><td style="text-align:right">${parseFloat(k.summa).toFixed(2)} €</td></tr>`).join('') +
    '</tbody></table>';
}

function pkLaadiCSV(e) {
  e.preventDefault();
  const kuu = document.getElementById('pk-filter-kuu').value;
  const aasta = document.getElementById('pk-filter-aasta').value;
  window.location = `/api/projektid/admin/${pkAktiivneId}/kulud-csv?kuu=${kuu}&aasta=${aasta}&_token=${TOKEN}`;
}

// ── RAPORT TAB ─────────────────────────────────────────────────
async function laadiRaportTab() {
  const sel = document.getElementById('r-ettevote');
  sel.innerHTML = '<option value="">— Vali ettevõte —</option>' + kõikEttevotted.map(e=>`<option value="${e.id}" data-tyyp="${e.tyyp||'muu'}">${e.nimi}</option>`).join('');
  const t = new Date();
  const rKuu = document.getElementById('r-kuu'), rAasta = document.getElementById('r-aasta');
  if (rKuu && !rKuu.options.length) {
    KUUD.forEach((k,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=k;if(i===t.getMonth())o.selected=true;rKuu.appendChild(o);});
    for(let y=t.getFullYear();y>=t.getFullYear()-2;y--){const o=document.createElement('option');o.value=y;o.textContent=y;if(y===t.getFullYear())o.selected=true;rAasta.appendChild(o);}
  }
}

function r_ettevoteVahetud() {
  const sel = document.getElementById('r-ettevote');
  const opt = sel.options[sel.selectedIndex];
  const tyyp = opt ? opt.dataset.tyyp : '';
  document.getElementById('r-lidl-filter').style.display = (tyyp === 'lidl') ? 'block' : 'none';
  document.getElementById('r-cramo-filter').style.display = (tyyp !== 'lidl' && sel.value) ? 'block' : 'none';
  if (sel.value) laadiRaportWorkers(sel.value);
  document.getElementById('r-eelvaade-kaart').style.display = 'none';
}

async function laadiRaportWorkers(ettevoteId) {
  const objektid = await api(`/api/tood/objektid/${ettevoteId}`);
  const workersMap = {};
  (Array.isArray(objektid)?objektid:[]).forEach(()=>{});
  const workers = await api('/api/admin/tootajad');
  const div = document.getElementById('r-workers');
  div.innerHTML = (Array.isArray(workers)?workers:[]).filter(w=>w.aktiivne).map(w=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap;background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:6px 12px"><input type="checkbox" value="${w.id}" class="r-worker-cb" style="width:auto" checked> ${w.nimi}</label>`).join('');
}

function r_koguFiltrid() {
  const ettevote_id = document.getElementById('r-ettevote').value;
  const workerIds = [...document.querySelectorAll('.r-worker-cb:checked')].map(cb=>cb.value);
  const opt = document.getElementById('r-ettevote').options[document.getElementById('r-ettevote').selectedIndex];
  const tyyp = opt ? opt.dataset.tyyp : '';
  let algus, lopp;
  if (tyyp === 'lidl') {
    algus = document.getElementById('r-algus').value;
    lopp = document.getElementById('r-lopp').value;
  } else {
    const kuu = document.getElementById('r-kuu').value, aasta = document.getElementById('r-aasta').value;
    algus = `${aasta}-${String(kuu).padStart(2,'0')}-01`;
    lopp = new Date(aasta, kuu, 0).toISOString().split('T')[0];
  }
  const objektId = document.getElementById('r-objekt').value;
  return { ettevote_id, workerIds, algus, lopp, objektId };
}

async function laadiRaportEelvaade() {
  const { ettevote_id, workerIds, algus, lopp, objektId } = r_koguFiltrid();
  const teadeEl = document.getElementById('r-teade');
  if (!ettevote_id) { teadeEl.style.display='block'; teadeEl.textContent='Vali ettevõte'; return; }
  teadeEl.style.display='none';
  let url = `/api/admin/raport-filter?ettevote_id=${ettevote_id}&algus=${algus}&lopp=${lopp}&_=${Date.now()}`;
  if (objektId) url += `&objekt_id=${objektId}`;
  if (workerIds.length) url += `&workers=${workerIds.join(',')}`;
  const rows = await api(url);
  console.log('raport-filter eelvaade vastus:', rows);
  const list = Array.isArray(rows) ? rows : [];
  const kaart = document.getElementById('r-eelvaade-kaart');
  kaart.style.display = 'block';
  if (!list.length) { document.getElementById('r-eelvaade').innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Andmeid ei leitud</div>'; return; }
  const tunnid = list.reduce((s,r)=>s+parseFloat(r.tunnid||0),0);
  document.getElementById('r-eelvaade').innerHTML = `<div style="padding:10px 18px;font-size:12px;color:var(--hall)">Kokku: <b style="color:var(--tekst)">${tunnid.toFixed(1)}h</b> (${list.length} kirjet)</div>
    <table><thead><tr><th>Kuupäev</th><th>Töötaja</th><th>Objekt</th><th>Algus</th><th>Lõpp</th><th style="text-align:right">Tunnid</th><th>Kirjeldus</th></tr></thead><tbody>` +
    list.map(r=>`<tr><td>${formatKp(r.kuupaev)}</td><td>${r.worker_nimi}</td><td>${r.objekt_nimi||'—'}</td><td>${(r.algus||'').slice(0,5)}</td><td>${(r.lopp||'').slice(0,5)}</td><td style="text-align:right">${parseFloat(r.tunnid).toFixed(1)}</td><td style="color:var(--hall);font-size:12px">${r.lidl_projekt_nimi || r.kommentaar || '—'}</td></tr>`).join('') +
    '</tbody></table>';
}

function laadiRaportCSV() {
  const { ettevote_id, workerIds, algus, lopp, objektId } = r_koguFiltrid();
  if (!ettevote_id) { alert('Vali ettevõte'); return; }
  let url = `/api/admin/raport-filter-csv?ettevote_id=${ettevote_id}&algus=${algus}&lopp=${lopp}&_token=${TOKEN}`;
  if (objektId) url += `&objekt_id=${objektId}`;
  if (workerIds.length) url += `&workers=${workerIds.join(',')}`;
  window.location = url;
}

async function laadiRaportExcel() {
  const { ettevote_id, workerIds, algus, lopp, objektId } = r_koguFiltrid();
  const teadeEl = document.getElementById('r-teade');
  if (!ettevote_id) { alert('Vali ettevõte'); return; }
  const opt = document.getElementById('r-ettevote').options[document.getElementById('r-ettevote').selectedIndex];
  const tyyp = opt ? opt.dataset.tyyp : 'muu';
  const esitusHind = prompt('Esitushind (€/h, käibemaksuta) selle raporti jaoks:', '25');
  if (esitusHind === null) return;
  const esitus_hind = parseFloat(esitusHind) || 0;
  let url = `/api/admin/raport-filter?ettevote_id=${ettevote_id}&algus=${algus}&lopp=${lopp}&_=${Date.now()}`;
  if (objektId) url += `&objekt_id=${objektId}`;
  if (workerIds.length) url += `&workers=${workerIds.join(',')}`;
  const rows = await api(url);
  console.log('raport-filter excel vastus:', rows);
  let andmed = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, kommentaar: r.lidl_projekt_nimi || r.kommentaar || '' }));
  if (!andmed.length) { teadeEl.style.display = 'block'; teadeEl.textContent = 'Andmeid ei leitud'; return; }
  teadeEl.style.display = 'none';
  const resp = await fetch('/api/admin/raport-excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': TOKEN },
    body: JSON.stringify({ andmed, tyyp, algus, lopp, esitus_hind })
  });
  if (!resp.ok) { const j = await resp.json().catch(()=>({})); alert(j.veateade || 'Exceli genereerimine ebaõnnestus'); return; }
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${tyyp}_raport_${algus}_${lopp}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(blobUrl);
}

// ── AUDIT LOGI ─────────────────────────────────────────────────
const AUDIT_TEGEVUSED = {
  sisse_logi: 'logis sisse',
  valja_logi: 'logis välja',
  lisa_kirje: 'lisas töökirje',
  muuda_kirje: 'muutis töökirjet',
  kustuta_kirje: 'kustutas töökirje',
  lisa_makse: 'lisas makse',
  kustuta_makse: 'tühistas makse',
  lisa_tootaja: 'lisas töötaja',
  muuda_tootaja: 'muutis töötajat',
  arhiveeri_tootaja: 'arhiveeris töötaja',
  taasta_tootaja: 'taastas töötaja',
  kustuta_tootaja: 'kustutas töötaja',
  lisa_objekt: 'lisas objekti',
  muuda_objekt: 'muutis objekti',
  lisa_arve: 'lõi arve',
  muuda_arve: 'muutis arvet',
  kustuta_arve: 'kustutas arve',
};

async function laadiAuditLogi() {
  const div = document.getElementById('auditLogiSisu');
  const d = await api('/api/admin/audit-log');
  if (!Array.isArray(d) || !d.length) { div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Tegevusi pole veel</div>'; return; }
  div.innerHTML = '<div style="padding:8px 18px">' + d.map(a => {
    const aeg = a.loodud ? new Date(a.loodud).toLocaleString('et-EE') : '—';
    const tegevusTekst = AUDIT_TEGEVUSED[a.tegevus] || a.tegevus || '—';
    return `<div class="tegevus-rida"><div class="tegevus-dot"></div><div><div class="tegevus-tekst"><b>${escapeHtmlXs(a.worker_nimi || 'Admin')}</b> — ${escapeHtmlXs(tegevusTekst)}</div><div class="tegevus-aeg">${aeg}</div></div></div>`;
  }).join('') + '</div>';
}

function escapeHtmlXs(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── FOTOD ────────────────────────────────────────────────────────
async function laadiFotod() {
  const div = document.getElementById('fotodSisu');
  div.innerHTML = '<div style="color:var(--hall);font-size:13px">Laadimine...</div>';
  const r = await api('/api/fotod/admin/nimekiri');
  const list = Array.isArray(r) ? r : [];
  if (!list.length) { div.innerHTML = '<div style="color:var(--hall);font-size:13px;text-align:center;padding:24px">Fotosid pole veel üles laetud</div>'; return; }
  div.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">` +
    list.map(f => `<div style="border-radius:8px;overflow:hidden;background:var(--bg3)"><img src="${f.url}" style="width:100%;height:110px;object-fit:cover;display:block"><div style="padding:6px 8px;font-size:10px;color:var(--hall)">${f.objekt_nimi||''}</div></div>`).join('') +
    '</div>';
}

function välju() {
  localStorage.removeItem('adminToken');
  window.location = '/admin-login';
}

// ── X-SEERIA ─────────────────────────────────────────────────

let xsEvents = [];
let xsAktiivneEventId = null;

async function xsLaadiTab() {
  xsTaidaNumbriDropdownid();
  xsTootajad = []; // värskenda vastutaja-valikut iga kord, kui tab avatakse (kui vahepeal keegi Töötajad tabis lubasid muutis)
  await xsLaadiEvents();
  await xsLaadiLubatud();
  await xsLaadiSponsoridUldnimekiri();
}

function xsToggleSponsoridPaneel() {
  const paneel = document.getElementById('xs-sponsorid-paneel');
  const nool = document.getElementById('xs-sp-nool');
  const avatud = paneel.style.display !== 'none';
  paneel.style.display = avatud ? 'none' : 'block';
  nool.textContent = avatud ? '▼' : '▲';
}

function xsToggleLubatudPaneel() {
  const paneel = document.getElementById('xs-lubatud-paneel');
  const nool = document.getElementById('xs-lub-nool');
  const avatud = paneel.style.display !== 'none';
  paneel.style.display = avatud ? 'none' : 'block';
  nool.textContent = avatud ? '▼' : '▲';
}

// Üldine peida/näita nupp ürituse-detaili kaartidele (Pargid, Ülesanded, Tegevused, Sponsorite staatus, Kulud) —
// sama muster, mida juba kasutavad "🎁 Sponsorid" ja "👷 Töötajate ligipääs" paneelid.
function xsToggleKaartPaneel(bodyId, noolId) {
  const paneel = document.getElementById(bodyId);
  const nool = document.getElementById(noolId);
  const avatud = paneel.style.display !== 'none';
  paneel.style.display = avatud ? 'none' : 'block';
  if (nool) nool.textContent = avatud ? '▼' : '▲';
}

function xsTaidaNumbriDropdownid() {
  const algus = document.getElementById('xs-p-algus');
  const lopp = document.getElementById('xs-p-lopp');
  if (algus.options.length) return;
  for (let n = 1; n <= 150; n++) {
    algus.innerHTML += `<option value="${n}">${n}</option>`;
    lopp.innerHTML += `<option value="${n}">${n}</option>`;
  }
}

function xsUuendaLoppNr() {
  const algus = parseInt(document.getElementById('xs-p-algus').value, 10) || 1;
  const arv = parseInt(document.getElementById('xs-p-arv').value, 10) || 1;
  const lopp = Math.min(algus + arv - 1, 150);
  document.getElementById('xs-p-lopp').value = String(lopp);
}

async function xsLaadiEvents() {
  const d = await api('/api/xseeria/admin/events');
  xsEvents = d.events || [];
  const box = document.getElementById('xs-eventpick');
  box.innerHTML = xsEvents.map(e => `
    <div class="xs-event-tile ${e.id === xsAktiivneEventId ? 'ak' : ''}" onclick="xsVahetaEvent(${e.id})">
      ${e.kaas_foto_url
        ? `<img src="${e.kaas_foto_url}" alt="${e.nimi.replace(/"/g,'&quot;')}">`
        : `<div class="xs-event-tile-placeholder">🥏</div>`}
      <button class="xs-event-tile-foto-nupp" title="Vaheta pilt" onclick="event.stopPropagation();xsAvaKaasFotoValija(${e.id})">📷</button>
      <div class="xs-event-tile-caption">
        <div class="xs-event-tile-nimi">${e.nimi}</div>
        <div class="xs-event-tile-kp">${String(e.kuupaev).slice(0,10)}</div>
      </div>
    </div>`
  ).join('') || '<span style="font-size:12px;color:var(--hall)">Võistlusi pole veel.</span>';

  const asKaart = document.getElementById('xs-asukohad-kaart');
  const editKaart = document.getElementById('xs-event-edit');
  const ulKaart = document.getElementById('xs-ulesanded-kaart');
  const tegKaart = document.getElementById('xs-tegevused-kaart');
  const spStaatusKaart = document.getElementById('xs-sponsorstaatus-kaart');
  const kuluKaart = document.getElementById('xs-kulud-kaart');
  // Kui valitud võistlus on vahepeal kustutatud, tühista valik — aga ÄRA vali automaatselt uut,
  // et pealeht jääks puhtaks (event chipid + sponsorid + töötajad) kuni admin ise millelegi vajutab
  if (!xsEvents.find(e => e.id === xsAktiivneEventId)) {
    xsAktiivneEventId = null;
  }
  if (xsAktiivneEventId) {
    asKaart.style.display = 'block';
    ulKaart.style.display = 'block';
    tegKaart.style.display = 'block';
    spStaatusKaart.style.display = 'block';
    kuluKaart.style.display = 'block';
    const ev = xsEvents.find(e => e.id === xsAktiivneEventId);
    document.getElementById('xs-aktiivne-nimi').textContent = ev ? ev.nimi : '';
    document.getElementById('xs-ul-event-nimi').textContent = ev ? ev.nimi : '';
    document.getElementById('xs-teg-event-nimi').textContent = ev ? ev.nimi : '';
    document.getElementById('xs-sp-event-nimi').textContent = ev ? ev.nimi : '';
    document.getElementById('xs-kulu-event-nimi').textContent = ev ? ev.nimi : '';
    if (ev) {
      editKaart.style.display = 'block';
      document.getElementById('xs-ev-edit-nimi').value = ev.nimi;
      document.getElementById('xs-ev-edit-kuupaev').value = String(ev.kuupaev).slice(0,10);
      document.getElementById('xs-ev-edit-hooaeg').value = ev.hooaeg;
      document.getElementById('xs-ev-edit-rajakaart').value = ev.rajakaart_url || '';
    }
    await xsLaadiAsukohad();
    await xsLaadiTootajaValikud();
    await xsLaadiUlesanded();
    await xsLaadiTegevused();
    await xsLaadiSponsoriStaatusTabel();
    await xsLaadiKulud();
  } else {
    asKaart.style.display = 'none';
    editKaart.style.display = 'none';
    ulKaart.style.display = 'none';
    tegKaart.style.display = 'none';
    spStaatusKaart.style.display = 'none';
    kuluKaart.style.display = 'none';
  }
}

async function xsVahetaEvent(id) {
  xsAktiivneEventId = id;
  xsTyhistaParkEdit();
  xsTyhistaUlesandeEdit();
  xsTyhistaSponsorEdit();
  await xsLaadiEvents();
}

let xsKaasFotoEventId = null;
function xsAvaKaasFotoValija(eventId) {
  xsKaasFotoEventId = eventId;
  document.getElementById('xs-kaas-foto-input').click();
}
async function xsLaeKaasFoto(inputEl) {
  const fail = inputEl.files[0];
  inputEl.value = '';
  if (!fail || !xsKaasFotoEventId) return;
  const fd = new FormData();
  fd.append('foto', fail);
  const r = await api(`/api/xseeria/admin/events/${xsKaasFotoEventId}/kaas-foto`, { method: 'POST', body: fd });
  xsKaasFotoEventId = null;
  if (r.ok) await xsLaadiEvents();
  else alert(r.veateade || 'Pildi üleslaadimine ebaõnnestus');
}

// Kiirnupp "💰 Kulude raport" pealehe päises — avab valitud ürituse Kulude raporti kaardi ja kerib sinna.
function xsAvaKuluRaport() {
  if (!xsAktiivneEventId) {
    alert('Vali kõigepealt võistlus, mille kulusid soovid vaadata (või lisa uus võistlus).');
    return;
  }
  const body = document.getElementById('xs-kulu-body');
  const nool = document.getElementById('xs-kulu-nool');
  if (body) body.style.display = 'block';
  if (nool) nool.textContent = '▲';
  const kaart = document.getElementById('xs-kulud-kaart');
  if (kaart) kaart.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Tagasi puhtale pealehele: peida ürituse detail (Pargid/Ülesanded/Sponsorite staatus/muuda-vorm),
// jäta nähtavaks ainult võistluste nimekiri, Sponsorid-nupp ja Töötajate ligipääs.
async function xsMineePealehele() {
  xsAktiivneEventId = null;
  xsTyhistaParkEdit();
  xsTyhistaUlesandeEdit();
  xsTyhistaSponsorEdit();
  await xsLaadiEvents();
}

async function xsSalvestaEvent() {
  if (!xsAktiivneEventId) return;
  const nimi = document.getElementById('xs-ev-edit-nimi').value.trim();
  const kuupaev = document.getElementById('xs-ev-edit-kuupaev').value;
  const hooaeg = document.getElementById('xs-ev-edit-hooaeg').value;
  const rajakaart_url = document.getElementById('xs-ev-edit-rajakaart').value.trim();
  const teade = document.getElementById('xs-ev-edit-teade');
  if (!nimi || !kuupaev) {
    teade.className = 'teade viga'; teade.textContent = 'Täida nimi ja kuupäev'; teade.style.display = 'block';
    return;
  }
  const d = await api('/api/xseeria/admin/events/' + xsAktiivneEventId, { method: 'PUT', body: JSON.stringify({ nimi, kuupaev, hooaeg, rajakaart_url }) });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.className = 'teade ok'; teade.textContent = 'Salvestatud'; teade.style.display = 'block';
  await xsLaadiEvents();
}

async function xsKustutaEvent() {
  if (!xsAktiivneEventId) return;
  const ev = xsEvents.find(e => e.id === xsAktiivneEventId);
  if (!confirm(`Kustutada võistlus "${ev ? ev.nimi : ''}" koos KÕIGI selle parkide ja korvidega? Seda ei saa tagasi võtta.`)) return;
  await api('/api/xseeria/admin/events/' + xsAktiivneEventId, { method: 'DELETE' });
  xsAktiivneEventId = null;
  await xsLaadiEvents();
}

async function xsLooEvent() {
  const nimi = document.getElementById('xs-ev-nimi').value.trim();
  const kuupaev = document.getElementById('xs-ev-kuupaev').value;
  const hooaeg = document.getElementById('xs-ev-hooaeg').value;
  const rajakaart_url = document.getElementById('xs-ev-rajakaart').value.trim();
  const teade = document.getElementById('xs-ev-teade');
  if (!nimi || !kuupaev) {
    teade.className = 'teade viga'; teade.textContent = 'Täida nimi ja kuupäev'; teade.style.display = 'block';
    return;
  }
  const d = await api('/api/xseeria/admin/events', { method: 'POST', body: JSON.stringify({ nimi, kuupaev, hooaeg, rajakaart_url }) });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  document.getElementById('xs-ev-nimi').value = '';
  document.getElementById('xs-ev-kuupaev').value = '';
  document.getElementById('xs-ev-rajakaart').value = '';
  document.getElementById('xs-ev-uus-vorm').style.display = 'none';
  document.getElementById('xs-ev-uus-nupp').style.display = 'inline-block';
  xsAktiivneEventId = d.event.id;
  await xsLaadiEvents();
}

function xsToggleUusVoistlusVorm() {
  const vorm = document.getElementById('xs-ev-uus-vorm');
  const nupp = document.getElementById('xs-ev-uus-nupp');
  const avatud = vorm.style.display !== 'none';
  vorm.style.display = avatud ? 'none' : 'block';
  nupp.style.display = avatud ? 'inline-block' : 'none';
  document.getElementById('xs-ev-teade').style.display = 'none';
}

async function xsLisaBulk() {
  const tekst = document.getElementById('xs-bulk').value;
  if (!tekst.trim() || !xsAktiivneEventId) return;
  const d = await api('/api/xseeria/admin/asukohad/bulk', { method: 'POST', body: JSON.stringify({ event_id: xsAktiivneEventId, tekst }) });
  if (!d.ok) return alert(d.veateade || 'Viga');
  document.getElementById('xs-bulk').value = '';
  await xsLaadiAsukohad();
}

let xsMuudetavAsukohtId = null;

function xsJoonistaAsukohaVastutajaValik(valitudIds) {
  valitudIds = valitudIds || [];
  const div = document.getElementById('xs-p-vastutajad-valik');
  if (!div) return;
  if (!xsTootajad.length) { div.innerHTML = '<span style="color:var(--hall);font-size:12px">Ühelegi töötajale pole X-seeria ligipääsu lubatud (vt "Töötajad" tab).</span>'; return; }
  div.innerHTML = xsTootajad.map(w => `
    <label style="display:flex;align-items:center;gap:6px;background:var(--bg2);border:0.5px solid ${valitudIds.includes(w.id) ? '#2563eb' : 'var(--sisend-piir)'};border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px;color:var(--tekst2)">
      <input type="checkbox" value="${w.id}" style="width:auto;margin:0" ${valitudIds.includes(w.id) ? 'checked' : ''}> ${escapeHtmlXs(w.nimi)}
    </label>`).join('');
}

async function xsLisaPark() {
  const nimi = document.getElementById('xs-p-nimi').value.trim();
  const algus_nr = document.getElementById('xs-p-algus').value;
  const lopp_nr = document.getElementById('xs-p-lopp').value;
  const vastutajad = [...document.querySelectorAll('#xs-p-vastutajad-valik input:checked')].map(cb => parseInt(cb.value, 10));
  const teade = document.getElementById('xs-p-teade');
  if (!nimi || !xsAktiivneEventId) {
    teade.className = 'teade viga'; teade.textContent = 'Täida vähemalt pargi nimi'; teade.style.display = 'block';
    return;
  }
  let d;
  if (xsMuudetavAsukohtId) {
    d = await api('/api/xseeria/admin/asukohad/' + xsMuudetavAsukohtId + '/tapsed', {
      method: 'PUT', body: JSON.stringify({ nimi, algus_nr, lopp_nr, vastutajad })
    });
  } else {
    d = await api('/api/xseeria/admin/asukohad', {
      method: 'POST', body: JSON.stringify({ event_id: xsAktiivneEventId, nimi, algus_nr, lopp_nr, vastutajad })
    });
  }
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  xsTyhistaParkEdit();
  await xsLaadiAsukohad();
}

function xsAlustaParkEdit(a) {
  xsMuudetavAsukohtId = a.id;
  document.getElementById('xs-p-nimi').value = a.nimi;
  document.getElementById('xs-p-arv').value = a.korvide_koguarv;
  if (a.min_nr) document.getElementById('xs-p-algus').value = String(a.min_nr);
  if (a.max_nr) document.getElementById('xs-p-lopp').value = String(a.max_nr);
  xsJoonistaAsukohaVastutajaValik((a.vastutajad || []).map(v => v.id));
  document.getElementById('xs-p-pealkiri').textContent = `Muudad parki "${a.nimi}"`;
  document.getElementById('xs-p-nupp').textContent = 'Salvesta muudatused';
  document.getElementById('xs-p-tyhista').style.display = 'inline-block';
  document.getElementById('xs-p-teade').style.display = 'none';
  document.getElementById('xs-p-nimi').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function xsTyhistaParkEdit() {
  xsMuudetavAsukohtId = null;
  document.getElementById('xs-p-nimi').value = '';
  document.getElementById('xs-p-arv').value = '';
  xsJoonistaAsukohaVastutajaValik();
  document.getElementById('xs-p-pealkiri').textContent = 'Või lisa üks park täpsete rajanumbritega';
  document.getElementById('xs-p-nupp').textContent = '+ Lisa park';
  document.getElementById('xs-p-tyhista').style.display = 'none';
}

async function xsLaadiAsukohad() {
  if (!xsAktiivneEventId) return;
  await xsLaadiTootajaValikud();
  if (!xsMuudetavAsukohtId) xsJoonistaAsukohaVastutajaValik();
  const d = await api('/api/xseeria/event/' + xsAktiivneEventId + '/asukohad');
  if (!d.ok) return;
  const rows = d.asukohad;
  const tehtud = rows.reduce((s,a) => s + a.paigaldatud_arv, 0);
  const puhas = rows.reduce((s,a) => s + a.puhastatud_arv, 0);
  const korvidKokku = rows.reduce((s,a) => s + a.korvide_koguarv, 0);
  document.getElementById('xs-summary').textContent = `Kokku ${rows.length} parki · ${tehtud}/${korvidKokku} korvi paigaldatud · ${puhas}/${korvidKokku} puhastatud`;
  const t = document.getElementById('xs-tabel');
  t.innerHTML = `<table><thead><tr><th>Park</th><th>Korve</th><th>Rajad</th><th>Vastutajad</th><th>Paigaldus</th><th>Puhastus</th><th></th></tr></thead><tbody>` +
    rows.map(a => `<tr>
      <td>${a.nimi}</td>
      <td>${a.korvide_koguarv}</td>
      <td>${a.min_nr && a.max_nr ? a.min_nr + '-' + a.max_nr : '—'}</td>
      <td>${(a.vastutajad || []).map(v => escapeHtmlXs(v.nimi)).join(', ') || '—'}</td>
      <td>${a.paigaldatud_arv}/${a.korvide_koguarv}</td>
      <td>${a.puhastatud_arv}/${a.korvide_koguarv}</td>
      <td style="white-space:nowrap">
        <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAlustaParkEdit(${JSON.stringify(a).replace(/'/g, "&apos;")})'>✎</button>
        <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAvaFotoModal(${a.id}, "${escapeJs(a.nimi)}")'>📷</button>
        <button class="nupp punane" onclick="xsKustutaAsukoht(${a.id})">Kustuta</button>
      </td>
    </tr>`).join('') + `</tbody></table>`;
}

async function xsKustutaAsukoht(id) {
  if (!confirm('Kustutada see park koos kõigi korvidega?')) return;
  await api('/api/xseeria/admin/asukohad/' + id, { method: 'DELETE' });
  if (xsMuudetavAsukohtId === id) xsTyhistaParkEdit();
  await xsLaadiAsukohad();
}

function escapeJs(s) {
  return (s || '').toString().replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

// ── X-seeria rajakaartide bulk-üleslaadimine (pargi kaupa, lohistades) ──

let xsFotoAsukohtId = null;
let xsFotoSlotid = []; // [{ korvId, number, olemasolevUrl, uusFail, eelvaadeUrl }]

async function xsAvaFotoModal(asukohtId, nimi) {
  xsFotoAsukohtId = asukohtId;
  document.getElementById('xsFotoParkNimi').textContent = nimi;
  document.getElementById('xsFotoTeade').style.display = 'none';
  document.getElementById('xsFotoSalvestaNupp').style.display = 'none';
  document.getElementById('xsFotoGrid').innerHTML = 'Laadimine...';
  document.getElementById('xsFotoModal').classList.add('avatud');

  const d = await api('/api/xseeria/asukoht/' + asukohtId + '/korvid');
  if (!d.ok) { document.getElementById('xsFotoGrid').innerHTML = '<div style="color:var(--hall);font-size:13px">Viga laadimisel</div>'; return; }
  xsFotoSlotid = d.korvid.map(k => ({ korvId: k.id, number: k.number, olemasolevUrl: k.foto_url || null, uusFail: null, eelvaadeUrl: null }));
  xsJoonistaFotoGrid();
}

function xsSuljeFotoModal() {
  document.getElementById('xsFotoModal').classList.remove('avatud');
  xsFotoSlotid = [];
  xsFotoAsukohtId = null;
}

function xsJoonistaFotoGrid() {
  const grid = document.getElementById('xsFotoGrid');
  grid.innerHTML = xsFotoSlotid.map((s, i) => {
    const pilt = s.eelvaadeUrl || s.olemasolevUrl;
    const uus = !!s.eelvaadeUrl;
    return `
      <div style="text-align:center">
        <div style="position:relative;width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--bg3);border:0.5px solid ${uus ? '#2563eb' : 'var(--sisend-piir)'};cursor:pointer" onclick="xsVahetaUksPilt(${i})">
          ${pilt ? `<img src="${pilt}" style="width:100%;height:100%;object-fit:cover">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--hall);font-size:11px">tühi</div>`}
          ${uus ? `<div style="position:absolute;top:2px;right:2px;background:#2563eb;color:#ffffff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 4px">uus</div>` : ''}
          ${pilt ? `<button onclick="event.stopPropagation();xsKustutaFotoSlot(${i})" title="Eemalda pilt" style="position:absolute;top:2px;left:2px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(15,17,22,0.85);color:#f87171;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0">✕</button>` : ''}
        </div>
        <div style="font-size:11px;color:var(--hall);margin-top:4px">nr ${s.number}</div>
      </div>`;
  }).join('');
}

function xsVahetaUksPilt(index) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    xsFotoSlotid[index].uusFail = file;
    xsFotoSlotid[index].eelvaadeUrl = URL.createObjectURL(file);
    xsJoonistaFotoGrid();
    xsUuendaFotoSalvestaNupp();
  };
  input.click();
}

// Eemalda üks pilt raja kohalt otse pildivõrgustikust (nt kui pilt sattus vale numbri alla).
// Kui pilt on alles valitud, aga veel salvestamata (uusFail), eemaldatakse see lihtsalt valikust.
// Kui pilt on juba serverisse üles laetud (olemasolevUrl), kustutatakse see kohe ka Cloudinarysest/andmebaasist.
async function xsKustutaFotoSlot(index) {
  const s = xsFotoSlotid[index];
  if (!s) return;

  if (s.uusFail) {
    if (s.eelvaadeUrl) URL.revokeObjectURL(s.eelvaadeUrl);
    s.uusFail = null;
    s.eelvaadeUrl = null;
    xsJoonistaFotoGrid();
    xsUuendaFotoSalvestaNupp();
    return;
  }

  if (s.olemasolevUrl) {
    if (!confirm(`Kustutada raja nr ${s.number} pilt?`)) return;
    const r = await api('/api/xseeria/korvid/' + s.korvId + '/rajakaart', { method: 'DELETE' });
    if (!r.ok) { alert('Kustutamine ebaõnnestus: ' + (r.veateade || 'tundmatu viga')); return; }
    s.olemasolevUrl = null;
    xsJoonistaFotoGrid();
  }
}

function xsUuendaFotoSalvestaNupp() {
  const onPending = xsFotoSlotid.some(s => s.uusFail);
  document.getElementById('xsFotoSalvestaNupp').style.display = onPending ? 'inline-block' : 'none';
}

function xsFotodValitud(failid) {
  const arr = Array.from(failid);
  const jaotamata = [];

  // 1. samm: kui failinimes on number (nt "56.jpg"), sobita see TÄPSELT selle numbriga raja külge
  arr.forEach(file => {
    const m = file.name.match(/(\d+)/);
    if (m) {
      const num = parseInt(m[1], 10);
      const slot = xsFotoSlotid.find(s => parseInt(s.number, 10) === num && !s.uusFail);
      if (slot) {
        slot.uusFail = file;
        slot.eelvaadeUrl = URL.createObjectURL(file);
        return;
      }
    }
    jaotamata.push(file);
  });

  // 2. samm: failid, millel numbrit polnud VÕI number ei vastanud ühelegi selle pargi rajale,
  // täidetakse ülejäänud tühjadesse kohtadesse valimisjärjekorras
  let idx = 0;
  for (const file of jaotamata) {
    while (idx < xsFotoSlotid.length && (xsFotoSlotid[idx].olemasolevUrl || xsFotoSlotid[idx].uusFail)) idx++;
    if (idx >= xsFotoSlotid.length) break;
    xsFotoSlotid[idx].uusFail = file;
    xsFotoSlotid[idx].eelvaadeUrl = URL.createObjectURL(file);
    idx++;
  }
  xsJoonistaFotoGrid();
  xsUuendaFotoSalvestaNupp();
}

// Tihenda pilt enne üleslaadimist (kiirem üleslaadimine, eriti telefoni kaameraga tehtud suurte failide puhul)
function xsTihendaPilt(file, maxKylg, kvaliteet) {
  maxKylg = maxKylg || 1600; kvaliteet = kvaliteet || 0.8;
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith('image/')) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxKylg || height > maxKylg) {
        if (width > height) { height = Math.round(height * maxKylg / width); width = maxKylg; }
        else { width = Math.round(width * maxKylg / height); height = maxKylg; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || file); }, 'image/jpeg', kvaliteet);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Laadi üks pilt üles otse (mitte läbi jagatud api() abifunktsiooni), koos ajapiiranguga,
// et üleslaadimine kunagi lõputult "kinni" ei jääks
async function xsLaeUlesUksPilt(korvId, fail) {
  const compressed = await xsTihendaPilt(fail);
  const fd = new FormData();
  fd.append('foto', compressed, 'rajakaart.jpg');
  const controller = new AbortController();
  const ajapiirang = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch('/api/xseeria/korvid/' + korvId + '/rajakaart', {
      method: 'POST',
      headers: { 'x-session-token': TOKEN },
      body: fd,
      signal: controller.signal
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.veateade || 'Serveri viga');
    return true;
  } finally {
    clearTimeout(ajapiirang);
  }
}

async function xsSalvestaFotod() {
  const teade = document.getElementById('xsFotoTeade');
  const muudetud = xsFotoSlotid.filter(s => s.uusFail);
  if (!muudetud.length) return;
  document.getElementById('xsFotoSalvestaNupp').disabled = true;

  let valmis = 0, ebaonnestunud = 0;
  const KONKURENTSUS = 3;
  teade.className = 'teade ok'; teade.style.display = 'block';
  teade.textContent = `Laen üles 0/${muudetud.length}...`;

  const jarjekord = muudetud.slice();
  async function tootleja() {
    while (jarjekord.length) {
      const s = jarjekord.shift();
      try {
        await xsLaeUlesUksPilt(s.korvId, s.uusFail);
        valmis++;
      } catch (e) {
        ebaonnestunud++;
      }
      teade.textContent = `Laen üles ${valmis + ebaonnestunud}/${muudetud.length}` + (ebaonnestunud ? ` (${ebaonnestunud} ebaõnnestus)` : '') + '...';
    }
  }
  await Promise.all(Array.from({ length: Math.min(KONKURENTSUS, muudetud.length) }, tootleja));

  teade.textContent = ebaonnestunud
    ? `⚠️ ${valmis} pilti üles laetud, ${ebaonnestunud} ebaõnnestus — proovi ebaõnnestunud pildid uuesti`
    : `✅ ${valmis} pilti üles laetud`;
  document.getElementById('xsFotoSalvestaNupp').disabled = false;
  await xsAvaFotoModal(xsFotoAsukohtId, document.getElementById('xsFotoParkNimi').textContent);
}

document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('xsFotoDropzone');
  const input = document.getElementById('xsFotoInput');
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { xsFotodValitud(input.files); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = '#2563eb'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files && e.dataTransfer.files.length) xsFotodValitud(e.dataTransfer.files);
  });
});

document.getElementById('xsFotoModal')?.addEventListener('click', function(e) {
  if (e.target === this) xsSuljeFotoModal();
});

async function xsLaadiLubatud() {
  const r = await api('/api/xseeria/admin/lubatud');
  const div = document.getElementById('xsLubatudSisu');
  if (!Array.isArray(r)) { div.innerHTML = '<div style="color:var(--hall)">Viga laadimisel</div>'; return; }
  div.innerHTML = r.map(w => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--piir3)">
      <span style="font-size:13px;color:${w.lubatud?'var(--tekst)':'var(--hall)'}">${w.lubatud?'👷':'·'} ${w.nimi}</span>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
        <span style="color:${w.lubatud?'#4ade80':'var(--hall)'}">${w.lubatud ? 'Lubatud ✓' : 'Keelatud'}</span>
        <input type="checkbox" ${w.lubatud?'checked':''} onchange="xsToggleLubatud(${w.id}, this.checked)" style="width:auto;accent-color:#38bdf8">
      </label>
    </div>`).join('');
}

async function xsToggleLubatud(workerId, lubatud) {
  await api(`/api/xseeria/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
  await xsLaadiLubatud();
}

// ── X-SEERIA: ÜLESANDED (checklist) ───────────────────────────
let xsTootajad = [];

async function xsLaadiTootajaValikud() {
  if (xsTootajad.length) return; // laadi ainult üks kord tabi avamise kohta (xsLaadiTab tühjendab selle iga avamisel)
  // Näita Vastutaja valikus AINULT töötajaid, kellel on X-seeria ligipääs lubatud (Töötajad tabi "🥏 X-seeria" linnuke) —
  // nii ei sega valikut pooled inimesed, kes X-seeriaga tegelikult üldse tegemist ei tee.
  const d = await api('/api/xseeria/admin/lubatud');
  xsTootajad = Array.isArray(d) ? d.filter(w => w.lubatud) : [];
  const sel = document.getElementById('xs-ul-vastutaja');
  sel.innerHTML = '<option value="">— Vastutaja pole —</option>' + xsTootajad.map(w => `<option value="${w.id}">${w.nimi}</option>`).join('');
}

let xsMuudetavUlesanneId = null;

async function xsLaadiUlesanded() {
  if (!xsAktiivneEventId) return;
  const d = await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/ulesanded');
  const div = document.getElementById('xs-ul-nimekiri');
  if (!d.ok) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Viga laadimisel</div>'; return; }
  if (!d.ulesanded.length) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Ülesandeid pole veel lisatud.</div>'; return; }
  div.innerHTML = d.ulesanded.map(u => {
    const tahtaeg = u.tahtaeg ? String(u.tahtaeg).slice(0,10) : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--piir3)${u.tehtud ? ';opacity:0.55' : ''}">
      <input type="checkbox" ${u.tehtud ? 'checked' : ''} onchange="xsToggleUlesanne(${u.id})" style="width:auto;accent-color:#16a34a;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;${u.tehtud ? 'text-decoration:line-through;color:var(--hall)' : 'color:var(--tekst)'}">${escapeHtmlXs(u.tekst)}</div>
        <div style="font-size:11px;color:var(--hall);margin-top:2px">
          ${u.kategooria ? `<span style="background:var(--bg3);border-radius:4px;padding:1px 6px;margin-right:6px">${escapeHtmlXs(u.kategooria)}</span>` : ''}
          ${tahtaeg ? `📅 ${tahtaeg} ` : ''}${u.vastutaja_nimi ? `· 👷 ${escapeHtmlXs(u.vastutaja_nimi)}` : ''}
        </div>
      </div>
      <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAlustaUlesandeEdit(${JSON.stringify(u).replace(/'/g, "&apos;")})'>✎</button>
      <button class="nupp punane" onclick="xsKustutaUlesanne(${u.id})">🗑</button>
    </div>`;
  }).join('');
}

async function xsToggleUlesanne(id) {
  await api('/api/xseeria/admin/ulesanded/' + id + '/toggle', { method: 'POST' });
  await xsLaadiUlesanded();
}

async function xsKustutaUlesanne(id) {
  if (!confirm('Kustutada see ülesanne?')) return;
  await api('/api/xseeria/admin/ulesanded/' + id, { method: 'DELETE' });
  if (xsMuudetavUlesanneId === id) xsTyhistaUlesandeEdit();
  await xsLaadiUlesanded();
}

function xsAlustaUlesandeEdit(u) {
  xsMuudetavUlesanneId = u.id;
  document.getElementById('xs-ul-tekst').value = u.tekst;
  document.getElementById('xs-ul-kategooria').value = u.kategooria || '';
  document.getElementById('xs-ul-tahtaeg').value = u.tahtaeg ? String(u.tahtaeg).slice(0,10) : '';
  document.getElementById('xs-ul-vastutaja').value = u.vastutaja_id || '';
  document.getElementById('xs-ul-nupp').textContent = 'Salvesta muudatused';
  document.getElementById('xs-ul-tyhista').style.display = 'inline-block';
  document.getElementById('xs-ul-teade').style.display = 'none';
}

function xsTyhistaUlesandeEdit() {
  xsMuudetavUlesanneId = null;
  document.getElementById('xs-ul-tekst').value = '';
  document.getElementById('xs-ul-kategooria').value = '';
  document.getElementById('xs-ul-tahtaeg').value = '';
  document.getElementById('xs-ul-vastutaja').value = '';
  document.getElementById('xs-ul-nupp').textContent = '+ Lisa ülesanne';
  document.getElementById('xs-ul-tyhista').style.display = 'none';
}

async function xsLisaUlesanne() {
  if (!xsAktiivneEventId) return;
  const tekst = document.getElementById('xs-ul-tekst').value.trim();
  const kategooria = document.getElementById('xs-ul-kategooria').value.trim();
  const tahtaeg = document.getElementById('xs-ul-tahtaeg').value;
  const vastutaja_id = document.getElementById('xs-ul-vastutaja').value;
  const teade = document.getElementById('xs-ul-teade');
  if (!tekst) {
    teade.className = 'teade viga'; teade.textContent = 'Kirjuta ülesande tekst'; teade.style.display = 'block';
    return;
  }
  const body = JSON.stringify({ tekst, kategooria, tahtaeg, vastutaja_id });
  const d = xsMuudetavUlesanneId
    ? await api('/api/xseeria/admin/ulesanded/' + xsMuudetavUlesanneId, { method: 'PUT', body })
    : await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/ulesanded', { method: 'POST', body });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  xsTyhistaUlesandeEdit();
  await xsLaadiUlesanded();
}

// ── X-SEERIA: TEGEVUSED (logistika, mitu inimest, kuupäev+kellaaeg) ──
let xsMuudetavTegevusId = null;

function xsJoonistaTegevuseInimesteValik(valitudIds) {
  valitudIds = valitudIds || [];
  const div = document.getElementById('xs-teg-inimesed-valik');
  if (!xsTootajad.length) { div.innerHTML = '<span style="color:var(--hall);font-size:12px">Ühelegi töötajale pole X-seeria ligipääsu lubatud (vt "Töötajad" tab).</span>'; return; }
  div.innerHTML = xsTootajad.map(w => `
    <label style="display:flex;align-items:center;gap:6px;background:var(--bg2);border:0.5px solid ${valitudIds.includes(w.id) ? '#2563eb' : 'var(--sisend-piir)'};border-radius:8px;padding:7px 12px;cursor:pointer;font-size:13px;color:var(--tekst2)">
      <input type="checkbox" value="${w.id}" style="width:auto;margin:0" ${valitudIds.includes(w.id) ? 'checked' : ''}> ${escapeHtmlXs(w.nimi)}
    </label>`).join('');
}

async function xsLaadiTegevused() {
  if (!xsAktiivneEventId) return;
  await xsLaadiTootajaValikud();
  if (!xsMuudetavTegevusId) xsJoonistaTegevuseInimesteValik();
  const d = await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/tegevused');
  const div = document.getElementById('xs-teg-nimekiri');
  if (!d.ok) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Viga laadimisel</div>'; return; }
  if (!d.tegevused.length) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Tegevusi pole veel lisatud.</div>'; return; }
  div.innerHTML = d.tegevused.map(t => {
    const kp = t.kuupaev ? String(t.kuupaev).slice(0,10) : '';
    const kell = t.kellaaeg ? String(t.kellaaeg).slice(0,5) : '';
    const inimesed = (t.inimesed || []).map(p => escapeHtmlXs(p.nimi)).join(', ') || '—';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--piir3)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--tekst)">${escapeHtmlXs(t.tegevus)}</div>
        <div style="font-size:11px;color:var(--hall);margin-top:2px">
          ${kp ? `📅 ${kp}` : ''}${kell ? ' ⏰ ' + kell : ''}${(kp || kell) ? ' · ' : ''}👷 ${inimesed}
        </div>
      </div>
      <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAlustaTegevuseEdit(${JSON.stringify(t).replace(/'/g, "&apos;")})'>✎</button>
      <button class="nupp punane" onclick="xsKustutaTegevus(${t.id})">🗑</button>
    </div>`;
  }).join('');
}

function xsAlustaTegevuseEdit(t) {
  xsMuudetavTegevusId = t.id;
  document.getElementById('xs-teg-tekst').value = t.tegevus;
  document.getElementById('xs-teg-kuupaev').value = t.kuupaev ? String(t.kuupaev).slice(0,10) : '';
  document.getElementById('xs-teg-kellaaeg').value = t.kellaaeg ? String(t.kellaaeg).slice(0,5) : '';
  xsJoonistaTegevuseInimesteValik((t.inimesed || []).map(p => p.id));
  document.getElementById('xs-teg-nupp').textContent = 'Salvesta muudatused';
  document.getElementById('xs-teg-tyhista').style.display = 'inline-block';
  document.getElementById('xs-teg-teade').style.display = 'none';
}

function xsTyhistaTegevuseEdit() {
  xsMuudetavTegevusId = null;
  document.getElementById('xs-teg-tekst').value = '';
  document.getElementById('xs-teg-kuupaev').value = '';
  document.getElementById('xs-teg-kellaaeg').value = '';
  xsJoonistaTegevuseInimesteValik();
  document.getElementById('xs-teg-nupp').textContent = '+ Lisa tegevus';
  document.getElementById('xs-teg-tyhista').style.display = 'none';
}

async function xsLisaTegevus() {
  if (!xsAktiivneEventId) return;
  const tegevus = document.getElementById('xs-teg-tekst').value.trim();
  const kuupaev = document.getElementById('xs-teg-kuupaev').value;
  const kellaaeg = document.getElementById('xs-teg-kellaaeg').value;
  const inimesed = [...document.querySelectorAll('#xs-teg-inimesed-valik input:checked')].map(cb => parseInt(cb.value, 10));
  const teade = document.getElementById('xs-teg-teade');
  if (!tegevus) {
    teade.className = 'teade viga'; teade.textContent = 'Kirjuta tegevuse nimetus'; teade.style.display = 'block';
    return;
  }
  const body = JSON.stringify({ tegevus, kuupaev, kellaaeg, inimesed });
  const d = xsMuudetavTegevusId
    ? await api('/api/xseeria/admin/tegevused/' + xsMuudetavTegevusId, { method: 'PUT', body })
    : await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/tegevused', { method: 'POST', body });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  xsTyhistaTegevuseEdit();
  await xsLaadiTegevused();
}

async function xsKustutaTegevus(id) {
  if (!confirm('Kustutada see tegevus?')) return;
  await api('/api/xseeria/admin/tegevused/' + id, { method: 'DELETE' });
  if (xsMuudetavTegevusId === id) xsTyhistaTegevuseEdit();
  await xsLaadiTegevused();
}

// ── X-SEERIA: SPONSORID ──
// 1) Üldnimekiri (pealehel, "🎁 Sponsorid" nupu taga) — sponsori identiteet: nimi/kontakt/tooted. Globaalne, mitte
//    võistluse külge seotud, kuna sponsorid ei kao etapiga, vaid lisanduvad.
// 2) Per-event staatuse tabel (valitud võistluse lehel) — ainult ootel/käes/tagastatud + kuupäevad SELLE võistluse jaoks.
let xsMuudetavSponsorId = null;

async function xsLaadiSponsoridUldnimekiri() {
  const d = await api('/api/xseeria/admin/sponsorid');
  const div = document.getElementById('xs-sp-uldtabel');
  if (!d.ok) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Viga laadimisel</div>'; return; }
  if (!d.sponsorid.length) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Sponsoreid pole veel lisatud.</div>'; return; }
  div.innerHTML = `<table><thead><tr><th>Sponsor</th><th>Kontakt</th><th>Tooted</th><th></th></tr></thead><tbody>` +
    d.sponsorid.map(s => `<tr>
      <td style="font-weight:600">${escapeHtmlXs(s.nimi)}</td>
      <td style="color:var(--tekst3);font-size:12px">${escapeHtmlXs(s.kontakt || '—')}</td>
      <td style="color:var(--tekst3);font-size:12px">${escapeHtmlXs(s.tooted || '—')}</td>
      <td style="white-space:nowrap">
        <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAlustaSponsorEdit(${JSON.stringify(s).replace(/'/g, "&apos;")})'>✎</button>
        <button class="nupp punane" onclick='xsKustutaSponsor(${s.id}, ${JSON.stringify(s.nimi).replace(/'/g, "&apos;")})'>🗑</button>
      </td>
    </tr>`).join('') + '</tbody></table>';
}

async function xsLaadiSponsoriStaatusTabel() {
  if (!xsAktiivneEventId) return;
  const d = await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/sponsorid');
  const div = document.getElementById('xs-sp-tabel');
  if (!d.ok) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Viga laadimisel</div>'; return; }
  if (!d.sponsorid.length) { div.innerHTML = '<div style="color:var(--hall);font-size:12px">Sponsoreid pole veel lisatud — lisa need pealehel "🎁 Sponsorid" alt.</div>'; return; }
  const staatused = { ootel: 'Ootel', kaes: 'Käes', tagastatud: 'Tagastatud' };
  div.innerHTML = `<table><thead><tr><th>Sponsor</th><th>Staatus</th><th>Järgi kp</th><th>Tagastatud kp</th><th>Kommentaar</th><th>Vastutaja</th><th></th></tr></thead><tbody>` +
    d.sponsorid.map(s => `<tr>
      <td style="font-weight:600">${escapeHtmlXs(s.nimi)}</td>
      <td><select id="xs-sp-staatus-${s.sponsor_id}" style="width:auto;font-size:12px">
        ${Object.entries(staatused).map(([v,l]) => `<option value="${v}" ${s.staatus===v?'selected':''}>${l}</option>`).join('')}
      </select></td>
      <td><input type="date" id="xs-sp-jargi-${s.sponsor_id}" value="${s.jargi_kp ? String(s.jargi_kp).slice(0,10) : ''}" style="font-size:12px;width:auto"></td>
      <td><input type="date" id="xs-sp-tagastatud-${s.sponsor_id}" value="${s.tagastatud_kp ? String(s.tagastatud_kp).slice(0,10) : ''}" style="font-size:12px;width:auto"></td>
      <td><input type="text" id="xs-sp-markused-${s.sponsor_id}" value="${escapeHtmlXs(s.markused || '')}" placeholder="nt too bännerid kontorist" style="font-size:12px;min-width:140px"></td>
      <td><select id="xs-sp-vastutaja-${s.sponsor_id}" style="width:auto;font-size:12px">
        <option value="">— Vastutaja pole —</option>
        ${xsTootajad.map(w => `<option value="${w.id}" ${s.vastutaja_id===w.id?'selected':''}>${w.nimi}</option>`).join('')}
      </select></td>
      <td><button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick="xsUuendaSponsorStaatus(${s.sponsor_id})">💾 Salvesta</button></td>
    </tr>`).join('') + '</tbody></table>';
}

async function xsUuendaSponsorStaatus(sponsorId) {
  if (!xsAktiivneEventId) return;
  const staatus = document.getElementById('xs-sp-staatus-' + sponsorId).value;
  const jargi_kp = document.getElementById('xs-sp-jargi-' + sponsorId).value;
  const tagastatud_kp = document.getElementById('xs-sp-tagastatud-' + sponsorId).value;
  const markused = document.getElementById('xs-sp-markused-' + sponsorId).value;
  const vastutaja_id = document.getElementById('xs-sp-vastutaja-' + sponsorId).value;
  await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/sponsorid/' + sponsorId, {
    method: 'PUT', body: JSON.stringify({ staatus, jargi_kp, tagastatud_kp, markused, vastutaja_id })
  });
  await xsLaadiSponsoriStaatusTabel();
}

function xsAlustaSponsorEdit(s) {
  xsMuudetavSponsorId = s.id;
  document.getElementById('xs-sp-nimi').value = s.nimi;
  document.getElementById('xs-sp-kontakt').value = s.kontakt || '';
  document.getElementById('xs-sp-tooted').value = s.tooted || '';
  document.getElementById('xs-sp-nupp').textContent = 'Salvesta muudatused';
  document.getElementById('xs-sp-tyhista').style.display = 'inline-block';
  document.getElementById('xs-sp-teade').style.display = 'none';
  document.getElementById('xs-sponsorid-paneel').style.display = 'block';
  document.getElementById('xs-sp-nool').textContent = '▲';
  document.getElementById('xs-sp-nimi').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function xsTyhistaSponsorEdit() {
  xsMuudetavSponsorId = null;
  document.getElementById('xs-sp-nimi').value = '';
  document.getElementById('xs-sp-kontakt').value = '';
  document.getElementById('xs-sp-tooted').value = '';
  document.getElementById('xs-sp-nupp').textContent = '+ Lisa sponsor üldnimekirja';
  document.getElementById('xs-sp-tyhista').style.display = 'none';
}

async function xsLisaSponsor() {
  const nimi = document.getElementById('xs-sp-nimi').value.trim();
  const kontakt = document.getElementById('xs-sp-kontakt').value.trim();
  const tooted = document.getElementById('xs-sp-tooted').value.trim();
  const teade = document.getElementById('xs-sp-teade');
  if (!nimi) {
    teade.className = 'teade viga'; teade.textContent = 'Sponsori nimi on kohustuslik'; teade.style.display = 'block';
    return;
  }
  const body = JSON.stringify({ nimi, kontakt, tooted });
  const d = xsMuudetavSponsorId
    ? await api('/api/xseeria/admin/sponsorid/' + xsMuudetavSponsorId, { method: 'PUT', body })
    : await api('/api/xseeria/admin/sponsorid', { method: 'POST', body });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  xsTyhistaSponsorEdit();
  await xsLaadiSponsoridUldnimekiri();
  if (xsAktiivneEventId) await xsLaadiSponsoriStaatusTabel();
}

async function xsKustutaSponsor(sponsorId, nimi) {
  if (!confirm(`Kustutada sponsor "${nimi}" TÄIELIKULT üldnimekirjast (kõigi võistluste alt)?`)) return;
  await api('/api/xseeria/admin/sponsorid/' + sponsorId, { method: 'DELETE' });
  if (xsMuudetavSponsorId === sponsorId) xsTyhistaSponsorEdit();
  await xsLaadiSponsoridUldnimekiri();
  if (xsAktiivneEventId) await xsLaadiSponsoriStaatusTabel();
}

// ── X-SEERIA: KULUDE RAPORT (toode, kogus, hind) ──
let xsMuudetavKuluId = null;

function xsFmtEur(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
}

async function xsLaadiKulud() {
  if (!xsAktiivneEventId) return;
  const [d, o] = await Promise.all([
    api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/kulud'),
    api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/minu-kulud')
  ]);
  const div = document.getElementById('xs-kulu-tabel');
  const omaDiv = document.getElementById('xs-omakulu-tabel');
  const kokkuEl = document.getElementById('xs-kulu-kokku-summa');
  if (!d.ok) {
    div.innerHTML = '<div style="color:var(--hall);font-size:12px">Viga laadimisel</div>';
    if (kokkuEl) kokkuEl.textContent = xsFmtEur(0);
    return;
  }
  const omaKulud = (o && o.ok && o.kulud) ? o.kulud : [];
  const omaKokku = omaKulud.reduce((s, k) => s + parseFloat(k.summa), 0);
  if (kokkuEl) kokkuEl.textContent = xsFmtEur(Number(d.kokkuSumma) + omaKokku);
  const makstudBoxEl = document.getElementById('xs-kulu-makstud-box');
  if (makstudBoxEl) {
    const makstud = Number(d.kokkuMakstud || 0);
    const maksmata = Number(d.kokkuMaksmata || 0) + omaKokku;
    makstudBoxEl.innerHTML = `<span style="color:#4ade80">✅ Makstud: ${xsFmtEur(makstud)}</span> · <span style="color:#f87171">⏳ Maksmata: ${xsFmtEur(maksmata)}</span>`;
  }
  div.innerHTML = d.kulud.length
    ? `<table><thead><tr><th>Toode</th><th>Kogus</th><th>Hind/tk</th><th>Kokku</th><th>Makstud</th><th></th></tr></thead><tbody>` +
      d.kulud.map(k => `<tr${k.makstud ? ' style="background:rgba(74,222,128,0.08)"' : ''}>
        <td style="font-weight:600">${escapeHtmlXs(k.toode)}</td>
        <td>${k.kogus}</td>
        <td>${xsFmtEur(Number(k.hind))}</td>
        <td style="font-weight:600">${xsFmtEur(k.kokku)}</td>
        <td><input type="checkbox" ${k.makstud ? 'checked' : ''} onchange="xsLulitaKuluMakstud(${k.id}, this.checked)" style="width:auto;accent-color:#16a34a;cursor:pointer"></td>
        <td style="white-space:nowrap">
          <button class="nupp hall" style="padding:5px 10px;font-size:12px" onclick='xsAlustaKuluEdit(${JSON.stringify(k).replace(/'/g, "&apos;")})'>✎</button>
          <button class="nupp punane" onclick="xsKustutaKulu(${k.id})">🗑</button>
        </td>
      </tr>`).join('') + '</tbody></table>'
    : '<div style="color:var(--hall);font-size:12px">Kulusid pole veel lisatud.</div>';
  if (!omaDiv) return;
  if (!omaKulud.length) { omaDiv.innerHTML = '<div style="color:var(--hall);font-size:12px">Töötajad pole veel kulusid lisanud.</div>'; return; }
  const omaMakstud = omaKulud.filter(k => k.makstud).reduce((s, k) => s + parseFloat(k.summa), 0);
  omaDiv.innerHTML = `<table><thead><tr><th>Töötaja</th><th>Kuupäev</th><th>Selgitus</th><th>Summa</th><th>Tasutud</th><th></th></tr></thead><tbody>` +
    omaKulud.map(k => `<tr${k.makstud ? ' style="background:rgba(74,222,128,0.08)"' : ''}>
      <td style="font-weight:600">${escapeHtmlXs(k.worker_nimi)}</td>
      <td>${formatKp(k.kuupaev)}</td>
      <td>${escapeHtmlXs(k.selgitus)}</td>
      <td style="font-weight:600;color:#4ade80">${xsFmtEur(Number(k.summa))}</td>
      <td><input type="checkbox" ${k.makstud ? 'checked' : ''} onchange="xsLulitaOmakuluMakstud(${k.id}, this.checked)" style="width:auto;accent-color:#16a34a;cursor:pointer"></td>
      <td style="white-space:nowrap">${k.foto_url ? `<a href="${k.foto_url}" target="_blank" style="font-size:11px;color:#818cf8">📷 tšekk</a>` : ''}</td>
    </tr>`).join('') +
    `<tr style="font-weight:700;border-top:0.5px solid var(--piir2)"><td colspan="3">Kokku</td><td style="color:#4ade80">${xsFmtEur(omaKokku)}</td><td style="font-size:11px;color:var(--hall);font-weight:400">tasutud ${xsFmtEur(omaMakstud)}</td><td></td></tr>` +
    '</tbody></table>';
}

async function xsLulitaOmakuluMakstud(id, makstud) {
  await api('/api/xseeria/admin/omakulud/' + id + '/makstud', { method: 'PUT', body: JSON.stringify({ makstud }) });
  await xsLaadiKulud();
}

async function xsLulitaKuluMakstud(id, makstud) {
  await api('/api/xseeria/admin/kulud/' + id + '/makstud', { method: 'PUT', body: JSON.stringify({ makstud }) });
  await xsLaadiKulud();
}

function xsAlustaKuluEdit(k) {
  xsMuudetavKuluId = k.id;
  document.getElementById('xs-kulu-toode').value = k.toode;
  document.getElementById('xs-kulu-kogus').value = k.kogus;
  document.getElementById('xs-kulu-hind').value = k.hind;
  document.getElementById('xs-kulu-makstud').checked = !!k.makstud;
  document.getElementById('xs-kulu-nupp').textContent = 'Salvesta muudatused';
  document.getElementById('xs-kulu-tyhista').style.display = 'inline-block';
  document.getElementById('xs-kulu-teade').style.display = 'none';
}

function xsTyhistaKuluEdit() {
  xsMuudetavKuluId = null;
  document.getElementById('xs-kulu-toode').value = '';
  document.getElementById('xs-kulu-kogus').value = '1';
  document.getElementById('xs-kulu-hind').value = '0';
  document.getElementById('xs-kulu-makstud').checked = false;
  document.getElementById('xs-kulu-nupp').textContent = '+ Lisa kulu';
  document.getElementById('xs-kulu-tyhista').style.display = 'none';
}

async function xsLisaKulu() {
  if (!xsAktiivneEventId) return;
  const toode = document.getElementById('xs-kulu-toode').value.trim();
  const kogus = parseFloat(document.getElementById('xs-kulu-kogus').value) || 1;
  const hind = parseFloat(document.getElementById('xs-kulu-hind').value) || 0;
  const makstud = document.getElementById('xs-kulu-makstud').checked;
  const teade = document.getElementById('xs-kulu-teade');
  if (!toode) {
    teade.className = 'teade viga'; teade.textContent = 'Kirjuta toote nimi'; teade.style.display = 'block';
    return;
  }
  const body = JSON.stringify({ toode, kogus, hind, makstud });
  const d = xsMuudetavKuluId
    ? await api('/api/xseeria/admin/kulud/' + xsMuudetavKuluId, { method: 'PUT', body })
    : await api('/api/xseeria/admin/events/' + xsAktiivneEventId + '/kulud', { method: 'POST', body });
  if (!d.ok) {
    teade.className = 'teade viga'; teade.textContent = d.veateade || 'Viga'; teade.style.display = 'block';
    return;
  }
  teade.style.display = 'none';
  xsTyhistaKuluEdit();
  await xsLaadiKulud();
}

async function xsKustutaKulu(id) {
  if (!confirm('Kustutada see kulurida?')) return;
  await api('/api/xseeria/admin/kulud/' + id, { method: 'DELETE' });
  if (xsMuudetavKuluId === id) xsTyhistaKuluEdit();
  await xsLaadiKulud();
}

