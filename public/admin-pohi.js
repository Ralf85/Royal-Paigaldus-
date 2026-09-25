// admin-pohi.js — PÕHI: api(), teema, menüü, ettevõtte lehed, kokkuvõte, töötajad, Merekohvik.
// NB! Peab laadima enne admin-moodulid.js ja admin-arved.js faile.
const KUUD = ['Jaanuar','Veebruar','Märts','Aprill','Mai','Juuni','Juuli','August','September','Oktoober','November','Detsember'];
let kõikEttevotted = [];
let TOKEN = localStorage.getItem('adminToken') || '';
setInterval(() => { TOKEN = localStorage.getItem('adminToken') || TOKEN; }, 30000);

// ── TÖÖTAJATE VÄRVID (konsistentne värv iga töötaja jaoks, kasutusel graafikus + Kokkuvõttes) ──
const TOOTAJA_VARVID = ['#f97316','#22c55e','#3b82f6','#ec4899','#eab308','#14b8a6','#f43f5e','#a855f7','#06b6d4','#84cc16','#fb7185','#38bdf8'];
function tootajaVarv(id) {
  const n = parseInt(id, 10);
  const i = Number.isFinite(n) ? Math.abs(n) : 0;
  return TOOTAJA_VARVID[i % TOOTAJA_VARVID.length];
}
function tootajaVarvRgb(id) {
  const hex = tootajaVarv(id).replace('#','');
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)].join(',');
}

// ── TEEMA ────────────────────────────────────────────────────────
function setTeema(teema) {
  document.body.className = 'teema-' + teema;
  localStorage.setItem('adminTeema', teema);
  document.querySelectorAll('.teema-nupp').forEach(b => b.classList.remove('ak'));
  const ak = document.querySelector('.teema-nupp.' + teema);
  if (ak) ak.classList.add('ak');
}
function vahetaTeema() {
  const uus = document.body.classList.contains('teema-tume') ? 'valge' : 'tume';
  setTeema(uus);
}

// ── KASUTAJA MENÜÜ (topbar paremal) ────────────────────────────────
function toggleKasutajaMenuu() {
  document.getElementById('kasutaja-dropdown')?.classList.toggle('avatud');
}
document.addEventListener('click', (e) => {
  const menuu = document.querySelector('.kasutaja-menuu');
  const dropdown = document.getElementById('kasutaja-dropdown');
  if (menuu && dropdown && !menuu.contains(e.target)) dropdown.classList.remove('avatud');
});
(function() {
  // Ainult 2 teemat on nüüd toetatud (hele/tume) — vana salvestatud 'sinine' teema
  // (kolmas, eemaldatud variant) asendub vaikimisi tumeda teemaga.
  let salvestatud = localStorage.getItem('adminTeema') || 'tume';
  if (salvestatud !== 'tume' && salvestatud !== 'valge') salvestatud = 'tume';
  setTeema(salvestatud);
})();

async function api(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['x-session-token'] = TOKEN;
  if (!(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
  }
  let r;
  try {
    r = await fetch(url, opts);
  } catch (networkErr) {
    return { ok: false, veateade: 'Võrguviga: ' + networkErr.message };
  }
  const token = r.headers.get('x-session-token');
  if (token) { TOKEN = token; localStorage.setItem('adminToken', token); }
  try {
    return await r.json();
  } catch (parseErr) {
    // Server ei vastanud JSON-iga (nt endpoint puudub veel serveris, või serveri viga) —
    // varem lasi see vea "vaikselt" katki minna ja terve leht jäi hanguma; nüüd anname selge teate.
    return { ok: false, veateade: `Serveri vastust ei õnnestunud lugeda (HTTP ${r.status}). Kontrolli, kas kõik failid said üles laetud ja Railway on "Active".` };
  }
}

const tabid = document.querySelectorAll('.tab');
const sektsioonid = document.querySelectorAll('.sektsioon');
const TAB_PEALKIRJAD = ['Kokkuvõte','Maksed','Töötajad','Objektid','Tulevased tööd','Fotod','Logi','Raportid','Graafik','Projektid','','X-seeria','Arved'];
const ETTEVOTE_GRUPP_ID = { CRAMO: 'grupp-cramo', LIDL: 'grupp-lidl', MUU: 'grupp-muu', MEREKOHVIK: 'grupp-merekohvik' };
const ESITUSHIND_ETTEVOTE = { CRAMO: 25, LIDL: 27 };
let avEttevoteAktiivneNimi = null;

function avEttevoteHub(gruppId, nimi) {
  avaSidebarGrupp(gruppId);
  avaFiltreeritudTab(10, nimi);
}

// ── ETTEVÕTTE LEHT (Cramo/Lidl/Merekohvik/Muu) ────────────────────────────
// Üks koondvaade ettevõtte kohta: DATA (kuupõhine töö tundides+rahas, mis läheb arveks —
// Merekohviku puhul SumUp käive), Objektid, Tulevased tööd ja Arved. Vältimaks 3-4 eraldi
// tabi klikkimist, nagu raamatupidaja soovis.
// ── Lidl projektid (fotode kaustastruktuur) — halduspaneel ettevõtte lehel ──
let lpProjektid = [];
async function lpLaadi() {
  const div = document.getElementById('lp-nimekiri');
  div.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Laadimine...</div>';
  const r = await api('/api/kristo/admin/projektid');
  lpProjektid = (r && r.ok && Array.isArray(r.projektid)) ? r.projektid : [];
  if (!lpProjektid.length) {
    div.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Projekte pole veel lisatud</div>';
    await lpLaadiVanad();
    return;
  }
  div.innerHTML = lpProjektid.map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--piir)">
      <span style="flex:1;font-size:13px;${p.aktiivne ? '' : 'color:var(--hall);text-decoration:line-through'}">${p.nimi}</span>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--hall);cursor:pointer">
        <input type="checkbox" ${p.aktiivne ? 'checked' : ''} onchange="lpToggleAktiivne(${p.id}, this.checked)"> aktiivne
      </label>
      <button type="button" class="nupp hall" style="padding:4px 10px;font-size:11px" onclick="lpMuudaNimi(${p.id}, '${p.nimi.replace(/'/g, "\\'")}')">✏️</button>
    </div>
  `).join('');
  await lpLaadiVanad();
}
async function lpLisaProjekt() {
  const input = document.getElementById('lp-uus-nimi');
  const nimi = input.value.trim();
  if (!nimi) return;
  const r = await api('/api/kristo/admin/projektid', { method: 'POST', body: JSON.stringify({ nimi }) });
  if (r && r.ok) { input.value = ''; await lpLaadi(); }
  else alert((r && r.veateade) || 'Viga lisamisel');
}
async function lpToggleAktiivne(id, aktiivne) {
  await api(`/api/kristo/admin/projektid/${id}`, { method: 'PUT', body: JSON.stringify({ aktiivne }) });
  await lpLaadi();
}
async function lpMuudaNimi(id, vanaNimi) {
  const uus = prompt('Uus nimi:', vanaNimi);
  if (!uus || !uus.trim() || uus.trim() === vanaNimi) return;
  const r = await api(`/api/kristo/admin/projektid/${id}`, { method: 'PUT', body: JSON.stringify({ nimi: uus.trim() }) });
  if (r && r.ok) await lpLaadi();
  else alert((r && r.veateade) || 'Viga muutmisel');
}
let lpVanad = [];
async function lpLaadiVanad() {
  const div = document.getElementById('lp-vanad');
  div.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Laadimine...</div>';
  const r = await api('/api/kristo/admin/vanad-kirjeldused');
  const list = (r && r.ok && Array.isArray(r.kirjeldused)) ? r.kirjeldused : [];
  lpVanad = list;
  if (!list.length) {
    div.innerHTML = '<div style="padding:14px;text-align:center;color:var(--hall);font-size:12px">Kõik fotod on juba projektide alla määratud 🎉</div>';
    return;
  }
  if (!lpProjektid.length) {
    div.innerHTML = '<div style="padding:14px;text-align:center;color:var(--hall);font-size:12px">Lisa enne vähemalt üks projekt ülalt, siis saad siin fotod selle alla määrata.</div>';
    return;
  }
  const valikud = lpProjektid.map(p => `<option value="${p.id}">${p.nimi}</option>`).join('');
  // Hulgi määramine: sama töö on sageli kirjas mitme erineva vabatekstina (trükivead, lisatud märkused).
  // Linnukestega saab need korraga ühe projekti alla koondada, ilma iga rida eraldi klikkimata.
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:10px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tekst2);cursor:pointer">
        <input type="checkbox" onchange="lpValiKoikVanad(this.checked)" style="width:auto"> Vali kõik
      </label>
      <span style="font-size:12px;color:var(--hall)">→ määra korraga:</span>
      <select id="lp-bulk-projekt" style="font-size:12px;padding:5px 8px;width:auto">
        <option value="">— vali projekt —</option>${valikud}
      </select>
      <button type="button" class="nupp kull" style="padding:5px 12px;font-size:11px" onclick="lpMaaraValitud()">Määra valitud</button>
      <span id="lp-bulk-teade" style="font-size:12px;color:var(--hall)"></span>
    </div>
  ` + list.map((k, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid var(--piir);flex-wrap:wrap">
      <input type="checkbox" class="lp-vana-cb" value="${i}" style="width:auto;flex-shrink:0">
      <div style="flex:1;min-width:160px">
        <div style="font-size:13px;color:var(--tekst)">${escapeHtmlXs(k.kirjeldus)}</div>
        <div style="font-size:11px;color:var(--hall)">${k.piltide_arv} pilti · ${k.poode_arv} pood${k.poode_arv==1?'':'i'} (${escapeHtmlXs(k.poed)})</div>
      </div>
      <select id="lp-vana-sihtmark-${i}" style="font-size:12px;padding:5px 8px">
        <option value="">— vali projekt —</option>
        ${valikud}
      </select>
      <button type="button" class="nupp kull" style="padding:5px 12px;font-size:11px" onclick="lpMaaraVanaProjekt(${i})">Määra</button>
    </div>
  `).join('');
}

function lpValiKoikVanad(checked) {
  document.querySelectorAll('.lp-vana-cb').forEach(cb => cb.checked = checked);
}

// NB: varem anti kirjeldus onclick-atribuudi sisse JSON.stringify'ga — see tekitas jutumärgid
// juba jutumärkides oleva atribuudi sisse, HTML läks katki ja nupp ei teinud midagi.
// Nüüd anname edasi ainult rea indeksi ja loeme teksti lpVanad massiivist.
async function lpMaaraVanaProjekt(i) {
  const kirje = lpVanad[i];
  if (!kirje) { alert('Kirjeldust ei leitud — laadi leht uuesti'); return; }
  const sel = document.getElementById('lp-vana-sihtmark-' + i);
  const projektId = sel ? sel.value : '';
  if (!projektId) { alert('Vali enne projekt'); return; }
  const r = await api('/api/kristo/kirjeldus/maara-projekt', { method: 'PUT', body: JSON.stringify({ kirjeldus: kirje.kirjeldus, projekt_id: projektId }) });
  if (r && r.ok) {
    alert(`✅ ${r.muudetud} kirjet ümber määratud`);
    await lpLaadiVanad();
  } else {
    alert((r && r.veateade) || 'Viga ümbermääramisel');
  }
}

async function lpMaaraValitud() {
  const projektId = document.getElementById('lp-bulk-projekt').value;
  const teade = document.getElementById('lp-bulk-teade');
  if (!projektId) { alert('Vali enne projekt, kuhu valitud read koondada'); return; }
  const valitud = [...document.querySelectorAll('.lp-vana-cb:checked')].map(cb => lpVanad[parseInt(cb.value, 10)]).filter(Boolean);
  if (!valitud.length) { alert('Vali vähemalt üks rida'); return; }
  if (!confirm(`Koondad ${valitud.length} kirjeldust ühe projekti alla? Seda ei saa tagasi võtta.`)) return;
  let kokku = 0, vigu = 0;
  for (let n = 0; n < valitud.length; n++) {
    if (teade) teade.textContent = `Määran ${n + 1}/${valitud.length}...`;
    const r = await api('/api/kristo/kirjeldus/maara-projekt', { method: 'PUT', body: JSON.stringify({ kirjeldus: valitud[n].kirjeldus, projekt_id: projektId }) });
    if (r && r.ok) kokku += (r.muudetud || 0); else vigu++;
  }
  if (teade) teade.textContent = '';
  alert(`✅ ${kokku} kirjet ümber määratud` + (vigu ? ` · ${vigu} rida ebaõnnestus` : ''));
  await lpLaadiVanad();
}

// ── KRISTO KOMMENTAARID (Lidl fotovaate teavitused) ───────────────────────
let kkViimaneArv = 0;
let kkTeavitusiLubatud = false;
async function kkLaadi() {
  const div = document.getElementById('kk-nimekiri');
  const naitaLahendatud = document.getElementById('kk-naita-lahendatud').checked;
  div.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Laadimine...</div>';
  const r = await api('/api/kristo/admin/kommentaarid');
  let list = (r && r.ok && Array.isArray(r.kommentaarid)) ? r.kommentaarid : [];
  if (!naitaLahendatud) list = list.filter(k => !k.lahendatud);
  document.getElementById('kk-kaart-arv').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    div.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Kommentaare pole' + (naitaLahendatud ? '' : ' lahendamata') + '</div>';
  } else {
    div.innerHTML = list.map(k => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:0.5px solid var(--piir2);${k.lahendatud ? 'opacity:0.55' : ''}">
        <div style="flex:1">
          <div style="font-size:12px;color:var(--hall);margin-bottom:2px">🏬 ${k.objekt_nimi} · ${k.kirjeldus}</div>
          <div style="font-size:13px">${(k.tekst || '').replace(/</g,'&lt;')}</div>
          <div style="font-size:11px;color:var(--hall);margin-top:4px">${new Date(k.loodud).toLocaleString('et-EE')}${k.lahendatud ? ' · ✅ lahendatud' : ''}</div>
        </div>
        ${!k.lahendatud ? `<button type="button" class="nupp roheline" style="padding:5px 10px;font-size:11px;white-space:nowrap" onclick="kkMargiLahendatuks(${k.id})">✅ Lahendatud</button>` : `<button type="button" class="nupp hall" style="padding:5px 10px;font-size:11px;white-space:nowrap" onclick="kkKustuta(${k.id})">🗑</button>`}
      </div>
    `).join('');
  }
  // Kristo panelist vaadatuna loeme kõik lugemata kommentaarid loetuks — punane märk kaob.
  await api('/api/kristo/admin/kommentaarid/loe-koik', { method: 'PUT' });
  kkUuendaArv();
}
async function kkMargiLahendatuks(id) {
  await api(`/api/kristo/admin/kommentaarid/${id}/lahendatud`, { method: 'PUT' });
  await kkLaadi();
}
async function kkKustuta(id) {
  if (!confirm('Kustutada see kommentaar?')) return;
  await api(`/api/kristo/admin/kommentaarid/${id}`, { method: 'DELETE' });
  await kkLaadi();
}
function kkAvaPaneel() {
  avEttevoteHub('grupp-lidl', 'LIDL');
  setTimeout(() => {
    const el = document.getElementById('kk-kaart');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, 200);
}
function kkLubaTeavitused() {
  if (!('Notification' in window)) { alert('Sinu brauser ei toeta teavitusi'); return; }
  Notification.requestPermission().then(p => {
    kkTeavitusiLubatud = (p === 'granted');
    alert(kkTeavitusiLubatud ? 'Teavitused lubatud ✅' : 'Teavitused pole lubatud');
  });
}
async function kkUuendaArv() {
  const r = await api('/api/kristo/admin/kommentaarid/arv');
  const arv = (r && r.ok) ? r.arv : 0;
  const badge = document.getElementById('kk-badge');
  if (arv > 0) { badge.style.display = 'block'; badge.textContent = arv > 99 ? '99+' : arv; }
  else { badge.style.display = 'none'; }
  document.title = arv > 0 ? `🔴 (${arv}) Admin — Royal Paigaldus` : 'Admin — Royal Paigaldus';
  if (kkTeavitusiLubatud && 'Notification' in window && arv > kkViimaneArv && kkViimaneArv !== 0) {
    new Notification('💬 Uus kommentaar Lidl Eesti vaates', { body: 'Royal Paigaldus adminnis on uus lugemata kommentaar.' });
  }
  kkViimaneArv = arv;
}
setInterval(kkUuendaArv, 45000);

// Ettevõtte lehe "Töötajad" plokk — kes on antud perioodil (Cramo: jooksev kuu, Lidl: alates
// viimasest arvest) sellele ettevõttele tunde teinud, koos avatava töökirjete nimekirjaga
// (sama ▾ muster mis Kokkuvõtte tabelis) — et ei peaks selle jaoks eraldi tabi avama.
function renderEttevoteTootajad(rowList, esitusHind) {
  const kaart = document.getElementById('et-tootajad-kaart');
  const sisu = document.getElementById('et-tootajad-sisu');
  kaart.style.display = '';
  if (!rowList.length) {
    sisu.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Selle perioodi kohta töökirjeid pole</div>';
    return;
  }
  const perWorker = {};
  rowList.forEach(r => {
    const id = r.worker_id || r.worker_nimi;
    if (!perWorker[id]) perWorker[id] = { id, nimi: r.worker_nimi, tunnid: 0, rows: [] };
    perWorker[id].tunnid += parseFloat(r.tunnid) || 0;
    perWorker[id].rows.push(r);
  });
  const workers = Object.values(perWorker).sort((a, b) => b.tunnid - a.tunnid);
  const kolonniArv = esitusHind ? 4 : 3;
  let html = `<div style="background:var(--bg2);border:0.5px solid var(--piir);border-radius:var(--radius-kaart);overflow:hidden">
    <table><thead><tr style="border-bottom:0.5px solid var(--piir2)">
      <th>Töötaja</th><th style="text-align:right">Tunnid</th>${esitusHind ? '<th style="text-align:right">Summa (km-ga)</th>' : ''}<th></th>
    </tr></thead><tbody>`;
  workers.forEach(w => {
    const safeId = 'et-tj-' + String(w.id).replace(/\s/g, '_');
    const summa = esitusHind ? (w.tunnid * esitusHind * 1.24) : 0;
    const vc = tootajaVarv(w.id);
    html += `<tr id="worker-rida-${safeId}">
      <td style="font-weight:600"><span class="tabel-avatar" style="background:${vc}">${w.nimi[0]}</span>${w.nimi}</td>
      <td style="text-align:right;color:#5b9cf6">${w.tunnid.toFixed(1)} h</td>
      ${esitusHind ? `<td style="text-align:right;color:#4ade80">${summa.toFixed(2)} €</td>` : ''}
      <td style="text-align:right"><button class="av-tegevus-ikoon" id="kirjed-chevron-${safeId}" onclick="toggleKirjed('${safeId}')" title="Näita töökirjeid"><span class="tj-arhiiv-chevron">▾</span></button></td>
    </tr>
    <tr id="kirjed-${safeId}" style="display:none"><td colspan="${kolonniArv}" style="padding:0 0 8px 0">
      <div style="margin:4px 14px;background:var(--bg3);border-radius:8px;overflow:hidden">
        ${w.rows.map(k => `<div style="display:flex;gap:10px;align-items:center;padding:7px 12px;border-bottom:0.5px solid var(--piir3);font-size:12px">
          <span style="color:var(--hall);min-width:80px">${formatKp(k.kuupaev)}</span>
          <span style="color:var(--tekst3)">${k.objekt_nimi || '—'}</span>
          <span style="color:var(--tekst3)">${(k.algus || '').slice(0,5)}–${(k.lopp || '').slice(0,5)}</span>
          <span style="color:#2563eb;font-weight:600">${parseFloat(k.tunnid).toFixed(1)}h</span>
          ${k.kommentaar ? `<span style="color:var(--hall)">${k.kommentaar}</span>` : ''}
        </div>`).join('')}
      </div>
    </td></tr>`;
  });
  html += '</tbody></table></div>';
  sisu.innerHTML = html;
}

async function laadiEttevoteLeht(nimi) {
  if (!nimi) return;
  avEttevoteAktiivneNimi = nimi;
  const N = nimi.toUpperCase();
  const e = (kõikEttevotted || []).find(x => (x.nimi || '').toUpperCase() === N);

  document.getElementById('et-objektid-nupp').onclick = () => avaFiltreeritudTab(3, nimi);
  document.getElementById('et-tulevased-nupp').onclick = () => avaFiltreeritudTab(4, nimi);

  // ── Lidl projektid (ainult LIDL ettevõtte lehel) ──
  const lpKaart = document.getElementById('et-lidl-projektid-kaart');
  const kkKaart = document.getElementById('kk-kaart');
  if (N === 'LIDL') {
    lpKaart.style.display = '';
    lpLaadi();
    kkKaart.style.display = '';
    kkLaadi();
  } else {
    lpKaart.style.display = 'none';
    kkKaart.style.display = 'none';
  }

  // ── DATA ──
  const dataPealkiriEl = document.getElementById('et-data-pealkiri');
  const dataSisuEl = document.getElementById('et-data-sisu');
  const tootajadKaartEl = document.getElementById('et-tootajad-kaart');
  tootajadKaartEl.style.display = 'none';
  if (N === 'MEREKOHVIK') {
    dataPealkiriEl.textContent = '📊 DATA — Merekohviku käive (SumUp)';
    const arved = await api('/api/arved');
    const list = (Array.isArray(arved) ? arved : [])
      .filter(a => (a.ostja_nimi || '').toUpperCase() === 'MEREKOHVIK')
      .sort((a, b) => new Date(b.kuupaev) - new Date(a.kuupaev))
      .slice(0, 6);
    dataSisuEl.innerHTML = list.length
      ? '<table><thead><tr><th>Periood</th><th style="text-align:right">Käive brutos</th><th style="text-align:right">Käibemaks</th></tr></thead><tbody>' +
        list.map(a => `<tr><td>${formatKp(a.algus || a.kuupaev)} – ${formatKp(a.lopp || a.kuupaev)}</td><td style="text-align:right">${parseFloat(a.kokku).toFixed(2)} €</td><td style="text-align:right;color:#4ade80">${parseFloat(a.kaibemaks).toFixed(2)} €</td></tr>`).join('') +
        '</tbody></table>'
      : '<div style="padding:16px;text-align:center;color:var(--hall)">SumUp käibekirjeid pole veel lisatud — vt Arved → SumUp aruanne</div>';
  } else if (N === 'LIDL') {
    // Lidl ei ole kuupõhine — arveid esitatakse ebaregulaarselt, seega DATA loeb alati
    // alates viimasest esitatud arvest (selle arve arveldatud perioodi lõpust +1 päev), mitte
    // kalendrikuust. Nii on kohe näha, kui palju on juba tehtud tööd, mis on veel arveldamata.
    dataPealkiriEl.textContent = `📊 DATA — ${nimi} (alates viimasest arvest)`;
    if (!e) {
      dataSisuEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Ettevõtet ei leitud</div>';
    } else {
      const esitusHind = ESITUSHIND_ETTEVOTE[N] || 0;
      const koikArvedLidl = await api('/api/arved');
      const lidlArved = (Array.isArray(koikArvedLidl) ? koikArvedLidl : [])
        .filter(a => a.ettevote_id === e.id || (a.ostja_nimi || '').toUpperCase() === N)
        .sort((a, b) => new Date(b.kuupaev) - new Date(a.kuupaev));
      const viimaneArve = lidlArved[0] || null;
      let algusD;
      if (viimaneArve) {
        algusD = new Date(viimaneArve.lopp || viimaneArve.kuupaev);
        algusD.setDate(algusD.getDate() + 1);
      } else {
        algusD = new Date(2020, 0, 1);
      }
      const algus = algusD.toISOString().split('T')[0];
      const lopp = new Date().toISOString().split('T')[0];
      const rows = await api(`/api/admin/raport-filter?ettevote_id=${e.id}&algus=${algus}&lopp=${lopp}`);
      const rowList = Array.isArray(rows) ? rows : [];
      const tunnid = rowList.reduce((s, r) => s + (parseFloat(r.tunnid) || 0), 0);
      const summa = esitusHind ? tunnid * esitusHind * 1.24 : 0;
      dataSisuEl.innerHTML =
        `<div style="padding:10px 16px;font-size:12px;color:var(--hall)">${viimaneArve ? `Loetud alates viimasest arvest — ${viimaneArve.number} (${formatKp(viimaneArve.kuupaev)}) · <b style="color:var(--tekst2)">Arveldamata tööd alates ${formatKp(algus)}</b>` : 'Arveid pole veel esitatud — loetud algusest peale'}</div>` +
        '<table><tbody>' +
        `<tr><td>Tunnid (veel arveldamata)</td><td style="text-align:right">${tunnid.toFixed(1)}h</td></tr>` +
        (esitusHind ? `<tr><td>Summa (km-ga, veel saada)</td><td style="text-align:right;color:#4ade80;font-weight:600">${summa.toFixed(2)} €</td></tr>` : '') +
        '</tbody></table>';
      document.getElementById('et-tootajad-pealkiri').textContent = '👷 Töötajad (alates viimasest arvest)';
      renderEttevoteTootajad(rowList, esitusHind);
    }
  } else {
    dataPealkiriEl.textContent = `📊 DATA — ${nimi} kuupõhine töö`;
    if (!e) {
      dataSisuEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">Ettevõtet ei leitud</div>';
    } else {
      const esitusHind = ESITUSHIND_ETTEVOTE[N] || 0;
      const t = new Date();
      const kuud = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
        kuud.push({ aasta: d.getFullYear(), kuu: d.getMonth() + 1, nimi: KUUD[d.getMonth()] });
      }
      const tulemused = await Promise.all(kuud.map(k => {
        const algus = `${k.aasta}-${String(k.kuu).padStart(2, '0')}-01`;
        const lopp = new Date(k.aasta, k.kuu, 0).toISOString().split('T')[0];
        return api(`/api/admin/raport-filter?ettevote_id=${e.id}&algus=${algus}&lopp=${lopp}`);
      }));
      let html = '<table><thead><tr><th>Kuu</th><th style="text-align:right">Tunnid</th>' + (esitusHind ? '<th style="text-align:right">Summa (km-ga, tuleb arveks)</th>' : '') + '</tr></thead><tbody>';
      kuud.forEach((k, i) => {
        const rows = Array.isArray(tulemused[i]) ? tulemused[i] : [];
        const tunnid = rows.reduce((s, r) => s + (parseFloat(r.tunnid) || 0), 0);
        const summa = esitusHind ? tunnid * esitusHind * 1.24 : 0;
        html += `<tr><td>${k.nimi} ${k.aasta}</td><td style="text-align:right">${tunnid.toFixed(1)}h</td>` + (esitusHind ? `<td style="text-align:right;color:#4ade80">${summa.toFixed(2)} €</td>` : '') + '</tr>';
      });
      html += '</tbody></table>';
      dataSisuEl.innerHTML = html;
      document.getElementById('et-tootajad-pealkiri').textContent = `👷 Töötajad — ${kuud[0].nimi} ${kuud[0].aasta}`;
      renderEttevoteTootajad(Array.isArray(tulemused[0]) ? tulemused[0] : [], esitusHind);
    }
  }

  // ── OBJEKTID ──
  const objektidSisuEl = document.getElementById('et-objektid-sisu');
  if (e) {
    const objektid = await api(`/api/tood/objektid/${e.id}`);
    const list = Array.isArray(objektid) ? objektid.filter(o => o.aktiivne !== false) : [];
    objektidSisuEl.innerHTML = list.length
      ? list.slice(0, 8).map(o => `<div style="padding:8px 0;border-bottom:0.5px solid var(--piir3);font-size:13px">🏗️ ${o.nimi}</div>`).join('')
      : '<div style="padding:16px;text-align:center;color:var(--hall)">Objekte pole</div>';
  } else {
    objektidSisuEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall)">—</div>';
  }

  // ── TULEVASED TÖÖD ──
  const tulevasedSisuEl = document.getElementById('et-tulevased-sisu');
  const tulevased = await api('/api/tood/tulevased');
  const taana = new Date(); taana.setHours(0, 0, 0, 0);
  const tList = (Array.isArray(tulevased) ? tulevased : [])
    .filter(t => (t.ettevote_nimi || '').toUpperCase() === N && new Date(t.kuupaev) >= taana)
    .sort((a, b) => new Date(a.kuupaev) - new Date(b.kuupaev))
    .slice(0, 6);
  tulevasedSisuEl.innerHTML = tList.length
    ? tList.map(t => { const d = new Date(t.kuupaev); return `<div style="padding:8px 0;border-bottom:0.5px solid var(--piir3);font-size:13px">📅 ${d.getDate()}.${d.getMonth()+1} — ${t.objekt_nimi || '—'}${t.kirjeldus ? (' · ' + t.kirjeldus) : ''}</div>`; }).join('')
    : '<div style="padding:16px;text-align:center;color:var(--hall)">Tulevasi töid pole</div>';

  // ── ARVED ──
  const arvedSisuEl = document.getElementById('et-arved-sisu');
  const arvedNuppudEl = document.getElementById('et-arved-nupud');
  const koikArved = await api('/api/arved');
  const arvedList = (Array.isArray(koikArved) ? koikArved : [])
    .filter(a => e ? (a.ettevote_id === e.id || (a.ostja_nimi || '').toUpperCase() === N) : (a.ostja_nimi || '').toUpperCase() === N)
    .sort((a, b) => new Date(b.kuupaev) - new Date(a.kuupaev))
    .slice(0, 6);
  arvedSisuEl.innerHTML = arvedList.length
    ? arvedList.map(a => `<div style="padding:8px 0;border-bottom:0.5px solid var(--piir3);font-size:13px">
        <div style="display:flex;justify-content:space-between">
          <span>${a.number} — ${formatKp(a.kuupaev)}</span>
          <span style="font-weight:600">${parseFloat(a.kokku).toFixed(2)} €</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:11px;color:var(--hall)">
          <span>${a.maksetahtaeg ? ('Tähtaeg: ' + formatKp(a.maksetahtaeg)) : ''}</span>
          <span style="color:${a.staatus==='makstud'?'#4ade80':'#fb923c'}">${a.staatus==='makstud' ? '✅ Makstud' : '⏳ Maksmata'}</span>
        </div>
      </div>`).join('')
    : '<div style="padding:16px;text-align:center;color:var(--hall)">Arveid pole veel</div>';
  arvedNuppudEl.innerHTML = '<button type="button" class="nupp hall" style="font-size:11px;padding:5px 12px" onclick="avatTab(12)">Ava Arved →</button>'
    + (N === 'MEREKOHVIK' ? '<button type="button" class="nupp kull" style="font-size:11px;padding:5px 12px" onclick="avatTab(12)">📥 SumUp aruanne</button>' : '');
}

// ── VAHETA ROLL (kiire sisselogimine töötaja vaatesse ilma PIN-koodita) ──
let vrKoikTootajad = [];
let vrOtsing = '';

async function vrAvaModal() {
  document.getElementById('vrModal').classList.add('avatud');
  const otsiEl = document.getElementById('vr-otsi');
  if (otsiEl) otsiEl.value = '';
  vrOtsing = '';
  document.getElementById('vr-nimekiri').innerHTML = '<div style="padding:20px;text-align:center;color:var(--hall);font-size:13px">Laadimine...</div>';
  const workers = await api('/api/admin/tootajad');
  vrKoikTootajad = (Array.isArray(workers) ? workers : []).filter(w => w.aktiivne && !w.arhiveeritud);
  vrRenderList();
}
function vrSuljeModal() {
  document.getElementById('vrModal').classList.remove('avatud');
}
document.getElementById('vrModal')?.addEventListener('click', function(e) { if (e.target === this) vrSuljeModal(); });

function vrOtsiMuutus(v) { vrOtsing = (v || '').toLowerCase(); vrRenderList(); }

function vrRenderList() {
  const div = document.getElementById('vr-nimekiri');
  if (!div) return;
  const list = vrKoikTootajad.filter(w => !vrOtsing || w.nimi.toLowerCase().includes(vrOtsing)).sort((a,b) => a.nimi.localeCompare(b.nimi, 'et'));
  if (!list.length) { div.innerHTML = '<div style="padding:20px;text-align:center;color:var(--hall);font-size:13px">Aktiivseid töötajaid ei leitud</div>'; return; }
  div.innerHTML = list.map(w => {
    const vc = tootajaVarv(w.id || w.nimi);
    return `<div class="tj-arhiiv-rida" style="cursor:pointer" onclick="vrVahetaTootaja(${w.id})">
      <span style="display:flex;align-items:center;gap:10px"><span class="tabel-avatar" style="background:${vc}">${w.nimi[0]}</span><span style="font-weight:600;color:var(--tekst)">${w.nimi}</span></span>
      <span style="color:var(--hall)">→</span>
    </div>`;
  }).join('');
}

async function vrVahetaTootaja(id) {
  const r = await api(`/api/admin/vaheta-roll/${id}`, { method: 'POST' });
  if (!r || !r.ok) { alert((r && r.veateade) || 'Rolli vahetamine ebaõnnestus'); return; }
  vrSuljeModal();
  window.open('/tootaja?vaheta_token=' + encodeURIComponent(r.token), '_blank');
}

function avaMobiiliMenuu() {
  document.getElementById('sidebar-el')?.classList.add('avatud');
  document.getElementById('sidebar-varjutus')?.classList.add('avatud');
}
function suljeMobiiliMenuu() {
  document.getElementById('sidebar-el')?.classList.remove('avatud');
  document.getElementById('sidebar-varjutus')?.classList.remove('avatud');
}
function toggleSidebarGrupp(id) {
  const sisu = document.getElementById(id);
  const chevron = document.getElementById('chevron-' + id);
  if (sisu) sisu.classList.toggle('avatud');
  if (chevron) chevron.classList.toggle('avatud');
}
function avaSidebarGrupp(id) {
  const sisu = document.getElementById(id);
  const chevron = document.getElementById('chevron-' + id);
  if (sisu && !sisu.classList.contains('avatud')) { sisu.classList.add('avatud'); chevron.classList.add('avatud'); }
}
function ettevoteIdByNimi(nimi) {
  const e = (kõikEttevotted || []).find(x => (x.nimi || '').toUpperCase() === (nimi || '').toUpperCase());
  return e ? e.id : null;
}
function avaFiltreeritudTab(tabIdx, ettevoteNimi) {
  avatTab(tabIdx, ettevoteNimi);
}

function avatTab(i, ettevoteFilter) {
  // Nupud vastavad sektsioonile data-tab atribuudi kaudu (mitte DOM-järjekorra järgi),
  // et külgmenüüs saaks nuppe vabalt ümber järjestada/rühmitada ilma tab-vahetust katki tegemata.
  suljeMobiiliMenuu();
  const filter = (i === 3 || i === 4 || i === 10) ? (ettevoteFilter || null) : null;
  tabid.forEach(t => t.classList.toggle('ak', parseInt(t.dataset.tab, 10) === i));
  sektsioonid.forEach((s,j) => s.classList.toggle('nhtav', i===j));
  if (i === 9) avaSidebarGrupp('grupp-projektid');
  if ((i === 3 || i === 4 || i === 10) && filter && ETTEVOTE_GRUPP_ID[filter.toUpperCase()]) avaSidebarGrupp(ETTEVOTE_GRUPP_ID[filter.toUpperCase()]);
  if (i === 8) avaSidebarGrupp('grupp-merekohvik');
  const pealkiriEl = document.getElementById('topbar-title');
  if (pealkiriEl) {
    if (i === 3) pealkiriEl.textContent = filter ? `${filter} — Objektid` : TAB_PEALKIRJAD[3];
    else if (i === 4) pealkiriEl.textContent = filter ? `${filter} — Tulevased tööd` : TAB_PEALKIRJAD[4];
    else if (i === 10) pealkiriEl.textContent = filter ? filter : 'Ettevõte';
    else pealkiriEl.textContent = TAB_PEALKIRJAD[i] || '';
  }
  if(i===0) laadiKokkuvote();
  if(i===1) { laadiWorkerSelect(); laadiMaksed(); }
  if(i===2) laadiTootajad();
  if(i===3) laadiObjektid(filter);
  if(i===4) { if(kõikEttevotted.length) laadiTTWorkers(filter); else setTimeout(()=>{laadiTTWorkers(filter);},500); laadiTulevasteToodTabel(filter); }
  if(i===5) laadiFotod();
  if(i===6) laadiAuditLogi();
  if(i===7) laadiRaportTab();
  if(i===8) {
    uuendaDefaultKuvamine();
    laadiMerekohvikTootajad().then(() => laadiAdminGraafik());
    const t = new Date();
    const el = document.getElementById('g-lisa-kuupaev');
    if (el) el.value = t.toISOString().split('T')[0];
  }
  if(i===9) pkLaadiTab();
  if(i===10) laadiEttevoteLeht(filter);
  if(i===11) xsLaadiTab();
  if(i===12) laadiArved();
}

async function init() {
  kõikEttevotted = await api('/api/admin/ettevotted');
  if (!Array.isArray(kõikEttevotted)) { window.location='/admin-login'; return; }
  const t = new Date();
  const kvKuu = document.getElementById('kv-kuu');
  KUUD.forEach((k,i) => { const o = document.createElement('option'); o.value=i+1; o.textContent=k; if(i===t.getMonth()) o.selected=true; kvKuu.appendChild(o); });
  const kvAasta = document.getElementById('kv-aasta');
  for(let y=t.getFullYear(); y>=t.getFullYear()-2; y--) { const o = document.createElement('option'); o.value=y; o.textContent=y; kvAasta.appendChild(o); }
  document.getElementById('makse-kuupaev').value = t.toISOString().split('T')[0];
  document.getElementById('tt-kuupaev').value = t.toISOString().split('T')[0];
  document.getElementById('g-admin-paev').value = t.toISOString().split('T')[0];
  const gKuu = document.getElementById('g-admin-kuu');
  const gAasta = document.getElementById('g-admin-aasta');
  if (gKuu) { KUUD.forEach((k,i) => { const o = document.createElement('option'); o.value=i+1; o.textContent=k; if(i===t.getMonth()) o.selected=true; gKuu.appendChild(o); }); }
  if (gAasta) { for(let y=t.getFullYear(); y>=t.getFullYear()-1; y--) { const o = document.createElement('option'); o.value=y; o.textContent=y; gAasta.appendChild(o); } }
  const objEttevote = document.getElementById('obj-ettevote');
  kõikEttevotted.forEach(e => { objEttevote.innerHTML += `<option value="${e.id}">${e.nimi}</option>`; });
  taidaTootajaRaportWorkerSelect();
  const trAlgus = document.getElementById('tr-algus');
  const trLopp = document.getElementById('tr-lopp');
  if (trAlgus && trLopp) {
    trAlgus.value = new Date(t.getFullYear(), t.getMonth(), 1).toISOString().split('T')[0];
    trLopp.value = t.toISOString().split('T')[0];
  }
  laadiKokkuvote();
  kkUuendaArv();
  laadiViimasedTegevused();
}

// ── TÖÖTAJA DETAILRAPORT (Excel) ────────────────────────────────
async function taidaTootajaRaportWorkerSelect() {
  const sel = document.getElementById('tr-worker');
  if (!sel) return;
  const workers = await api('/api/admin/tootajad');
  sel.innerHTML = '';
  workers.filter(w => w.aktiivne).forEach(w => sel.innerHTML += `<option value="${w.id}">${w.nimi}</option>`);
}

function laadiTootajaRaportExcel() {
  const workerId = document.getElementById('tr-worker').value;
  const algus = document.getElementById('tr-algus').value;
  const lopp = document.getElementById('tr-lopp').value;
  if (!workerId || !algus || !lopp) { alert('Vali töötaja ja periood'); return; }
  if (algus > lopp) { alert('Alguskuupäev peab olema enne lõppkuupäeva'); return; }
  window.location = `/api/admin/tootaja-raport-excel?worker_id=${workerId}&algus=${algus}&lopp=${lopp}&_token=${TOKEN}`;
}

function laadiKoikTootajadRaportExcel() {
  const algus = document.getElementById('tr-algus').value;
  const lopp = document.getElementById('tr-lopp').value;
  if (!algus || !lopp) { alert('Vali periood'); return; }
  if (algus > lopp) { alert('Alguskuupäev peab olema enne lõppkuupäeva'); return; }
  window.location = `/api/admin/koik-tootajad-raport-excel?algus=${algus}&lopp=${lopp}&_token=${TOKEN}`;
}

let dashViimatiLaaditud = [];
let dashOtsing = '';
let dashStaatusFilter = 'kõik';
let dashLehekülg = 1;
const DASH_LEHE_SUURUS = 8;

async function laadiKokkuvote() {
  const kuu = document.getElementById('kv-kuu').value;
  const aasta = document.getElementById('kv-aasta').value;
  const andmed = await api(`/api/admin/kokkuvote?aasta=${aasta}&kuu=${kuu}`);
  dashViimatiLaaditud = Array.isArray(andmed) ? andmed : [];
  dashLehekülg = 1;
  kuvaTootajaKaardid(dashViimatiLaaditud);
  renderKokkuvoteTable();
}

function dashOtsiMuutus(v) {
  dashOtsing = (v||'').toLowerCase();
  dashLehekülg = 1;
  renderKokkuvoteTable();
  // Otsingukast asub tabeli sees, mis joonistatakse iga tähe järel uuesti — seega väli
  // hävib ja kursor kaob. Anname fookuse kohe tagasi, kursor teksti lõppu.
  const el = document.querySelector('#kokkuvoteKast .tabel-otsi');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function dashStaatusMuutus(f) { dashStaatusFilter = f; dashLehekülg = 1; renderKokkuvoteTable(); }
function dashLeheVaheta(delta) { dashLehekülg += delta; renderKokkuvoteTable(); }

function renderKokkuvoteTable() {
  const kuu = document.getElementById('kv-kuu').value;
  const aasta = document.getElementById('kv-aasta').value;
  const div = document.getElementById('kokkuvoteKast');
  const andmed = dashViimatiLaaditud;
  if(!andmed.length) { div.innerHTML='<div style="padding:32px;text-align:center;color:var(--hall)">Selle kuu kirjeid pole</div>'; uuendaStatKaardid([], kuu, aasta, 0, 0, 0); return; }

  let kokku_tunnid=0, kokku_teenitud=0, kokku_makstud=0;
  andmed.forEach(w => { kokku_tunnid+=parseFloat(w.tunnid); kokku_teenitud+=parseFloat(w.kogusumma||w.teenitud); kokku_makstud+=parseFloat(w.makstud); });
  uuendaStatKaardid(andmed, kuu, aasta, kokku_tunnid, kokku_teenitud, kokku_makstud);

  const staatusSildid = { makstud:'Makstud', osaline:'Osaliselt makstud', tasumata:'Tasumata', ettemakse:'Ettemakse' };
  let filtreeritud = andmed.filter(w => {
    if (dashOtsing && !w.nimi.toLowerCase().includes(dashOtsing)) return false;
    if (dashStaatusFilter !== 'kõik') {
      const st = saldoStaatus(parseFloat(w.kogusumma||w.teenitud), parseFloat(w.makstud||0));
      if (st.text !== staatusSildid[dashStaatusFilter]) return false;
    }
    return true;
  });

  const kokkuLeheküljed = Math.max(1, Math.ceil(filtreeritud.length / DASH_LEHE_SUURUS));
  if (dashLehekülg > kokkuLeheküljed) dashLehekülg = kokkuLeheküljed;
  const lehelised = filtreeritud.slice((dashLehekülg-1)*DASH_LEHE_SUURUS, dashLehekülg*DASH_LEHE_SUURUS);

  const filtriRida = `<div class="tabel-filtri-riba">
    <input type="text" placeholder="🔍 Otsi töötajat..." value="${dashOtsing.replace(/"/g,'&quot;')}" oninput="dashOtsiMuutus(this.value)" class="tabel-otsi">
    <div class="tabel-staatus-pillid">
      ${[['kõik','Kõik'],['makstud','Makstud'],['osaline','Osaliselt'],['tasumata','Tasumata'],['ettemakse','Ettemakse']].map(([f,l]) =>
        `<button type="button" class="dash-staatus-pill${dashStaatusFilter===f?' aktiivne':''}" onclick="dashStaatusMuutus('${f}')">${l}</button>`
      ).join('')}
    </div>
  </div>`;

  if (!filtreeritud.length) {
    div.innerHTML = filtriRida + `<div style="padding:32px;text-align:center;color:var(--hall)">Tulemusi ei leitud</div>`;
    return;
  }

  let html = filtriRida + `<div style="background:var(--bg2);border:0.5px solid var(--piir);border-radius:var(--radius-kaart);overflow:hidden;margin-bottom:8px">
    <table><thead><tr style="border-bottom:0.5px solid var(--piir2)">
      <th>Töötaja</th><th style="text-align:right">Tunnid</th><th style="text-align:right">Teenitud</th>
      <th style="text-align:right">Kulud</th><th style="text-align:right">Makstud</th><th style="text-align:right">Saldo</th><th>Staatus</th><th></th>
    </tr></thead><tbody>`;
  lehelised.forEach(w => {
    const tunnid=parseFloat(w.tunnid), teenitud=parseFloat(w.teenitud), makstud=parseFloat(w.makstud), saada=parseFloat(w.saadaVeel);
    const edgf=parseFloat(w.edgf||0), lisakulu=parseFloat(w.lisakulu||0), xseeria=parseFloat(w.xseeria||0), kulud=edgf+lisakulu+xseeria, kogusumma=parseFloat(w.kogusumma||w.teenitud);
    const st = saldoStaatus(kogusumma, makstud);
    const vc = tootajaVarv(w.id || w.nimi);
    html += `<tr id="worker-rida-${w.nimi.replace(/\s/g,'_')}">
      <td style="font-weight:600;cursor:pointer;color:${tunnid>0||kulud>0?'#2563eb':'var(--hall)'}" onclick="avaTootajaModal(${w.id||0}, '${w.nimi.replace(/'/g,"\\'")}')">
        <span class="tabel-avatar" style="background:${vc}">${w.nimi[0]}</span>${w.nimi}
      </td>
      <td style="text-align:right;color:#5b9cf6">${tunnid>0?tunnid.toFixed(1)+' h':'—'}</td>
      <td style="text-align:right;color:#4ade80">${teenitud>0?teenitud.toFixed(2)+' €':'—'}</td>
      <td style="text-align:right;color:#a78bfa">${kulud>0?'+'+kulud.toFixed(2)+' €':'—'}</td>
      <td style="text-align:right;color:var(--hall)">${makstud>0?makstud.toFixed(2)+' €':'—'}</td>
      <td style="text-align:right;color:${saada>0?'#fbbf24':saada<0?'#ef4444':'var(--hall)'}">${saada!==0?(saada>0?'+':'')+saada.toFixed(2)+' €':'—'}</td>
      <td><span class="staatus-pill ${st.cls}">${st.text}</span></td>
      <td style="text-align:right">${tunnid>0?`<button class="av-tegevus-ikoon" id="kirjed-chevron-${w.nimi.replace(/\s/g,'_')}" onclick="toggleKirjed('${w.nimi.replace(/\s/g,'_')}')" title="Näita töökirjeid"><span class="tj-arhiiv-chevron">▾</span></button>`:''}
      </td></tr>
    ${w.kirjed.length?`<tr id="kirjed-${w.nimi.replace(/\s/g,'_')}" style="display:none"><td colspan="8" style="padding:0 0 8px 0">
      <div style="margin:4px 14px;background:var(--bg3);border-radius:8px;overflow:hidden">
        ${w.kirjed.map(k=>{
          const muudetud = k.muudetud_tootaja;
          const rowStyle = 'display:flex;gap:10px;align-items:center;padding:7px 12px;border-bottom:0.5px solid var(--piir3);font-size:12px'
            + (muudetud ? ';background:rgba(251,191,36,0.14);border-left:3px solid #fbbf24' : '');
          const muudetudTitle = muudetud ? ` title="Töötaja muutis seda kirjet: ${new Date(muudetud).toLocaleString('et-EE')}"` : '';
          return `<div style="${rowStyle}"${muudetudTitle}>
          <span style="color:var(--hall);min-width:80px">${formatKp(k.kuupaev)}</span>
          <span style="color:var(--tekst3)">${k.ettevote_nimi}</span>
          <span style="color:var(--hall)">${k.objekt_nimi||'—'}</span>
          <span style="color:var(--tekst3)">${k.algus.slice(0,5)}–${k.lopp.slice(0,5)}</span>
          <span style="color:#2563eb;font-weight:600">${parseFloat(k.tunnid).toFixed(1)}h</span>
          ${muudetud?`<span style="color:#fbbf24;font-size:10px;font-weight:700;white-space:nowrap">✏️ MUUDETUD</span>`:''}
          ${k.ettevote_tyyp==='muu'?`<span style="display:flex;align-items:center;gap:4px">
            <input type="number" value="${k.muu_tunnitasu||''}" placeholder="€/h" step="0.5" min="0"
              style="width:60px;padding:2px 5px;font-size:11px;background:var(--bg2);border:0.5px solid ${k.muu_tunnitasu?'#2563eb':'var(--sisend-piir)'};border-radius:4px;color:var(--tekst)"
              id="muu-tasu-${k.id}">
            <button onclick="salvestaMuuTasu(${k.id})" style="background:#2563eb;border:none;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;color:#ffffff;cursor:pointer">✓</button>
          </span>`:`<span style="color:var(--hall)">${k.tunnitasu}€/h</span>`}
          <button onclick='avaaMuutaModal(${JSON.stringify(k)})' style="background:#1a3550;border:none;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">✏️</button>
          <button onclick="adminKustutaKirje(${k.id})" style="background:#3d0a0a;border:none;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">🗑</button>
        </div>`;
        }).join('')}
      </div></td></tr>`:''}`;
  });
  html += `<tr style="border-top:1px solid var(--piir);font-weight:700">
    <td>KOKKU</td>
    <td style="text-align:right;color:#5b9cf6">${kokku_tunnid.toFixed(1)} h</td>
    <td style="text-align:right;color:#4ade80">${kokku_teenitud.toFixed(2)} €</td>
    <td style="text-align:right;color:#a78bfa">—</td>
    <td style="text-align:right;color:var(--hall)">${kokku_makstud.toFixed(2)} €</td>
    <td style="text-align:right;color:#fbbf24">${(kokku_teenitud-kokku_makstud).toFixed(2)} €</td>
    <td></td><td></td>
  </tr></tbody></table></div>`;
  if (kokkuLeheküljed > 1) {
    html += `<div class="tabel-pager">
      <button type="button" onclick="dashLeheVaheta(-1)" ${dashLehekülg<=1?'disabled':''}>‹ Eelmine</button>
      <span>Lehekülg ${dashLehekülg} / ${kokkuLeheküljed}</span>
      <button type="button" onclick="dashLeheVaheta(1)" ${dashLehekülg>=kokkuLeheküljed?'disabled':''}>Järgmine ›</button>
    </div>`;
  }
  div.innerHTML = html;
  kvRenderUlevaadeToggle();
}

let kvUlevaadeAvatud = localStorage.getItem('kvUlevaadeAvatud') === '1';
function kvToggleUlevaade() {
  kvUlevaadeAvatud = !kvUlevaadeAvatud;
  localStorage.setItem('kvUlevaadeAvatud', kvUlevaadeAvatud ? '1' : '0');
  kvRenderUlevaadeToggle();
}
function kvRenderUlevaadeToggle() {
  const sisu = document.getElementById('kv-ulevaade-sisu');
  const chevron = document.getElementById('kv-ulevaade-chevron');
  if (sisu) sisu.classList.toggle('avatud', kvUlevaadeAvatud);
  if (chevron) chevron.classList.toggle('avatud', kvUlevaadeAvatud);
}

function saldoStaatus(teenitud, makstud) {
  if (teenitud <= 0 && makstud <= 0) return { text: '—', cls: 'hall' };
  if (makstud > teenitud) return { text: 'Ettemakse', cls: 'sinine' };
  if (makstud >= teenitud) return { text: 'Makstud', cls: 'roheline' };
  if (makstud > 0) return { text: 'Osaliselt makstud', cls: 'oranz' };
  return { text: 'Tasumata', cls: 'punane' };
}

function kuvaTootajaKaardid(andmed) {
  const div = document.getElementById('kokkuvote-tootajad-kaardid');
  if (!div) return;
  const aktiivsed = (andmed || []).filter(w => {
    const kulud = parseFloat(w.edgf||0) + parseFloat(w.lisakulu||0) + parseFloat(w.xseeria||0);
    return parseFloat(w.tunnid) > 0 || kulud > 0;
  }).sort((a,b) => parseFloat(b.tunnid) - parseFloat(a.tunnid));
  if (!aktiivsed.length) { div.innerHTML = ''; return; }
  const top5 = aktiivsed.slice(0, 5);
  div.innerHTML = `<div class="top-tootajad-kaart">
    <div class="top-tootajad-hdr">Top töötajad</div>
    <div class="top-tootajad-scroll">` + top5.map(w => {
    const vc = tootajaVarv(w.id || w.nimi);
    const tunnid = parseFloat(w.tunnid);
    const teenitud = parseFloat(w.kogusumma || w.teenitud);
    const makstud = parseFloat(w.makstud || 0);
    const st = saldoStaatus(teenitud, makstud);
    return `<div class="top-tootaja-kaart" onclick="avaTootajaModal(${w.id||0}, '${w.nimi.replace(/'/g,"\\'")}')">
      <div class="top-tootaja-avatar" style="background:${vc}">${w.nimi[0]}</div>
      <div class="top-tootaja-nimi">${w.nimi}</div>
      <div class="top-tootaja-info">${tunnid.toFixed(1)}h · ${teenitud.toFixed(0)}€</div>
      <span class="staatus-pill ${st.cls}">${st.text}</span>
    </div>`;
  }).join('') + `</div></div>`;
}

async function uuendaKiirkokkuvote(andmed, kokkuTunnid, kokkuTeenitud, kokkuMakstud) {
  const div = document.getElementById('dash-kiirkokkuvote');
  if (!div) return;
  const aktiivseid = (andmed||[]).filter(w => {
    const kulud = parseFloat(w.edgf||0) + parseFloat(w.lisakulu||0) + parseFloat(w.xseeria||0);
    return parseFloat(w.tunnid) > 0 || kulud > 0;
  }).length;
  const volgu = kokkuTeenitud - kokkuMakstud;
  const protsentMakstud = kokkuTeenitud > 0 ? Math.min(100, Math.round((kokkuMakstud / kokkuTeenitud) * 100)) : 0;
  let kommentaariRida = '';
  try {
    const kk = await api('/api/kristo/admin/kommentaarid/arv');
    if (kk && typeof kk.arv === 'number') {
      kommentaariRida = `<div class="kiirinfo-rida"><span class="kiirinfo-silt">Lahendamata kommentaarid</span><span class="kiirinfo-val" style="color:${kk.arv>0?'var(--punane)':'var(--tekst)'}">${kk.arv}</span></div>`;
    }
  } catch(e) {}
  div.innerHTML = `
    <div class="kiirinfo-rida"><span class="kiirinfo-silt">Aktiivseid töötajaid</span><span class="kiirinfo-val">${aktiivseid}</span></div>
    <div class="kiirinfo-rida"><span class="kiirinfo-silt">Töötunde kokku</span><span class="kiirinfo-val">${kokkuTunnid.toFixed(1)} h</span></div>
    <div class="kiirinfo-rida"><span class="kiirinfo-silt">Makstud osakaal</span><span class="kiirinfo-val">${protsentMakstud}%</span></div>
    <div class="kiirinfo-rida"><span class="kiirinfo-silt">Tasumata</span><span class="kiirinfo-val" style="color:${volgu>0?'var(--oranz)':'var(--tekst)'}">${volgu.toFixed(2)} €</span></div>
    ${kommentaariRida}`;
}

async function laadiViimasedTegevused() {
  const div = document.getElementById('dash-viimased-tegevused');
  if (!div) return;
  try {
    const d = await api('/api/admin/audit-log');
    if (!Array.isArray(d) || !d.length) { div.innerHTML = '<div style="font-size:12px;color:var(--hall)">Tegevusi pole veel</div>'; return; }
    div.innerHTML = d.slice(0, 6).map(a => {
      const aeg = a.loodud ? new Date(a.loodud).toLocaleString('et-EE', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
      const tegevusTekst = (typeof AUDIT_TEGEVUSED !== 'undefined' && AUDIT_TEGEVUSED[a.tegevus]) || a.tegevus || '—';
      return `<div class="tegevus-rida">
        <div class="tegevus-dot"></div>
        <div>
          <div class="tegevus-tekst"><b>${escapeHtmlXs(a.worker_nimi || 'Admin')}</b> — ${escapeHtmlXs(tegevusTekst)}</div>
          <div class="tegevus-aeg">${aeg}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    div.innerHTML = '<div style="font-size:12px;color:var(--hall)">Ei õnnestunud laadida</div>';
  }
}

function uuendaStatKaardid(andmed, kuu, aasta, kokkuTunnid, kokkuTeenitud, kokkuMakstud) {
  const kaardid = document.getElementById('stat-kaardid');
  if (!kaardid) return;
  const aktiivseid = andmed.filter(w => {
    const kulud = parseFloat(w.edgf||0) + parseFloat(w.lisakulu||0) + parseFloat(w.xseeria||0);
    return parseFloat(w.tunnid) > 0 || kulud > 0;
  }).length;
  const kuuNimi = (typeof KUUD !== 'undefined' && KUUD[kuu-1]) ? KUUD[kuu-1] : '';
  const volgu = kokkuTeenitud - kokkuMakstud;

  document.getElementById('stat-tootajaid').textContent = aktiivseid;
  document.getElementById('stat-tootajaid-sub').textContent = `${andmed.length} kokku selles nimekirjas`;

  document.getElementById('stat-tunnid').textContent = kokkuTunnid.toFixed(1) + ' h';
  document.getElementById('stat-tunnid-sub').textContent = `${kuuNimi} ${aasta}`;

  document.getElementById('stat-teenitud').textContent = kokkuTeenitud.toFixed(2) + ' €';

  const volguEl = document.getElementById('stat-volgu');
  volguEl.textContent = (volgu > 0 ? '+' : '') + volgu.toFixed(2) + ' €';
  volguEl.style.color = volgu > 0 ? '#fbbf24' : volgu < 0 ? '#ef4444' : 'var(--tekst)';
  document.getElementById('stat-volgu-sub').textContent = `makstud: ${kokkuMakstud.toFixed(2)} €`;

  uuendaKiirkokkuvote(andmed, kokkuTunnid, kokkuTeenitud, kokkuMakstud);
}

async function avaTootajaModal(workerId, workerNimi) {
  const kuu = document.getElementById('kv-kuu').value;
  const aasta = document.getElementById('kv-aasta').value;
  document.getElementById('tm-avatar').textContent = workerNimi[0];
  document.getElementById('tm-nimi').textContent = workerNimi;
  document.getElementById('tm-kuu').textContent = KUUD[kuu-1] + ' ' + aasta;
  document.getElementById('tm-tunnid').textContent = '...';
  document.getElementById('tm-teenitud').textContent = '...';
  document.getElementById('tm-makstud').textContent = '...';
  document.getElementById('tm-saada').textContent = '...';
  document.getElementById('tm-ettevotted').innerHTML = '<div style="color:var(--hall);font-size:13px">Laadimine...</div>';
  document.getElementById('tm-maksed').innerHTML = '<div style="color:var(--hall);font-size:13px">Laadimine...</div>';
  document.getElementById('tm-kirjed').innerHTML = '<div style="color:var(--hall);font-size:13px">Laadimine...</div>';
  document.getElementById('tootajaModal').classList.add('avatud');
  const [kokkuvote, maksed] = await Promise.all([
    api(`/api/admin/kokkuvote?aasta=${aasta}&kuu=${kuu}`),
    api(`/api/admin/maksed?worker_id=${workerId}&aasta=${aasta}&kuu=${kuu}`)
  ]);
  const workerData = Array.isArray(kokkuvote) ? kokkuvote.find(w => w.nimi === workerNimi) : null;
  if (!workerData) {
    document.getElementById('tm-tunnid').textContent = '0 h';
    document.getElementById('tm-teenitud').textContent = '0 €';
    document.getElementById('tm-makstud').textContent = '0 €';
    document.getElementById('tm-saada').textContent = '0 €';
    document.getElementById('tm-ettevotted').innerHTML = '<div style="color:var(--hall);font-size:13px">Andmed puuduvad</div>';
    document.getElementById('tm-kirjed').innerHTML = '<div style="color:var(--hall);font-size:13px">Kirjeid pole</div>';
  } else {
    const tunnid = parseFloat(workerData.tunnid), teenitud = parseFloat(workerData.teenitud);
    const makstud = parseFloat(workerData.makstud), saada = parseFloat(workerData.saadaVeel);
    document.getElementById('tm-tunnid').textContent = tunnid.toFixed(1) + ' h';
    document.getElementById('tm-teenitud').textContent = teenitud.toFixed(2) + ' €';
    document.getElementById('tm-makstud').textContent = makstud.toFixed(2) + ' €';
    const saadaEl = document.getElementById('tm-saada');
    saadaEl.textContent = (saada > 0 ? '+' : '') + saada.toFixed(2) + ' €';
    saadaEl.style.color = saada > 0 ? '#fbbf24' : saada < 0 ? '#ef4444' : 'var(--hall)';
    const ettevotteGrupp = {};
    workerData.kirjed.forEach(k => {
      const e = k.ettevote_nimi;
      if (!ettevotteGrupp[e]) ettevotteGrupp[e] = { tunnid: 0, summa: 0, tyyp: k.ettevote_tyyp };
      ettevotteGrupp[e].tunnid += parseFloat(k.tunnid);
      ettevotteGrupp[e].summa += parseFloat(k.tunnid) * parseFloat(k.tunnitasu || 0);
    });
    const ettevotteHtml = Object.entries(ettevotteGrupp).map(([nimi, data]) => {
      const tyyp = (data.tyyp || 'muu').toLowerCase();
      return `<div class="tm-ettevote-rida"><span class="tm-ettevote-badge badge-${tyyp}">${nimi}</span><span style="color:var(--tekst3);font-size:13px">${data.tunnid.toFixed(1)} h</span><span style="color:#4ade80;font-size:13px;margin-left:auto">${data.summa.toFixed(2)} €</span></div>`;
    }).join('');
    document.getElementById('tm-ettevotted').innerHTML = ettevotteHtml || '<div style="color:var(--hall);font-size:13px">Töökirjeid pole</div>';
    const kirjedHtml = workerData.kirjed.length ? workerData.kirjed.map(k => {
      const tyyp = (k.ettevote_tyyp || 'muu').toLowerCase();
      const summa = parseFloat(k.tunnid) * parseFloat(k.tunnitasu || 0);
      const muudetud = k.muudetud_tootaja;
      const rowStyle = muudetud ? ' style="background:rgba(251,191,36,0.14);border-left:3px solid #fbbf24"' : '';
      const muudetudTitle = muudetud ? ` title="Töötaja muutis seda kirjet: ${new Date(muudetud).toLocaleString('et-EE')}"` : '';
      const muudetudBadge = muudetud ? `<span style="color:#fbbf24;font-size:9px;font-weight:700;white-space:nowrap">✏️ MUUDETUD</span>` : '';
      return `<div class="tm-kirje-rida"${rowStyle}${muudetudTitle}><span style="color:var(--hall);min-width:75px">${formatKp(k.kuupaev)}</span><span class="tm-ettevote-badge badge-${tyyp}" style="font-size:9px">${k.ettevote_nimi}</span><span style="color:var(--tekst3)">${k.objekt_nimi || '—'}</span><span style="color:var(--tekst3)">${k.algus.slice(0,5)}–${k.lopp.slice(0,5)}</span><span style="color:#2563eb;font-weight:600">${parseFloat(k.tunnid).toFixed(1)}h</span>${muudetudBadge}<span style="color:#4ade80;margin-left:auto">${summa.toFixed(2)}€</span></div>`;
    }).join('') : '<div style="color:var(--hall);font-size:13px">Kirjeid pole</div>';
    document.getElementById('tm-kirjed').innerHTML = kirjedHtml;
  }
  const maksedHtml = Array.isArray(maksed) && maksed.length ? maksed.map(m => `
    <div class="tm-makse-rida"><div><div style="color:var(--tekst)">${formatKp(m.kuupaev)}</div>${m.kommentaar ? `<div style="font-size:11px;color:var(--hall)">${m.kommentaar}</div>` : ''}</div><div style="color:#4ade80;font-weight:700">+${parseFloat(m.summa).toFixed(2)} €</div></div>`).join('') : '<div style="color:var(--hall);font-size:13px">Selle kuu makseid pole</div>';
  document.getElementById('tm-maksed').innerHTML = maksedHtml;
}

function sulgeTootajaModal() { document.getElementById('tootajaModal').classList.remove('avatud'); }
document.getElementById('tootajaModal').addEventListener('click', function(e) { if (e.target === this) sulgeTootajaModal(); });

function toggleKirjed(nimi) {
  const el = document.getElementById('kirjed-'+nimi);
  if (!el) return;
  const visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'table-row';
  const btn = document.getElementById('kirjed-chevron-'+nimi);
  if (btn) {
    const chev = btn.querySelector('.tj-arhiiv-chevron');
    if (chev) chev.classList.toggle('avatud', !visible);
  }
}

function laadiCSV(e) {
  e.preventDefault();
  const kuu = document.getElementById('kv-kuu').value;
  const aasta = document.getElementById('kv-aasta').value;
  window.location=`/api/admin/raport-csv?aasta=${aasta}&kuu=${kuu}&_token=${TOKEN}`;
}

// ── TÖÖTAJAD (master-detail) ────────────────────────────────────
let tjKoikTootajad = [];
let tjKoikTootajadEttevotted = {};
let tjKoikXs = {};
let tjKoikArved = {};
let tjKoikOmaarved = {};
let tjOtsing = '';
let tjEttevoteFilter = 'kõik';
let tjStaatusFilter = 'aktiivsed';
let tjValitudId = null;
let tjDetailTab = 'ulevaade';
let tjLehekylg = 1;
let tjArhiivAvatud = false;
const TJ_LEHE_SUURUS = 8;

const TJ_SVG_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M15.2 14.2c2.6.3 4.8 2.2 4.8 5.3"/></svg>';
const TJ_SVG_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
const TJ_SVG_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z"/></svg>';
const TJ_SVG_RECEIPT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/></svg>';

async function laadiTootajad() {
  const [workers, xsList, arvedList, omaarvedList] = await Promise.all([
    api('/api/admin/tootajad'),
    api('/api/xseeria/admin/lubatud'),
    api('/api/arved/admin/lubatud'),
    api('/api/omaarved/admin/lubatud')
  ]);
  tjKoikTootajad = Array.isArray(workers) ? workers : [];
  tjKoikXs = {}; if (Array.isArray(xsList)) xsList.forEach(w => tjKoikXs[w.id] = !!w.lubatud);
  tjKoikArved = {}; if (Array.isArray(arvedList)) arvedList.forEach(w => tjKoikArved[w.id] = !!w.lubatud);
  tjKoikOmaarved = {}; if (Array.isArray(omaarvedList)) omaarvedList.forEach(w => tjKoikOmaarved[w.id] = !!w.lubatud);
  tjKoikTootajadEttevotted = {};
  await Promise.all(tjKoikTootajad.map(async w => {
    const we = await api(`/api/admin/tootaja-ettevotted/${w.id}`);
    tjKoikTootajadEttevotted[w.id] = Array.isArray(we) ? we.map(x => ({ ettevote_id: x.ettevote_id, tunnitasu: x.tunnitasu })) : [];
  }));
  const filterSelect = document.getElementById('tj-ettevote-filter');
  if (filterSelect) {
    const praegune = filterSelect.value;
    filterSelect.innerHTML = '<option value="kõik">Kõik ettevõtted</option>' +
      kõikEttevotted.map(e => `<option value="${e.id}">${e.nimi}</option>`).join('');
    filterSelect.value = praegune || 'kõik';
  }
  if (tjValitudId && !tjKoikTootajad.find(w => w.id === tjValitudId)) tjValitudId = null;
  tjRenderStatid();
  tjRenderList();
  tjRenderDetail();
}

function tjRenderStatid() {
  const div = document.getElementById('tj-stat-rida');
  if (!div) return;
  const mitteArhiveeritud = tjKoikTootajad.filter(w => !w.arhiveeritud);
  const aktiivsed = mitteArhiveeritud.filter(w => w.aktiivne).length;
  const kokku = mitteArhiveeritud.length;
  let seoseidKokku = 0;
  Object.values(tjKoikTootajadEttevotted).forEach(we => seoseidKokku += we.length);
  const xsKokku = Object.values(tjKoikXs).filter(Boolean).length;
  const arveKokku = tjKoikTootajad.filter(w => tjKoikArved[w.id] || tjKoikOmaarved[w.id]).length;
  div.innerHTML = `
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(37,99,235,.12);color:var(--sinine)">${TJ_SVG_USERS}</div>
      <div><div class="stat-kaart-label">Aktiivseid töötajaid</div><div class="stat-kaart-val">${aktiivsed}</div><div class="stat-kaart-sub">${kokku} kokku nimekirjas</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(18,166,106,.14);color:var(--roheline)">${TJ_SVG_FOLDER}</div>
      <div><div class="stat-kaart-label">Projekti seoseid</div><div class="stat-kaart-val">${seoseidKokku}</div><div class="stat-kaart-sub">Kokku kõigi töötajatega</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(37,99,235,.12);color:var(--sinine)">${TJ_SVG_SHIELD}</div>
      <div><div class="stat-kaart-label">X-seeria ligipääsuga</div><div class="stat-kaart-val">${xsKokku}</div><div class="stat-kaart-sub">&nbsp;</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(229,154,22,.14);color:var(--oranz)">${TJ_SVG_RECEIPT}</div>
      <div><div class="stat-kaart-label">Arvete ligipääsuga</div><div class="stat-kaart-val">${arveKokku}</div><div class="stat-kaart-sub">&nbsp;</div></div>
    </div>`;
}

function tjOtsiMuutus(v) { tjOtsing = (v||'').toLowerCase(); tjLehekylg = 1; tjRenderList(); }
function tjFiltriMuutus() {
  tjEttevoteFilter = document.getElementById('tj-ettevote-filter').value;
  tjStaatusFilter = document.getElementById('tj-staatus-filter').value;
  tjLehekylg = 1;
  tjRenderList();
}
function tjLeheVaheta(delta) { tjLehekylg += delta; tjRenderList(); }
function tjLylitaLisaVorm() {
  const el = document.getElementById('tj-lisa-vorm');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function tjRenderList() {
  const listDiv = document.getElementById('tj-nimekiri');
  const pagerDiv = document.getElementById('tj-pager');
  if (!listDiv) return;
  let list = tjKoikTootajad.filter(w => {
    if (w.arhiveeritud) return false;
    if (tjOtsing && !(w.nimi.toLowerCase().includes(tjOtsing) || (w.pin||'').toLowerCase().includes(tjOtsing))) return false;
    if (tjStaatusFilter === 'aktiivsed' && !w.aktiivne) return false;
    if (tjStaatusFilter === 'mitteaktiivsed' && w.aktiivne) return false;
    if (tjEttevoteFilter !== 'kõik') {
      const we = tjKoikTootajadEttevotted[w.id] || [];
      if (!we.some(x => String(x.ettevote_id) === String(tjEttevoteFilter))) return false;
    }
    return true;
  }).sort((a,b) => a.nimi.localeCompare(b.nimi, 'et'));

  tjRenderArhiiv();

  const kokkuLeheküljed = Math.max(1, Math.ceil(list.length / TJ_LEHE_SUURUS));
  if (tjLehekylg > kokkuLeheküljed) tjLehekylg = kokkuLeheküljed;
  const lehelised = list.slice((tjLehekylg-1)*TJ_LEHE_SUURUS, tjLehekylg*TJ_LEHE_SUURUS);

  if (!list.length) {
    listDiv.innerHTML = '<div style="padding:32px;text-align:center;color:var(--hall)">Töötajaid ei leitud</div>';
    pagerDiv.innerHTML = '';
    return;
  }

  listDiv.innerHTML = `<table><thead><tr style="border-bottom:0.5px solid var(--piir2)">
      <th>Töötaja</th><th>PIN</th><th>Projektid</th><th>Staatus</th><th></th>
    </tr></thead><tbody>` + lehelised.map(w => {
    const we = tjKoikTootajadEttevotted[w.id] || [];
    const nimed = we.map(x => (kõikEttevotted.find(e=>e.id===x.ettevote_id)||{}).nimi).filter(Boolean);
    const vc = tootajaVarv(w.id || w.nimi);
    const onXs = !!tjKoikXs[w.id];
    return `<tr class="tj-tabeli-rida${tjValitudId===w.id?' aktiivne-valik':''}" onclick="tjValiTootaja(${w.id})">
      <td style="font-weight:600"><span class="tabel-avatar" style="background:${vc}">${w.nimi[0]}</span>${w.nimi}</td>
      <td style="color:var(--hall);font-size:12px">${w.pin}</td>
      <td>${nimed.length ? nimed.slice(0,2).map(n=>`<span class="tj-badge">${n}</span>`).join('') + (nimed.length>2?`<span class="tj-badge">+${nimed.length-2}</span>`:'') : '<span style="color:var(--hall);font-size:11px">—</span>'}${onXs?'<span class="tj-badge" style="color:var(--sinine)">🥏 X-seeria</span>':''}</td>
      <td><span class="staatus-pill ${w.aktiivne?'roheline':'hall'}">${w.aktiivne?'Aktiivne':'Mitteaktiivne'}</span></td>
      <td style="text-align:right;color:var(--hall)">›</td>
    </tr>`;
  }).join('') + `</tbody></table>`;

  pagerDiv.innerHTML = kokkuLeheküljed > 1 ? `
      <button type="button" onclick="tjLeheVaheta(-1)" ${tjLehekylg<=1?'disabled':''}>‹ Eelmine</button>
      <span>Lehekülg ${tjLehekylg} / ${kokkuLeheküljed}</span>
      <button type="button" onclick="tjLeheVaheta(1)" ${tjLehekylg>=kokkuLeheküljed?'disabled':''}>Järgmine ›</button>` : '';
}

function tjToggleArhiiv() {
  tjArhiivAvatud = !tjArhiivAvatud;
  const sisu = document.getElementById('tj-arhiiv-sisu');
  const chevron = document.getElementById('tj-arhiiv-chevron');
  if (sisu) sisu.classList.toggle('avatud', tjArhiivAvatud);
  if (chevron) chevron.classList.toggle('avatud', tjArhiivAvatud);
}

function tjRenderArhiiv() {
  const sisu = document.getElementById('tj-arhiiv-sisu');
  const arvEl = document.getElementById('tj-arhiiv-arv');
  if (!sisu) return;
  const arhiveeritud = tjKoikTootajad.filter(w => w.arhiveeritud).sort((a,b) => a.nimi.localeCompare(b.nimi, 'et'));
  if (arvEl) arvEl.textContent = arhiveeritud.length;
  if (!arhiveeritud.length) {
    sisu.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hall);font-size:12px">Arhiveeritud töötajaid pole</div>';
    return;
  }
  sisu.innerHTML = arhiveeritud.map(w => `
    <div class="tj-arhiiv-rida">
      <span class="tj-arhiiv-nimi" style="cursor:pointer" onclick="tjValiTootaja(${w.id})">${w.nimi}</span>
      <button type="button" class="nupp hall" style="font-size:11px;padding:5px 10px" onclick="event.stopPropagation();tjTaastaTootaja(${w.id})">↩ Taasta</button>
    </div>`).join('');
}

async function tjTaastaTootaja(id) {
  if (!confirm('Taastad selle töötaja aktiivsete töötajate nimekirja? Sisselogimine (aktiivne) jääb teadlikult välja lülitatuks, kuni lülitad selle eraldi sisse.')) return;
  await api(`/api/admin/tootajad/${id}/arhiveeri`, { method: 'PUT', body: JSON.stringify({ arhiveeritud: false }) });
  await laadiTootajad();
}

function tjValiTootaja(id) {
  tjValitudId = id;
  tjDetailTab = 'ulevaade';
  tjRenderList();
  tjRenderDetail();
}

function tjVahetaDetailTab(tab) {
  tjDetailTab = tab;
  tjRenderDetail();
}

function tjRenderDetail() {
  const div = document.getElementById('tj-detail-sisu');
  if (!div) return;
  if (!tjValitudId) { div.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--hall)">Vali töötaja nimekirjast, et näha detaile</div>'; return; }
  const w = tjKoikTootajad.find(x => x.id === tjValitudId);
  if (!w) { tjValitudId = null; div.innerHTML = '<div style="padding:60px 20px;text-align:center;color:var(--hall)">Vali töötaja nimekirjast, et näha detaile</div>'; return; }
  const we = tjKoikTootajadEttevotted[w.id] || [];
  const vc = tootajaVarv(w.id || w.nimi);
  div.innerHTML = `
    <div class="tj-detail-hdr">
      <div class="tj-detail-avatar" style="background:${vc}">${w.nimi[0]}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:700;color:var(--tekst)">${w.nimi}${w.arhiveeritud ? '<span class="tj-badge" style="margin-left:8px;color:var(--hall)">📦 Arhiveeritud</span>' : ''}</div>
        <div style="font-size:12px;color:var(--hall)">Töötaja profiil</div>
      </div>
      ${w.arhiveeritud
        ? `<button type="button" class="nupp hall" style="font-size:12px;padding:6px 12px" onclick="tjTaastaTootaja(${w.id})">↩ Taasta</button>`
        : `<button type="button" class="nupp hall" style="font-size:12px;padding:6px 12px" onclick="tjArhiveeriTootaja()">📦 Arhiveeri</button>`}
      <button type="button" class="tj-more-nupp" onclick="tjKustutaTootaja()" title="Kustuta töötaja jäädavalt">🗑</button>
    </div>
    <div class="tj-detail-tabs">
      <button type="button" class="tj-detail-tab ${tjDetailTab==='ulevaade'?'aktiivne':''}" onclick="tjVahetaDetailTab('ulevaade')">Ülevaade</button>
      <button type="button" class="tj-detail-tab ${tjDetailTab==='projektid'?'aktiivne':''}" onclick="tjVahetaDetailTab('projektid')">Projektid</button>
      <button type="button" class="tj-detail-tab ${tjDetailTab==='moodulid'?'aktiivne':''}" onclick="tjVahetaDetailTab('moodulid')">Moodulid</button>
      <button type="button" class="tj-detail-tab ${tjDetailTab==='ajalugu'?'aktiivne':''}" onclick="tjVahetaDetailTab('ajalugu')">Ajalugu</button>
    </div>
    <div id="tj-detail-tab-sisu">${tjRenderDetailTabSisu(w, we)}</div>
  `;
  if (tjDetailTab === 'ajalugu') tjLaadiAjalugu(w.id);
  if (tjDetailTab === 'moodulid') tjLaadiMoodulid(w.id);
}

function tjRenderDetailTabSisu(w, we) {
  if (tjDetailTab === 'ulevaade') {
    const onXs = !!tjKoikXs[w.id], onArved = !!tjKoikArved[w.id], onOmaarved = !!tjKoikOmaarved[w.id];
    return `
      <div class="tj-info-tiilid">
        <div class="tj-info-tiil"><div class="tj-info-tiil-silt">PIN-kood</div><div class="tj-info-tiil-val">${w.pin}</div></div>
        <div class="tj-info-tiil"><div class="tj-info-tiil-silt">Staatus</div><div class="tj-info-tiil-val" style="color:${w.aktiivne?'var(--roheline)':'var(--hall)'}">${w.aktiivne?'Aktiivne':'Mitteaktiivne'}</div></div>
        <div class="tj-info-tiil"><div class="tj-info-tiil-silt">Registreeritud</div><div class="tj-info-tiil-val" style="font-size:12px">${w.loodud ? new Date(w.loodud).toLocaleDateString('et-EE') : '—'}</div></div>
        <div class="tj-info-tiil"><div class="tj-info-tiil-silt">Ettevõtte seoseid</div><div class="tj-info-tiil-val">${we.length}</div></div>
      </div>
      <div class="tj-sektsioon-pealkiri">Andmed</div>
      <div class="vorm-rida col2">
        <div class="vorm-grupp"><label>Nimi</label><input type="text" id="tj-e-nimi" value="${w.nimi.replace(/"/g,'&quot;')}"></div>
        <div class="vorm-grupp"><label>PIN-kood</label><input type="text" id="tj-e-pin" value="${w.pin}" maxlength="6"></div>
      </div>
      <div class="vorm-rida">
        <div class="vorm-grupp"><label>Email</label><input type="email" id="tj-e-email" value="${(w.email||'').replace(/"/g,'&quot;')}" placeholder="email"></div>
      </div>
      <div class="tj-sektsioon-pealkiri">Ligipääsud</div>
      <div class="tj-ligipaas-rida">
        <span>✅ Aktiivne (saab tootaja.html-i sisse logida)</span>
        <label class="toggle-switch"><input type="checkbox" id="tj-e-aktiivne" ${w.aktiivne?'checked':''}><span class="toggle-slider"></span></label>
      </div>
      <div class="tj-ligipaas-rida">
        <span>🥏 X-seeria (võistlused, kulude sisestus)</span>
        <label class="toggle-switch"><input type="checkbox" ${onXs?'checked':''} onchange="tjToggleXs(${w.id}, this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="tj-ligipaas-rida">
        <span>🧾 Minu Arved (isiklik arvete moodul)</span>
        <label class="toggle-switch"><input type="checkbox" ${onOmaarved?'checked':''} onchange="tjToggleOmaarved(${w.id}, this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="tj-ligipaas-rida">
        <span>👤 Kogu ettevõtte arved (raamatupidaja täisligipääs)</span>
        <label class="toggle-switch"><input type="checkbox" ${onArved?'checked':''} onchange="tjToggleArved(${w.id}, this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="teade" id="tj-detail-teade" style="margin-top:10px"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="nupp kull" style="flex:1" onclick="tjSalvestaTootaja()">💾 Salvesta muudatused</button>
        <button class="nupp hall" onclick="tjLylitaAktiivsus()">${w.aktiivne?'⏸ Deaktiveeri':'▶ Aktiveeri'}</button>
      </div>`;
  }
  if (tjDetailTab === 'projektid') {
    return `
      <div class="tj-sektsioon-pealkiri">Ettevõtted ja tunnitasud</div>
      <div style="font-size:11px;color:var(--hall);margin-bottom:10px">Salvestub automaatselt</div>
      ${kõikEttevotted.map(e => {
        const rec = we.find(x => x.ettevote_id === e.id);
        const onMaara = !!rec;
        const tasu = rec ? rec.tunnitasu : '';
        const isEdgf = e.tyyp === 'edgf';
        const varv = ETTEVOTE_TYYP_VARV[e.tyyp] || '#888';
        return `<div class="ettevote-rida">
          <div class="ettevote-rida-vasak">
            <span class="ettevote-dot" style="background:${varv}"></span>
            <span class="ettevote-nimi">${e.nimi}</span>
          </div>
          <div class="ettevote-rida-parem">
            ${isEdgf
              ? `<span style="font-size:11px;color:var(--hall);font-style:italic">kulupõhine</span>`
              : `<input type="number" id="et-${w.id}-${e.id}" class="ettevote-tasu-input" value="${tasu}" placeholder="€/h" step="0.5" ${onMaara?'':'disabled'} onchange="uuendaEttevoteTasu(${w.id}, ${e.id})">`
            }
            <label class="toggle-switch">
              <input type="checkbox" id="ec-${w.id}-${e.id}" ${onMaara?'checked':''} onchange="toggleEttevote(${w.id}, ${e.id}, this, ${isEdgf})">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>`;
      }).join('')}`;
  }
  if (tjDetailTab === 'moodulid') {
    return `<div id="tj-moodulid-sisu"><div style="padding:24px;text-align:center;color:var(--hall)">Laadimine...</div></div>`;
  }
  return `<div id="tj-ajalugu-sisu"><div style="padding:24px;text-align:center;color:var(--hall)">Laadimine...</div></div>`;
}

let tjMoodulidCache = null;
async function tjLaadiMoodulid(workerId) {
  const div = document.getElementById('tj-moodulid-sisu');
  if (!div) return;
  if (!tjMoodulidCache) {
    const r = await api('/api/admin/moodulid');
    tjMoodulidCache = Array.isArray(r) ? r : [];
  }
  const oigusedR = await api('/api/admin/tootaja-oigused/' + workerId);
  const oigused = {};
  (Array.isArray(oigusedR) ? oigusedR : []).forEach(o => { oigused[o.moodul_kood] = o.tase; });
  if (!tjMoodulidCache.length) {
    div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Ühtegi moodulit pole veel loodud</div>';
    return;
  }
  const grupid = {};
  tjMoodulidCache.forEach(m => { (grupid[m.grupp || 'muu'] = grupid[m.grupp || 'muu'] || []).push(m); });
  div.innerHTML = Object.entries(grupid).map(([grupp, moodulid]) => `
    <div class="tj-sektsioon-pealkiri">${grupp.toUpperCase()}</div>
    ${moodulid.map(m => `
      <div class="tj-ligipaas-rida">
        <span>${m.nimi}</span>
        <select onchange="tjMuudaMooduliOigus(${workerId}, '${m.kood}', this.value)" style="width:auto">
          <option value="" ${!oigused[m.kood] ? 'selected' : ''}>Pole ligipääsu</option>
          <option value="vaata" ${oigused[m.kood]==='vaata' ? 'selected' : ''}>Ainult vaata</option>
          <option value="muuda" ${oigused[m.kood]==='muuda' ? 'selected' : ''}>Vaata + Muuda</option>
        </select>
      </div>
    `).join('')}
  `).join('');
}

async function tjMuudaMooduliOigus(workerId, mooduliKood, tase) {
  await api('/api/admin/tootaja-oigused', { method: 'POST', body: JSON.stringify({ worker_id: workerId, moodul_kood: mooduliKood, tase: tase || null }) });
}

async function tjLaadiAjalugu(workerId) {
  const div = document.getElementById('tj-ajalugu-sisu');
  if (!div) return;
  try {
    const d = await api('/api/admin/audit-log');
    const omad = (Array.isArray(d) ? d : []).filter(a => a.worker_id === workerId).slice(0, 30);
    if (!omad.length) { div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Selle töötaja kohta pole veel ajalugu</div>'; return; }
    div.innerHTML = omad.map(a => {
      const aeg = a.loodud ? new Date(a.loodud).toLocaleString('et-EE', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
      const tegevusTekst = (typeof AUDIT_TEGEVUSED !== 'undefined' && AUDIT_TEGEVUSED[a.tegevus]) || a.tegevus || '—';
      return `<div class="tegevus-rida"><div class="tegevus-dot"></div><div><div class="tegevus-tekst">${escapeHtmlXs(tegevusTekst)}</div><div class="tegevus-aeg">${aeg}</div></div></div>`;
    }).join('');
  } catch(e) {
    div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Ei õnnestunud laadida</div>';
  }
}

async function tjToggleXs(workerId, lubatud) {
  await api(`/api/xseeria/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
  tjKoikXs[workerId] = lubatud;
  tjRenderStatid(); tjRenderList();
}
async function tjToggleArved(workerId, lubatud) {
  await api(`/api/arved/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
  tjKoikArved[workerId] = lubatud;
  tjRenderStatid();
}
async function tjToggleOmaarved(workerId, lubatud) {
  await api(`/api/omaarved/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
  tjKoikOmaarved[workerId] = lubatud;
  tjRenderStatid();
}

async function tjSalvestaTootaja() {
  const id = tjValitudId;
  if (!id) return;
  const nimi = document.getElementById('tj-e-nimi').value;
  const pin = document.getElementById('tj-e-pin').value;
  const email = document.getElementById('tj-e-email').value;
  const aktiivne = document.getElementById('tj-e-aktiivne').checked;
  if (!nimi || !pin) { naitaTeade('tj-detail-teade','viga','Nimi ja PIN on kohustuslikud'); return; }
  const r = await api(`/api/admin/tootajad/${id}`, { method:'PUT', body: JSON.stringify({ nimi, pin, aktiivne, email }) });
  if (r && r.ok === false) { naitaTeade('tj-detail-teade','viga', r.veateade || 'Salvestamine ebaõnnestus'); return; }
  await laadiTootajad();
  naitaTeade('tj-detail-teade','ok','✅ Salvestatud');
}

async function tjLylitaAktiivsus() {
  const id = tjValitudId;
  const w = tjKoikTootajad.find(x => x.id === id);
  if (!w) return;
  const uusAktiivne = !w.aktiivne;
  if (!uusAktiivne && !confirm(`Deaktiveerida töötaja "${w.nimi}"?\n\nTa ei saa enam sisse logida, aga kõik andmed säilivad.`)) return;
  await api(`/api/admin/tootajad/${id}`, { method:'PUT', body: JSON.stringify({ nimi: w.nimi, pin: w.pin, aktiivne: uusAktiivne, email: w.email||'' }) });
  await laadiTootajad();
}

async function tjKustutaTootaja() {
  const id = tjValitudId;
  const w = tjKoikTootajad.find(x => x.id === id);
  if (!w) return;
  if (!confirm(`Kustutad töötaja "${w.nimi}"?\n\nSEE KUSTUTAB KA kõik tema töökirjed!\n\nSee on pöördumatu!`)) return;
  const r = await api(`/api/admin/tootajad/${id}`, { method:'DELETE' });
  if (!r || !r.ok) { alert((r && r.veateade) || 'Kustutamine ebaõnnestus'); return; }
  tjValitudId = null;
  await laadiTootajad();
}

async function tjArhiveeriTootaja() {
  const id = tjValitudId;
  const w = tjKoikTootajad.find(x => x.id === id);
  if (!w) return;
  if (!confirm(`Arhiveerida töötaja "${w.nimi}"?\n\nTa kaob peamisest töötajate nimekirjast "Arhiveeritud" alla ega saa enam sisse logida. Kõik andmed (töökirjed, maksed, ajalugu) säilivad ja saab hiljem taastada.`)) return;
  await api(`/api/admin/tootajad/${id}/arhiveeri`, { method: 'PUT', body: JSON.stringify({ arhiveeritud: true }) });
  await laadiTootajad();
}

async function lisaTootaja() {
  const nimi=document.getElementById('t-nimi').value, pin=document.getElementById('t-pin').value, email=document.getElementById('t-email').value;
  if(!nimi||!pin) return naitaTeade('tootaja-teade','viga','Täida kõik väljad!');
  const r=await api('/api/admin/tootajad',{method:'POST',body:JSON.stringify({nimi,pin,email})});
  if(r.ok){naitaTeade('tootaja-teade','ok','✅ Lisatud!');document.getElementById('t-nimi').value='';document.getElementById('t-pin').value='';laadiTootajad();}
  else naitaTeade('tootaja-teade','viga',r.veateade);
}

const ETTEVOTE_TYYP_VARV = { lidl: '#FFF200', cramo: '#CD2200', muu: '#38bdf8', merekohvik: '#4ade80', edgf: '#a78bfa' };

function tjPatchEttevoteMap(workerId, ettevoteId, tunnitasu, eemalda) {
  if (typeof tjKoikTootajadEttevotted === 'undefined') return;
  const we = tjKoikTootajadEttevotted[workerId] || (tjKoikTootajadEttevotted[workerId] = []);
  const idx = we.findIndex(x => x.ettevote_id === ettevoteId);
  if (eemalda) { if (idx > -1) we.splice(idx, 1); }
  else if (idx > -1) we[idx].tunnitasu = tunnitasu;
  else we.push({ ettevote_id: ettevoteId, tunnitasu });
  if (typeof tjRenderList === 'function') tjRenderList();
}

async function toggleEttevote(workerId, ettevoteId, checkbox, isEdgf) {
  const tasuInput = document.getElementById(`et-${workerId}-${ettevoteId}`);
  if (checkbox.checked) {
    if (tasuInput) tasuInput.disabled = false;
    const tasu = (!isEdgf && tasuInput && tasuInput.value) ? tasuInput.value : 0;
    const r = await api('/api/admin/tootaja-ettevotted', {method:'POST', body:JSON.stringify({worker_id:workerId, ettevote_id:ettevoteId, tunnitasu:tasu})});
    if (!r || !r.ok) {
      checkbox.checked = false;
      if (tasuInput) tasuInput.disabled = true;
      alert((r && r.veateade) || 'Salvestamine ebaõnnestus');
      return;
    }
    if (!isEdgf && tasuInput) tasuInput.focus();
    tjPatchEttevoteMap(workerId, ettevoteId, tasu, false);
  } else {
    if (tasuInput) { tasuInput.disabled = true; tasuInput.value = ''; }
    await api(`/api/admin/tootaja-ettevotted/${workerId}/${ettevoteId}`, {method:'DELETE'});
    tjPatchEttevoteMap(workerId, ettevoteId, 0, true);
  }
}

async function uuendaEttevoteTasu(workerId,ettevoteId) {
  const checkbox=document.getElementById(`ec-${workerId}-${ettevoteId}`);
  const tasu=document.getElementById(`et-${workerId}-${ettevoteId}`).value;
  if(!checkbox.checked||!tasu) return;
  await api('/api/admin/tootaja-ettevotted',{method:'POST',body:JSON.stringify({worker_id:workerId,ettevote_id:ettevoteId,tunnitasu:tasu})});
  tjPatchEttevoteMap(workerId, ettevoteId, tasu, false);
}

let objAktiivneFilter=null, objLukustatudEttevoteId=null;

async function laadiObjektid(filter) {
  if(filter!==undefined) objAktiivneFilter=filter||null;
  const ettevoteId=objAktiivneFilter?ettevoteIdByNimi(objAktiivneFilter):null;
  objLukustatudEttevoteId=ettevoteId;
  const teadeEl=document.getElementById('obj-kontekst-teade'), grupp=document.getElementById('obj-ettevote-grupp');
  if(objAktiivneFilter&&ettevoteId){
    if(teadeEl){teadeEl.style.display='block';teadeEl.textContent=`📌 Näitad ${objAktiivneFilter} objekte. Uus objekt lisatakse automaatselt ${objAktiivneFilter} alla.`;}
    if(grupp) grupp.style.display='none';
  } else {
    if(teadeEl) teadeEl.style.display='none';
    if(grupp) grupp.style.display='';
  }
  const url=ettevoteId?`/api/admin/objektid?ettevote_id=${ettevoteId}`:'/api/admin/objektid';
  const r=await api(url);
  const nimekiri=Array.isArray(r)?r:[];

  const svgObj='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
  const svgAktiivne='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
  const svgEttevotted='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  const aktiivseid=nimekiri.filter(o=>o.aktiivne).length;
  const ettevotteid=new Set(nimekiri.map(o=>o.ettevote_nimi)).size;
  const kpiEl=document.getElementById('obj-kpi-rida');
  if(kpiEl) kpiEl.innerHTML=`
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(37,99,235,.12);color:var(--sinine)">${svgObj}</div>
      <div><div class="stat-kaart-label">Objekte kokku</div><div class="stat-kaart-val" style="font-size:18px">${nimekiri.length}</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(18,166,106,.14);color:var(--roheline)">${svgAktiivne}</div>
      <div><div class="stat-kaart-label">Aktiivseid</div><div class="stat-kaart-val" style="font-size:18px">${aktiivseid}</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(200,163,71,.16);color:var(--kuld)">${svgEttevotted}</div>
      <div><div class="stat-kaart-label">Ettevõtteid</div><div class="stat-kaart-val" style="font-size:18px">${ettevotteid}</div></div>
    </div>`;

  const svgSalvesta='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  let html='<table><thead><tr>'+(objAktiivneFilter?'':'<th>Ettevõte</th>')+'<th>Nimi</th><th>Aktiivne</th><th></th></tr></thead><tbody>';
  if(!nimekiri.length) html+=`<tr><td colspan="${objAktiivneFilter?3:4}" style="text-align:center;color:var(--hall);padding:24px">Objekte pole</td></tr>`;
  nimekiri.forEach(o=>{html+=`<tr>${objAktiivneFilter?'':`<td style="color:var(--hall)">${o.ettevote_nimi}</td>`}<td><input type="text" value="${o.nimi}" id="on-${o.id}" style="width:200px"></td><td><input type="checkbox" ${o.aktiivne?'checked':''} id="oa-${o.id}"></td><td style="text-align:right"><button class="av-tegevus-ikoon" title="Salvesta" onclick="uuendaObjekt(${o.id})">${svgSalvesta}</button></td></tr>`;});
  document.getElementById('objektidTabel').innerHTML=html+'</tbody></table>';
}

async function lisaObjekt() {
  const nimi=document.getElementById('obj-nimi').value;
  const ettevote_id=objLukustatudEttevoteId||document.getElementById('obj-ettevote').value;
  if(!nimi) return naitaTeade('objekt-teade','viga','Sisesta objekti nimi!');
  const r=await api('/api/admin/objektid',{method:'POST',body:JSON.stringify({nimi,ettevote_id})});
  if(r.ok){naitaTeade('objekt-teade','ok','✅ Lisatud!');document.getElementById('obj-nimi').value='';laadiObjektid();}
  else naitaTeade('objekt-teade','viga',r.veateade||'Viga');
}

async function uuendaObjekt(id) {
  await api(`/api/admin/objektid/${id}`,{method:'PUT',body:JSON.stringify({nimi:document.getElementById(`on-${id}`).value,aktiivne:document.getElementById(`oa-${id}`).checked})});
  laadiObjektid();
}

let mkKoikMaksed = [];
let mkTootajadNimekiri = [];
let mkKvSaldodCache = null;

function mkEsc(s) { return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function laadiWorkerSelect() {
  const workers=await api('/api/admin/tootajad');
  mkTootajadNimekiri = workers.filter(w=>w.aktiivne);
  const sel=document.getElementById('makse-worker');
  const fsel=document.getElementById('mk-f-tootaja');
  sel.innerHTML='';
  if(fsel) fsel.innerHTML='<option value="">Kõik töötajad</option>';
  mkTootajadNimekiri.forEach(w=>{
    sel.innerHTML+=`<option value="${w.id}">${mkEsc(w.nimi)}</option>`;
    if(fsel) fsel.innerHTML+=`<option value="${w.id}">${mkEsc(w.nimi)}</option>`;
  });
  mkTaidaEttevotteSelect(document.getElementById('makse-ettevote'));
  mkTaidaEttevotteSelect(document.getElementById('mk-muuda-ettevote'));
  const fpsel=document.getElementById('mk-f-projekt');
  if(fpsel){
    fpsel.innerHTML='<option value="">Kõik projektid</option>';
    (kõikEttevotted||[]).forEach(e=>fpsel.innerHTML+=`<option value="${e.id}">${mkEsc(e.nimi)}</option>`);
  }
  const mwsel=document.getElementById('mk-muuda-worker');
  if(mwsel){ mwsel.innerHTML=''; mkTootajadNimekiri.forEach(w=>mwsel.innerHTML+=`<option value="${w.id}">${mkEsc(w.nimi)}</option>`); }
  mkTootajaMuutus();
}

function mkTaidaEttevotteSelect(sel, skip) {
  if(!sel || skip) return;
  sel.innerHTML='<option value="">—</option>';
  (kõikEttevotted||[]).forEach(e=>sel.innerHTML+=`<option value="${e.id}">${mkEsc(e.nimi)}</option>`);
}

async function mkTootajaMuutus() {
  const workerId=document.getElementById('makse-worker').value;
  const teade=document.getElementById('mk-saldo-teade');
  if(!workerId || !teade) { if(teade) teade.style.display='none'; return; }
  if(!mkKvSaldodCache) {
    const t=new Date();
    const r=await api(`/api/admin/kokkuvote?aasta=${t.getFullYear()}&kuu=${t.getMonth()+1}`);
    mkKvSaldodCache = Array.isArray(r) ? r : [];
  }
  const w = mkTootajadNimekiri.find(x=>String(x.id)===String(workerId));
  const kv = w ? mkKvSaldodCache.find(x=>x.nimi===w.nimi) : null;
  if(!kv) { teade.style.display='none'; return; }
  const saldo = parseFloat(kv.saadaVeel);
  teade.style.display='flex';
  teade.innerHTML = `Tasumata: <strong>${saldo.toFixed(2)} €</strong>` + (saldo>0 ? `<button type="button" onclick="mkTaidaSaldo(${saldo})">Täida kogu saldo</button>` : '');
}

function mkTaidaSaldo(saldo) {
  document.getElementById('makse-summa').value = saldo.toFixed(2);
}

async function laadiMaksed() {
  const r=await api('/api/admin/maksed');
  mkKoikMaksed = Array.isArray(r) ? r : [];
  const fkuu=document.getElementById('mk-f-kuu');
  if(fkuu){
    const kuud = [...new Set(mkKoikMaksed.map(m=>m.kuupaev.slice(0,7)))].sort().reverse();
    const KUUD=['jaanuar','veebruar','märts','aprill','mai','juuni','juuli','august','september','oktoober','november','detsember'];
    fkuu.innerHTML='<option value="">Kõik kuud</option>'+kuud.map(k=>{const[a,m]=k.split('-');return `<option value="${k}">${KUUD[parseInt(m,10)-1]} ${a}</option>`;}).join('');
  }
  mkRender();
}

function mkFiltriMuutus() { mkRender(); }

function mkTyhjendaFiltrid() {
  document.getElementById('mk-f-kuu').value='';
  document.getElementById('mk-f-tootaja').value='';
  document.getElementById('mk-f-projekt').value='';
  document.getElementById('mk-f-otsi').value='';
  mkRender();
}

function mkRender() {
  const fkuu=document.getElementById('mk-f-kuu').value;
  const ftootaja=document.getElementById('mk-f-tootaja').value;
  const fprojekt=document.getElementById('mk-f-projekt').value;
  const fotsi=(document.getElementById('mk-f-otsi').value||'').toLowerCase().trim();
  const filtreeritud = mkKoikMaksed.filter(m=>{
    if(fkuu && m.kuupaev.slice(0,7)!==fkuu) return false;
    if(ftootaja && String(m.worker_id)!==String(ftootaja)) return false;
    if(fprojekt && String(m.ettevote_id)!==String(fprojekt)) return false;
    if(fotsi && !(m.kommentaar||'').toLowerCase().includes(fotsi)) return false;
    return true;
  });

  const nyyd = new Date();
  const kuuVoti = nyyd.getFullYear() + '-' + String(nyyd.getMonth()+1).padStart(2,'0');
  const seKuu = mkKoikMaksed.filter(m=>m.kuupaev.slice(0,7)===kuuVoti);
  const seKuuKokku = seKuu.reduce((s,m)=>s+parseFloat(m.summa),0);
  const seKuuTootajaid = new Set(seKuu.map(m=>m.worker_id)).size;
  const KUUD_NIM=['Jaanuar','Veebruar','Märts','Aprill','Mai','Juuni','Juuli','August','September','Oktoober','November','Detsember'];
  const kuuSilt = KUUD_NIM[nyyd.getMonth()] + ' ' + nyyd.getFullYear();

  const svgKokku='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>';
  const svgTootajad='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  const svgArv='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  document.getElementById('mk-kpi-rida').innerHTML = `
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(37,99,235,.12);color:var(--sinine)">${svgKokku}</div>
      <div><div class="stat-kaart-label">Selle kuu maksed</div><div class="stat-kaart-val" style="font-size:18px">${seKuuKokku.toFixed(2)} €</div><div style="font-size:11px;color:var(--hall);margin-top:2px">${seKuu.length} makset</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(18,166,106,.14);color:var(--roheline)">${svgTootajad}</div>
      <div><div class="stat-kaart-label">Makstud töötajatele</div><div class="stat-kaart-val" style="font-size:18px">${seKuuTootajaid}</div><div style="font-size:11px;color:var(--hall);margin-top:2px">töötajat sel kuul</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(200,163,71,.16);color:var(--kuld)">${svgArv}</div>
      <div><div class="stat-kaart-label">Maksete arv</div><div class="stat-kaart-val" style="font-size:18px">${seKuu.length}</div><div style="font-size:11px;color:var(--hall);margin-top:2px">${kuuSilt}</div></div>
    </div>`;

  let html='<table class="mk-tabel"><thead><tr><th>Kuupäev</th><th>Töötaja</th><th class="mk-th-summa">Summa</th><th>Projekt</th><th>Kommentaar</th><th></th></tr></thead><tbody>';
  if(!filtreeritud.length) html+='<tr><td colspan="6" style="text-align:center;color:var(--hall);padding:24px">Maksed puuduvad</td></tr>';
  filtreeritud.forEach(m=>{
    html+=`<tr>
      <td>${formatKp(m.kuupaev)}</td>
      <td>${mkEsc(m.worker_nimi)}</td>
      <td class="mk-summa">${parseFloat(m.summa).toFixed(2)} €</td>
      <td>${m.ettevote_nimi?`<span class="mk-projekt-pill">${mkEsc(m.ettevote_nimi)}</span>`:'<span style="color:var(--hall)">—</span>'}</td>
      <td class="mk-komm">${mkEsc(m.kommentaar)||'—'}</td>
      <td class="mk-tegevused">
        <button class="av-tegevus-ikoon" title="Muuda" onclick="mkAvaMuudaModal(${m.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="av-tegevus-ikoon kustuta" title="Tühista makse" onclick="kustutaMakse(${m.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
      </td>
    </tr>`;
  });
  document.getElementById('maksedTabel').innerHTML=html+'</tbody></table>';
}

async function lisaMakse() {
  const worker_id=document.getElementById('makse-worker').value, summa=document.getElementById('makse-summa').value;
  const kuupaev=document.getElementById('makse-kuupaev').value, kommentaar=document.getElementById('makse-komm').value;
  const ettevote_id=document.getElementById('makse-ettevote').value||null;
  if(!summa||!kuupaev) return naitaTeade('makse-teade','viga','Täida väljad!');
  const r=await api('/api/admin/maksed',{method:'POST',body:JSON.stringify({worker_id,summa,kuupaev,kommentaar,ettevote_id})});
  if(r.ok){naitaTeade('makse-teade','ok','✅ Salvestatud!');document.getElementById('makse-summa').value='';document.getElementById('makse-komm').value='';mkKvSaldodCache=null;laadiMaksed();mkTootajaMuutus();}
  else naitaTeade('makse-teade','viga',r.veateade);
}

function mkAvaMuudaModal(id) {
  const m = mkKoikMaksed.find(x=>x.id===id);
  if(!m) return;
  document.getElementById('mk-muuda-id').value=m.id;
  document.getElementById('mk-muuda-worker').value=m.worker_id;
  document.getElementById('mk-muuda-summa').value=parseFloat(m.summa).toFixed(2);
  document.getElementById('mk-muuda-kuupaev').value=m.kuupaev.slice(0,10);
  document.getElementById('mk-muuda-ettevote').value=m.ettevote_id||'';
  document.getElementById('mk-muuda-komm').value=m.kommentaar||'';
  document.getElementById('mkMuudaModal').classList.add('avatud');
}

function mkSuljeMuudaModal() {
  document.getElementById('mkMuudaModal').classList.remove('avatud');
}
document.getElementById('mkMuudaModal')?.addEventListener('click', function(e){ if(e.target===this) mkSuljeMuudaModal(); });

async function mkSalvestaMuudetud() {
  const id=document.getElementById('mk-muuda-id').value;
  const worker_id=document.getElementById('mk-muuda-worker').value;
  const summa=document.getElementById('mk-muuda-summa').value;
  const kuupaev=document.getElementById('mk-muuda-kuupaev').value;
  const ettevote_id=document.getElementById('mk-muuda-ettevote').value||null;
  const kommentaar=document.getElementById('mk-muuda-komm').value;
  if(!summa||!kuupaev) return naitaTeade('mk-muuda-teade','viga','Täida väljad!');
  const r=await api(`/api/admin/maksed/${id}`,{method:'PATCH',body:JSON.stringify({worker_id,summa,kuupaev,kommentaar,ettevote_id})});
  if(r.ok){ mkKvSaldodCache=null; await laadiMaksed(); setTimeout(mkSuljeMuudaModal,500); }
  else naitaTeade('mk-muuda-teade','viga',r.veateade);
}

async function kustutaMakse(id) {
  if(!confirm('Tühistad selle makse? Seda ei saa hiljem taastada.')) return;
  await api(`/api/admin/maksed/${id}`,{method:'DELETE'});
  mkKvSaldodCache=null;
  laadiMaksed();
}

let ttAktiivneFilter=null, ttLukustatudEttevoteId=null;

async function laadiTTObjektid() {
  const ettevoteId=document.getElementById('tt-ettevote').value;
  const sel=document.getElementById('tt-objekt');
  sel.innerHTML='<option value="">— Pole määratud —</option>';
  if(!ettevoteId) return;
  const objektid=await api(`/api/tood/objektid/${ettevoteId}`);
  (Array.isArray(objektid)?objektid:[]).filter(o=>o.aktiivne).forEach(o=>{sel.innerHTML+=`<option value="${o.id}">${o.nimi}</option>`;});
}

async function laadiTTWorkers(filter) {
  if(filter!==undefined) ttAktiivneFilter=filter||null;
  const ettevoteId=ttAktiivneFilter?ettevoteIdByNimi(ttAktiivneFilter):null;
  ttLukustatudEttevoteId=ettevoteId;
  const teadeEl=document.getElementById('tt-kontekst-teade'), grupp=document.getElementById('tt-ettevote-grupp');
  if(ttAktiivneFilter&&ettevoteId){
    if(teadeEl){teadeEl.style.display='block';teadeEl.textContent=`📌 Näitad ${ttAktiivneFilter} tulevasi töid. Uus töö lisatakse automaatselt ${ttAktiivneFilter} alla.`;}
    if(grupp) grupp.style.display='none';
    document.getElementById('tt-ettevote').innerHTML=`<option value="${ettevoteId}">${ttAktiivneFilter}</option>`;
    laadiTTObjektid();
  } else {
    if(teadeEl) teadeEl.style.display='none';
    if(grupp) grupp.style.display='';
    const sel=document.getElementById('tt-ettevote');
    sel.innerHTML='';
    kõikEttevotted.forEach(e=>{sel.innerHTML+=`<option value="${e.id}">${e.nimi}</option>`;});
    laadiTTObjektid();
  }
  const workers=await api('/api/admin/tootajad');
  const div=document.getElementById('tt-workers-valik');
  div.innerHTML='';
  workers.filter(w=>w.aktiivne).forEach(w=>{
    div.innerHTML+=`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap;background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:6px 12px"><input type="checkbox" value="${w.id}" class="tt-worker-cb" style="width:auto"> ${w.nimi}</label>`;
  });
}

async function lisaTulevaneToo() {
  const ettevote_id=ttLukustatudEttevoteId||document.getElementById('tt-ettevote').value;
  const objekt_id=document.getElementById('tt-objekt').value||null;
  const kuupaev=document.getElementById('tt-kuupaev').value;
  const algus=document.getElementById('tt-algus').value;
  const lopp=document.getElementById('tt-lopp').value;
  const kirjeldus=document.getElementById('tt-kirjeldus').value;
  const workerIds=[...document.querySelectorAll('.tt-worker-cb:checked')].map(cb=>cb.value);
  if(!ettevote_id||!kuupaev||!workerIds.length) return naitaTeade('tt-teade','viga','Vali ettevõte, kuupäev ja vähemalt üks töötaja!');
  const r=await api('/api/tood/tulevased',{method:'POST',body:JSON.stringify({ettevote_id,objekt_id,kuupaev,algus,lopp,kirjeldus,worker_ids:workerIds})});
  if(r.ok){naitaTeade('tt-teade','ok',`✅ Lisatud ${workerIds.length} töötajale! ${r.emailidSaadetud||0} emaili saadetud.`);document.getElementById('tt-kirjeldus').value='';document.querySelectorAll('.tt-worker-cb').forEach(cb=>cb.checked=false);laadiTulevasteToodTabel(ttAktiivneFilter);}
  else naitaTeade('tt-teade','viga',r.veateade);
}

async function laadiTulevasteToodTabel(filter) {
  if(filter!==undefined) ttAktiivneFilter=filter||null;
  const ettevoteId=ttAktiivneFilter?ettevoteIdByNimi(ttAktiivneFilter):null;
  const url=ettevoteId?`/api/tood/tulevased?ettevote_id=${ettevoteId}`:'/api/tood/tulevased';
  const r=await api(url);
  const nimekiri=Array.isArray(r)?r:[];
  const taana=new Date();taana.setHours(0,0,0,0);
  const tulevased=nimekiri.filter(t=>new Date(t.kuupaev)>=taana);
  const emailSaadetud=nimekiri.filter(t=>t.email_saadetud).length;

  const svgKal='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const svgMail='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M4 4h16v16H4z"/><polyline points="22 6 12 13 2 6"/></svg>';
  const kpiEl=document.getElementById('tt-kpi-rida');
  if(kpiEl) kpiEl.innerHTML=`
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(37,99,235,.12);color:var(--sinine)">${svgKal}</div>
      <div><div class="stat-kaart-label">Tulevasi töid</div><div class="stat-kaart-val" style="font-size:18px">${tulevased.length}</div></div>
    </div>
    <div class="stat-kaart">
      <div class="stat-kaart-ikoon" style="background:rgba(18,166,106,.14);color:var(--roheline)">${svgMail}</div>
      <div><div class="stat-kaart-label">Emaile saadetud</div><div class="stat-kaart-val" style="font-size:18px">${emailSaadetud}</div></div>
    </div>`;

  let html='<div style="padding:12px 18px 0"><label style="font-size:12px;color:var(--hall);display:flex;align-items:center;gap:6px"><input type="checkbox" id="tt-valik-koik" onchange="valiKõikTulevased(this.checked)"> Vali kõik</label></div>';
  html+='<table><thead><tr><th></th><th>Kuupäev</th>'+(ttAktiivneFilter?'':'<th>Ettevõte</th>')+'<th>Objekt</th><th>Kirjeldus</th><th>Töötajad</th><th></th></tr></thead><tbody>';
  if(!nimekiri.length) html+=`<tr><td colspan="7" style="text-align:center;color:var(--hall);padding:24px">Tulevasi töid pole</td></tr>`;
  const grupid={};
  nimekiri.forEach(t=>{const key=`${t.kuupaev}_${t.ettevote_id}_${t.objekt_id}_${t.kirjeldus}`;if(!grupid[key])grupid[key]={...t,workers:[]};grupid[key].workers.push({id:t.id,nimi:t.worker_nimi,email_saadetud:t.email_saadetud});});
  Object.values(grupid).forEach(g=>{
    const d=new Date(g.kuupaev);
    html+=`<tr>
      <td><input type="checkbox" class="tt-rida-cb" data-ids="${g.workers.map(w=>w.id).join(',')}"></td>
      <td>${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}${g.algus?` ${g.algus.slice(0,5)}-${g.lopp.slice(0,5)}`:''}</td>
      ${ttAktiivneFilter?'':`<td>${g.ettevote_nimi}</td>`}
      <td>${g.objekt_nimi||'—'}</td>
      <td>${g.kirjeldus||'—'}</td>
      <td>${g.workers.map(w=>`${w.nimi}${w.email_saadetud?' ✅':''}`).join(', ')}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="nupp hall" style="padding:4px 8px;font-size:11px" onclick="markEmailSaadetud('${g.workers.map(w=>w.id).join(',')}')">📧</button>
        <button class="nupp hall" style="padding:4px 8px;font-size:11px" onclick='avaaMuutaTulevane(${JSON.stringify(g).replace(/'/g,"&apos;")})'>✏️</button>
        <button class="nupp punane" onclick="kustutaTulevaneToo('${g.workers.map(w=>w.id).join(',')}')">🗑</button>
      </td>
    </tr>`;
  });
  document.getElementById('tulevasteToodTabel').innerHTML=html+'</tbody></table>';
}

function valiKõikTulevased(checked) { document.querySelectorAll('.tt-rida-cb').forEach(cb=>cb.checked=checked); }

async function markEmailSaadetud(idsStr) {
  const ids=idsStr.split(',');
  await Promise.all(ids.map(id=>api(`/api/tood/tulevased/${id}/email-saadetud`,{method:'PUT'})));
  laadiTulevasteToodTabel(ttAktiivneFilter);
}

async function kustutaValitudTulevased() {
  const valitud=[...document.querySelectorAll('.tt-rida-cb:checked')];
  if(!valitud.length) return alert('Vali vähemalt üks rida');
  if(!confirm(`Kustutad ${valitud.length} töö(d)?`)) return;
  const kõikIds=valitud.flatMap(cb=>cb.dataset.ids.split(','));
  await Promise.all(kõikIds.map(id=>api(`/api/tood/tulevased/${id}`,{method:'DELETE'})));
  laadiTulevasteToodTabel(ttAktiivneFilter);
}

async function kustutaTulevaneToo(idsStr) {
  if(!confirm('Kustutad selle töö?')) return;
  const ids=idsStr.split(',');
  await Promise.all(ids.map(id=>api(`/api/tood/tulevased/${id}`,{method:'DELETE'})));
  laadiTulevasteToodTabel(ttAktiivneFilter);
}

function formatKp(kp) {
  const d=new Date(kp);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function naitaTeade(elId,tyyp,tekst) {
  const el=document.getElementById(elId);
  el.className=`teade ${tyyp}`;el.textContent=tekst;el.style.display='block';
  setTimeout(()=>{el.style.display='none';},4000);
}

function avaaMuutaTulevane(g) {
  document.getElementById('mt-id').value = g.workers.map(w=>w.id).join(',');
  document.getElementById('mt-kuupaev').value = g.kuupaev.slice(0,10);
  document.getElementById('mt-algus').value = g.algus ? g.algus.slice(0,5) : '';
  document.getElementById('mt-lopp').value = g.lopp ? g.lopp.slice(0,5) : '';
  document.getElementById('mt-kirjeldus').value = g.kirjeldus || '';
  api('/api/admin/tootajad').then(workers => {
    const div=document.getElementById('mt-workers-valik');
    div.innerHTML='';
    const valitudIds = g.workers.map(w=>String(w.id_worker||w.worker_id||''));
    workers.filter(w=>w.aktiivne).forEach(w=>{
      const onValitud = g.workers.some(gw=>gw.nimi===w.nimi);
      div.innerHTML+=`<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap;background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:6px 12px"><input type="checkbox" value="${w.id}" class="mt-worker-cb" style="width:auto" ${onValitud?'checked':''}> ${w.nimi}</label>`;
    });
  });
  document.getElementById('muutaTulevaneModal').style.display='flex';
}

async function salvestaMuutaTulevane() {
  const idsStr=document.getElementById('mt-id').value;
  const kuupaev=document.getElementById('mt-kuupaev').value;
  const algus=document.getElementById('mt-algus').value;
  const lopp=document.getElementById('mt-lopp').value;
  const kirjeldus=document.getElementById('mt-kirjeldus').value;
  const ids=idsStr.split(',');
  await Promise.all(ids.map(id=>api(`/api/tood/tulevased/${id}`,{method:'PUT',body:JSON.stringify({kuupaev,algus,lopp,kirjeldus})})));
  document.getElementById('muutaTulevaneModal').style.display='none';
  laadiTulevasteToodTabel(ttAktiivneFilter);
}

function avaaMuutaModal(k) {
  document.getElementById('muuta-id').value=k.id;
  document.getElementById('muuta-algus').value=k.algus.slice(0,5);
  document.getElementById('muuta-lopp').value=k.lopp.slice(0,5);
  document.getElementById('muuta-kuupaev').value=k.kuupaev.slice(0,10);
  document.getElementById('muuta-lisakulu').value=k.lisakulu||0;
  document.getElementById('muuta-lisakulu-sel').value=k.lisakulu_selgitus||'';
  document.getElementById('muuta-komm').value=k.kommentaar||'';
  document.getElementById('muutaModal').style.display='flex';
}

async function salvestaMuutaKirje() {
  const id=document.getElementById('muuta-id').value;
  const algus=document.getElementById('muuta-algus').value;
  const lopp=document.getElementById('muuta-lopp').value;
  const kuupaev=document.getElementById('muuta-kuupaev').value;
  const lisakulu=document.getElementById('muuta-lisakulu').value||0;
  const lisakulu_selgitus=document.getElementById('muuta-lisakulu-sel').value;
  const kommentaar=document.getElementById('muuta-komm').value;
  await api(`/api/admin/kirjed/${id}`,{method:'PUT',body:JSON.stringify({algus,lopp,kuupaev,lisakulu,lisakulu_selgitus,kommentaar})});
  document.getElementById('muutaModal').style.display='none';
  laadiKokkuvote();
}

async function adminKustutaKirje(id) {
  if(!confirm('Kustuta see töökirje?')) return;
  await api(`/api/admin/kirjed/${id}`,{method:'DELETE'});
  laadiKokkuvote();
}

async function salvestaMuuTasu(kirjeId) {
  const tasu=document.getElementById(`muu-tasu-${kirjeId}`).value;
  if(!tasu||parseFloat(tasu)<=0) return alert('Sisesta korrektne tunnitasu');
  await api(`/api/admin/kirjed/${kirjeId}/muu-tasu`,{method:'PUT',body:JSON.stringify({tunnitasu:tasu})});
  laadiKokkuvote();
}

