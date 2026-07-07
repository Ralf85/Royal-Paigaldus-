<!-- 
  TAB8 ASENDUS — kopeeri see admin.html-i sisse, asenda kogu <div class="sektsioon" id="tab8"> blokk 
  Otsi: <div class="sektsioon" id="tab8">
  Asenda kuni järgmise: <div class="sektsioon" id="tab9">
-->

<div class="sektsioon" id="tab8">
  <style>
    /* ── GRAAFIK LAYOUT ─────────────────────────────────────── */
    .graafik-wrapper { display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: start; }
    
    /* Töötajate paneel */
    .tootajad-paneel { background: var(--bg2); border: 0.5px solid var(--piir); border-radius: 14px; overflow: hidden; position: sticky; top: 16px; }
    .tootajad-paneel-hdr { padding: 12px 14px; border-bottom: 0.5px solid var(--piir2); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--hall); }
    .tootaja-kaart { padding: 10px 14px; border-bottom: 0.5px solid var(--piir3); cursor: grab; user-select: none; transition: background 0.15s; display: flex; align-items: center; gap: 8px; }
    .tootaja-kaart:last-child { border-bottom: none; }
    .tootaja-kaart:hover { background: rgba(201,168,76,0.08); }
    .tootaja-kaart.lohistatakse { opacity: 0.4; cursor: grabbing; }
    .tootaja-kaart-avatar { width: 28px; height: 28px; background: linear-gradient(135deg, #c9a84c, #f0d080); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #0d0f13; flex-shrink: 0; }
    .tootaja-kaart-nimi { font-size: 12px; font-weight: 600; color: var(--tekst2); }
    .tootaja-kaart-tunnid { font-size: 10px; color: var(--hall); margin-top: 1px; }

    /* Default kellaaeg paneel */
    .default-kellaaeg-paneel { background: var(--bg2); border: 0.5px solid var(--piir); border-radius: 14px; overflow: hidden; margin-top: 10px; }
    .default-kellaaeg-hdr { padding: 10px 14px; border-bottom: 0.5px solid var(--piir2); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--hall); display: flex; justify-content: space-between; align-items: center; }
    .default-kellaaeg-rida { padding: 7px 14px; border-bottom: 0.5px solid var(--piir3); font-size: 11px; display: flex; justify-content: space-between; align-items: center; }
    .default-kellaaeg-rida:last-child { border-bottom: none; }
    .default-kellaaeg-label { color: var(--hall); }
    .default-kellaaeg-aeg { color: #c9a84c; font-weight: 600; font-family: monospace; font-size: 11px; }

    /* Kalender */
    .kalender-paneel { background: var(--bg2); border: 0.5px solid var(--piir); border-radius: 14px; overflow: hidden; }
    .kalender-hdr { padding: 14px 18px; border-bottom: 0.5px solid var(--piir2); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .kalender-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
    .kalender-paev-label { padding: 8px 4px; text-align: center; font-size: 10px; color: var(--hall); text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 0.5px solid var(--piir2); }
    .kalender-paev-label.nadalaloppupaev { color: #5b9cf6; }
    
    .kalender-rakk { min-height: 90px; border-right: 0.5px solid var(--piir3); border-bottom: 0.5px solid var(--piir3); padding: 4px; position: relative; transition: background 0.15s; vertical-align: top; }
    .kalender-rakk:nth-child(7n) { border-right: none; }
    .kalender-rakk.tana { background: rgba(201,168,76,0.05); }
    .kalender-rakk.tana .rakk-nr { color: #c9a84c; }
    .kalender-rakk.tyyhi { background: var(--bg3); opacity: 0.4; }
    .kalender-rakk.lohistatakse-ule { background: rgba(201,168,76,0.12); border: 1px dashed #c9a84c; }
    .kalender-rakk.nadalaloppupaev { background: rgba(91,156,246,0.03); }
    .kalender-rakk.suletud { background: rgba(239,68,68,0.05); }
    .kalender-rakk.suuryritus { background: rgba(30,58,95,0.5); }
    .kalender-rakk.kohvik { background: rgba(15,45,26,0.5); }

    .rakk-nr { font-size: 11px; font-weight: 700; color: var(--tekst3); margin-bottom: 3px; padding: 1px 3px; }
    .rakk-staatus { font-size: 9px; color: var(--hall); margin-bottom: 3px; }
    .rakk-vahetus { background: rgba(201,168,76,0.15); border: 0.5px solid rgba(201,168,76,0.3); border-radius: 4px; padding: 2px 5px; margin-bottom: 2px; font-size: 10px; color: #c9a84c; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 3px; }
    .rakk-vahetus:hover { background: rgba(201,168,76,0.25); }
    .rakk-vahetus-nimi { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .rakk-vahetus-aeg { font-size: 9px; color: rgba(201,168,76,0.7); white-space: nowrap; }
    .rakk-vahetus-kustuta { color: rgba(239,68,68,0.6); font-size: 10px; padding: 0 1px; flex-shrink: 0; }
    .rakk-vahetus-kustuta:hover { color: #ef4444; }

    /* Kuu kokkuvõte */
    .kokkuvote-paneel { background: var(--bg2); border: 0.5px solid var(--piir); border-radius: 14px; overflow: hidden; margin-top: 16px; }
    .kokkuvote-hdr { padding: 12px 18px; border-bottom: 0.5px solid var(--piir2); font-size: 13px; font-weight: 600; color: var(--tekst2); }
    .kokkuvote-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1px; background: var(--piir2); }
    .kokkuvote-kaart { background: var(--bg2); padding: 12px 16px; }
    .kokkuvote-nimi { font-size: 12px; font-weight: 600; color: var(--tekst2); margin-bottom: 4px; }
    .kokkuvote-tunnid { font-size: 20px; font-weight: 700; color: #c9a84c; }
    .kokkuvote-vahetused { font-size: 10px; color: var(--hall); margin-top: 2px; }

    /* Muuda vahetus modal */
    .muuda-vahetus-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 2000; align-items: center; justify-content: center; }
    .muuda-vahetus-modal.avatud { display: flex; }
    .muuda-vahetus-sisu { background: var(--bg2); border: 0.5px solid var(--piir); border-radius: 16px; padding: 24px; width: 100%; max-width: 380px; margin: 20px; }

    @media (max-width: 768px) {
      .graafik-wrapper { grid-template-columns: 1fr; }
      .tootajad-paneel { position: static; }
      .kalender-rakk { min-height: 60px; }
    }
  </style>

  <!-- Ülemine kontrollriba -->
  <div class="kaart" style="margin-bottom:16px">
    <div class="kaart-body" style="padding:14px 18px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <select id="g-admin-kuu" style="width:auto"></select>
        <select id="g-admin-aasta" style="width:auto"></select>
        <button class="nupp kull" onclick="laadiAdminGraafik()">Näita</button>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button onclick="setGraafikVaade('kalender')" id="vaade-kalender" style="background:#c9a84c;color:#0d0f13;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">📅 Lohistusvaade</button>
          <button onclick="setGraafikVaade('nimekiri')" id="vaade-nimekiri" style="background:var(--sisend-piir);color:var(--tekst3);border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer">☰ Nimekiri</button>
        </div>
      </div>
    </div>
  </div>

  <!-- LOHISTUSVAADE -->
  <div id="graafik-lohistus-vaade">
    <div class="graafik-wrapper">
      <!-- Vasak: töötajad + default kellaaeg -->
      <div>
        <div class="tootajad-paneel">
          <div class="tootajad-paneel-hdr">👷 Töötajad</div>
          <div id="g-tootajad-nimekiri">
            <div style="padding:16px;color:var(--hall);font-size:12px">Laadimine...</div>
          </div>
        </div>

        <div class="default-kellaaeg-paneel">
          <div class="default-kellaaeg-hdr">
            <span>⏰ Default kellaaeg</span>
            <button onclick="toggleDefaultEdit()" style="background:none;border:none;color:#c9a84c;font-size:11px;cursor:pointer" id="default-edit-nupp">✏️ Muuda</button>
          </div>
          <div id="default-kellaaeg-kuvamine">
            <div class="default-kellaaeg-rida"><span class="default-kellaaeg-label">E–R</span><span class="default-kellaaeg-aeg" id="def-er-kuvamine">11:00–21:00</span></div>
            <div class="default-kellaaeg-rida"><span class="default-kellaaeg-label">Laupäev</span><span class="default-kellaaeg-aeg" id="def-l-kuvamine">10:00–21:00</span></div>
            <div class="default-kellaaeg-rida"><span class="default-kellaaeg-label">Pühapäev</span><span class="default-kellaaeg-aeg" id="def-p-kuvamine">10:00–20:00</span></div>
          </div>
          <div id="default-kellaaeg-muutmine" style="display:none;padding:10px 14px">
            <div style="margin-bottom:8px">
              <div style="font-size:10px;color:var(--hall);margin-bottom:4px">E–R algus / lõpp</div>
              <div style="display:flex;gap:6px">
                <input type="time" id="def-er-algus" value="11:00" style="flex:1;font-size:12px;padding:5px 8px">
                <input type="time" id="def-er-lopp" value="21:00" style="flex:1;font-size:12px;padding:5px 8px">
              </div>
            </div>
            <div style="margin-bottom:8px">
              <div style="font-size:10px;color:var(--hall);margin-bottom:4px">Laupäev algus / lõpp</div>
              <div style="display:flex;gap:6px">
                <input type="time" id="def-l-algus" value="10:00" style="flex:1;font-size:12px;padding:5px 8px">
                <input type="time" id="def-l-lopp" value="21:00" style="flex:1;font-size:12px;padding:5px 8px">
              </div>
            </div>
            <div style="margin-bottom:10px">
              <div style="font-size:10px;color:var(--hall);margin-bottom:4px">Pühapäev algus / lõpp</div>
              <div style="display:flex;gap:6px">
                <input type="time" id="def-p-algus" value="10:00" style="flex:1;font-size:12px;padding:5px 8px">
                <input type="time" id="def-p-lopp" value="20:00" style="flex:1;font-size:12px;padding:5px 8px">
              </div>
            </div>
            <button onclick="salvestaDefaultKellaaeg()" style="background:#c9a84c;color:#0d0f13;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;width:100%">Salvesta</button>
          </div>
        </div>
      </div>

      <!-- Parem: kalender -->
      <div>
        <div class="kalender-paneel">
          <div class="kalender-hdr">
            <span style="font-size:14px;font-weight:600;color:var(--tekst2)" id="kalender-pealkiri">Juuli 2026</span>
            <span style="font-size:11px;color:var(--hall)">Lohista nimi päeva peale</span>
          </div>
          <div class="kalender-grid" id="g-kalender-grid">
            <div class="kalender-paev-label">E</div>
            <div class="kalender-paev-label">T</div>
            <div class="kalender-paev-label">K</div>
            <div class="kalender-paev-label">N</div>
            <div class="kalender-paev-label">R</div>
            <div class="kalender-paev-label nadalaloppupaev">L</div>
            <div class="kalender-paev-label nadalaloppupaev">P</div>
            <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--hall);font-size:13px">Vali kuu ja vajuta Näita</div>
          </div>
        </div>

        <!-- Kuu kokkuvõte -->
        <div class="kokkuvote-paneel" id="g-kokkuvote-paneel" style="display:none">
          <div class="kokkuvote-hdr">📊 Kuu kokkuvõte — tunnid töötaja kaupa</div>
          <div class="kokkuvote-grid" id="g-kokkuvote-grid"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- NIMEKIRJAVAADE (vana) -->
  <div id="graafik-nimekiri-vaade" style="display:none">
    <div class="kaart">
      <div class="kaart-body">
        <div style="background:var(--bg3);border:0.5px solid var(--sisend-piir);border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="font-size:12px;color:var(--hall);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Lisa vahetus käsitsi</div>
          <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
            <div><label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Töötaja</label>
              <select id="g-lisa-worker" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;width:auto"></select></div>
            <div><label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Kuupäev</label>
              <input type="date" id="g-lisa-kuupaev" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;color-scheme:dark"></div>
            <div><label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Algus</label>
              <input type="time" id="g-lisa-algus" value="11:00" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px"></div>
            <div><label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Lõpp</label>
              <input type="time" id="g-lisa-lopp" value="21:00" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px"></div>
            <div style="flex:1;min-width:120px"><label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Märkus</label>
              <input type="text" id="g-lisa-markus" placeholder="vabatahtlik" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;width:100%"></div>
            <button onclick="adminLisaVahetus()" style="background:#4ade80;color:#0d0f13;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">+ Lisa</button>
          </div>
          <div id="g-lisa-teade" style="margin-top:8px;font-size:12px;display:none"></div>
        </div>
        <div style="background:var(--bg3);border:0.5px solid var(--sisend-piir);border-radius:10px;padding:14px;margin-bottom:16px">
          <div style="font-size:12px;color:var(--hall);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Päeva haldus</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="date" id="g-admin-paev" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;color-scheme:dark">
            <select id="g-admin-staatus" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;width:auto">
              <option value="tavaline">Tavaline</option>
              <option value="suuryritus">🔵 Suurüritus</option>
              <option value="kohvik">🟢 Ainult kohvik</option>
              <option value="suletud">🔴 Suletud</option>
            </select>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--tekst3);cursor:pointer">
              <input type="checkbox" id="g-admin-lukk"> 🔒 Lukusta
            </label>
            <input type="text" id="g-admin-markus" placeholder="Märkus (vabatahtlik)" style="background:var(--bg2);border:0.5px solid var(--sisend-piir);border-radius:8px;padding:7px 10px;color:var(--tekst);font-size:13px;flex:1;min-width:150px">
            <button class="nupp kull" onclick="salvestaPaev()" style="padding:7px 16px">Salvesta</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <span style="font-size:11px;color:var(--hall)">Kiirvalik:</span>
            <button onclick="setStaatus('suuryritus',false)" style="background:#1e3a5f;border:none;border-radius:4px;padding:3px 8px;font-size:11px;color:#5b9cf6;cursor:pointer">🔵 Suurüritus</button>
            <button onclick="setStaatus('kohvik',false)" style="background:#0f2d1a;border:none;border-radius:4px;padding:3px 8px;font-size:11px;color:#4ade80;cursor:pointer">🟢 Kohvik</button>
            <button onclick="setStaatus('suletud',true)" style="background:#2d0a0a;border:none;border-radius:4px;padding:3px 8px;font-size:11px;color:#ef4444;cursor:pointer">🔒 Lukusta</button>
            <button onclick="setStaatus('tavaline',false)" style="background:var(--sisend-piir);border:none;border-radius:4px;padding:3px 8px;font-size:11px;color:var(--tekst3);cursor:pointer">Tühista</button>
          </div>
        </div>
      </div>
    </div>
    <div class="kaart">
      <div class="kaart-hdr">📋 Kuu graafik nimekirjana</div>
      <div id="adminGraafikSisu" style="padding:16px">Laadimine...</div>
    </div>
  </div>
</div>

<!-- Muuda vahetust modal -->
<div class="muuda-vahetus-modal" id="muudaVahetusModal2">
  <div class="muuda-vahetus-sisu">
    <h3 style="margin-bottom:16px;color:var(--tekst);font-size:15px">✏️ Muuda vahetust</h3>
    <input type="hidden" id="mv2-id">
    <div style="margin-bottom:12px">
      <label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Töötaja</label>
      <select id="mv2-worker" style="width:100%"></select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Algus</label>
        <input type="time" id="mv2-algus" style="width:100%">
      </div>
      <div>
        <label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Lõpp</label>
        <input type="time" id="mv2-lopp" style="width:100%">
      </div>
    </div>
    <div style="margin-bottom:18px">
      <label style="font-size:11px;color:var(--hall);display:block;margin-bottom:4px">Märkus</label>
      <input type="text" id="mv2-markus" placeholder="vabatahtlik" style="width:100%">
    </div>
    <div style="display:flex;gap:10px">
      <button onclick="salvestaMuudaVahetus2()" style="flex:1;background:#c9a84c;color:#0d0f13;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">Salvesta</button>
      <button onclick="document.getElementById('muudaVahetusModal2').classList.remove('avatud')" style="background:var(--sisend-piir);color:var(--tekst3);border:none;border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer">Tühista</button>
    </div>
  </div>
</div>

<script>
// ── GRAAFIKU MUUTUJAD ─────────────────────────────────────────────
let graafikAndmed = null;
let aktiivsGraafikVaade = 'kalender';
let lohistatavWorkerId = null;
let lohistatavWorkerNimi = null;
let merekohvikTootajad = [];
let graafikKuuAndmed = { vahetused: [], paevad: [] };

// Default kellaaegade laadimine localStorage-st
function laadiDefaultKellaaeg() {
  const salvestatud = JSON.parse(localStorage.getItem('graafikDefaultKellaaeg') || 'null');
  return salvestatud || {
    er: { algus: '11:00', lopp: '21:00' },
    l:  { algus: '10:00', lopp: '21:00' },
    p:  { algus: '10:00', lopp: '20:00' }
  };
}

function uuendaDefaultKuvamine() {
  const d = laadiDefaultKellaaeg();
  const erEl = document.getElementById('def-er-kuvamine');
  const lEl = document.getElementById('def-l-kuvamine');
  const pEl = document.getElementById('def-p-kuvamine');
  if (erEl) erEl.textContent = `${d.er.algus}–${d.er.lopp}`;
  if (lEl) lEl.textContent = `${d.l.algus}–${d.l.lopp}`;
  if (pEl) pEl.textContent = `${d.p.algus}–${d.p.lopp}`;
  const erA = document.getElementById('def-er-algus');
  const erL = document.getElementById('def-er-lopp');
  const lA = document.getElementById('def-l-algus');
  const lL = document.getElementById('def-l-lopp');
  const pA = document.getElementById('def-p-algus');
  const pL = document.getElementById('def-p-lopp');
  if (erA) { erA.value = d.er.algus; erL.value = d.er.lopp; }
  if (lA) { lA.value = d.l.algus; lL.value = d.l.lopp; }
  if (pA) { pA.value = d.p.algus; pL.value = d.p.lopp; }
}

function toggleDefaultEdit() {
  const muutmine = document.getElementById('default-kellaaeg-muutmine');
  const kuvamine = document.getElementById('default-kellaaeg-kuvamine');
  const nupp = document.getElementById('default-edit-nupp');
  const avatud = muutmine.style.display !== 'none';
  muutmine.style.display = avatud ? 'none' : 'block';
  kuvamine.style.display = avatud ? 'block' : 'none';
  nupp.textContent = avatud ? '✏️ Muuda' : '✕ Sulge';
}

function salvestaDefaultKellaaeg() {
  const d = {
    er: { algus: document.getElementById('def-er-algus').value, lopp: document.getElementById('def-er-lopp').value },
    l:  { algus: document.getElementById('def-l-algus').value, lopp: document.getElementById('def-l-lopp').value },
    p:  { algus: document.getElementById('def-p-algus').value, lopp: document.getElementById('def-p-lopp').value }
  };
  localStorage.setItem('graafikDefaultKellaaeg', JSON.stringify(d));
  uuendaDefaultKuvamine();
  toggleDefaultEdit();
}

function getDefaultKellaaeg(iso) {
  const d = laadiDefaultKellaaeg();
  const paev = new Date(iso + 'T12:00:00').getDay(); // 0=P, 6=L
  if (paev === 0) return d.p;
  if (paev === 6) return d.l;
  return d.er;
}

// ── GRAAFIKU VAADE ────────────────────────────────────────────────
function setGraafikVaade(vaade) {
  aktiivsGraafikVaade = vaade;
  const kalenderVaade = document.getElementById('graafik-lohistus-vaade');
  const nimekirjaVaade = document.getElementById('graafik-nimekiri-vaade');
  const kalBtn = document.getElementById('vaade-kalender');
  const nimBtn = document.getElementById('vaade-nimekiri');
  
  if (vaade === 'kalender') {
    kalenterVaade && (kalenderVaade.style.display = 'block');
    nimekirjaVaade && (nimekirjaVaade.style.display = 'none');
    kalBtn.style.background = '#c9a84c'; kalBtn.style.color = '#0d0f13';
    nimBtn.style.background = 'var(--sisend-piir)'; nimBtn.style.color = 'var(--tekst3)';
    uuendaDefaultKuvamine();
  } else {
    kalenderVaade && (kalenderVaade.style.display = 'none');
    nimekirjaVaade && (nimekirjaVaade.style.display = 'block');
    kalBtn.style.background = 'var(--sisend-piir)'; kalBtn.style.color = 'var(--tekst3)';
    nimBtn.style.background = '#c9a84c'; nimBtn.style.color = '#0d0f13';
    if (graafikKuuAndmed) kuvaNimekirja(graafikKuuAndmed);
  }
}

// ── TÖÖTAJATE NIMEKIRI ────────────────────────────────────────────
async function laadiMerekohvikTootajad() {
  try {
    const r = await api('/api/graafik/merekohvik-tootajad');
    if (r.tootajad) {
      merekohvikTootajad = r.tootajad;
      kuvaLohistatavadTootajad();
    }
  } catch(e) {
    console.error('Töötajate laadimine ebaõnnestus:', e);
  }
}

function kuvaLohistatavadTootajad() {
  const div = document.getElementById('g-tootajad-nimekiri');
  if (!div) return;
  
  // Arvuta tunnid kuu andmetest
  const tunniMap = {};
  if (graafikKuuAndmed && graafikKuuAndmed.vahetused) {
    graafikKuuAndmed.vahetused.forEach(v => {
      if (!tunniMap[v.worker_id]) tunniMap[v.worker_id] = { tunnid: 0, vahetused: 0 };
      tunniMap[v.worker_id].tunnid += arvutaTunnid(v.algus, v.lopp);
      tunniMap[v.worker_id].vahetused++;
    });
  }

  div.innerHTML = merekohvikTootajad.map(w => {
    const info = tunniMap[w.id] || { tunnid: 0, vahetused: 0 };
    return `<div class="tootaja-kaart" 
      draggable="true"
      ondragstart="algaLohistamine(event, ${w.id}, '${w.nimi.replace(/'/g, "\\'")}')">
      <div class="tootaja-kaart-avatar">${w.nimi[0]}</div>
      <div style="min-width:0">
        <div class="tootaja-kaart-nimi">${w.nimi}</div>
        <div class="tootaja-kaart-tunnid">${info.tunnid > 0 ? info.tunnid.toFixed(1) + 'h · ' + info.vahetused + ' vahetust' : 'pole planeeritud'}</div>
      </div>
    </div>`;
  }).join('');
}

function arvutaTunnid(algus, lopp) {
  if (!algus || !lopp) return 0;
  const [ah, am] = algus.slice(0,5).split(':').map(Number);
  const [lh, lm] = lopp.slice(0,5).split(':').map(Number);
  let min = (lh * 60 + lm) - (ah * 60 + am);
  if (min < 0) min += 1440;
  return min / 60;
}

// ── LOHISTAMINE ───────────────────────────────────────────────────
function algaLohistamine(event, workerId, workerNimi) {
  lohistatavWorkerId = workerId;
  lohistatavWorkerNimi = workerNimi;
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', workerId);
  event.currentTarget.classList.add('lohistatakse');
  setTimeout(() => event.currentTarget.classList.remove('lohistatakse'), 100);
}

function lohitatakseUle(event, iso) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  document.querySelectorAll('.kalender-rakk').forEach(r => r.classList.remove('lohistatakse-ule'));
  const rakk = document.getElementById('rakk-' + iso);
  if (rakk) rakk.classList.add('lohistatakse-ule');
}

function lohitatakseAra(iso) {
  const rakk = document.getElementById('rakk-' + iso);
  if (rakk) rakk.classList.remove('lohistatakse-ule');
}

async function kukutatudPaevale(event, iso) {
  event.preventDefault();
  document.querySelectorAll('.kalender-rakk').forEach(r => r.classList.remove('lohistatakse-ule'));
  
  if (!lohistatavWorkerId) return;
  
  const kellaaeg = getDefaultKellaaeg(iso);
  
  // Lisa otse ilma kinnituseta
  const r = await api('/api/graafik/admin/lisa', {
    method: 'POST',
    body: JSON.stringify({
      worker_id: lohistatavWorkerId,
      kuupaev: iso,
      algus: kellaaeg.algus,
      lopp: kellaaeg.lopp,
      märkus: ''
    })
  });
  
  if (r.ok) {
    await laadiAdminGraafik();
  } else {
    alert(r.veateade || 'Viga lisamisel');
  }
  
  lohistatavWorkerId = null;
  lohistatavWorkerNimi = null;
}

// ── KALENDER KUVA ─────────────────────────────────────────────────
async function laadiAdminGraafik() {
  const kuu = document.getElementById('g-admin-kuu')?.value || (new Date().getMonth() + 1);
  const aasta = document.getElementById('g-admin-aasta')?.value || new Date().getFullYear();
  
  const kuudNimed = ['Jaanuar','Veebruar','Märts','Aprill','Mai','Juuni','Juuli','August','September','Oktoober','November','Detsember'];
  const pealkirjaEl = document.getElementById('kalender-pealkiri');
  if (pealkirjaEl) pealkirjaEl.textContent = kuudNimed[kuu-1] + ' ' + aasta;
  
  const vastus = await api(`/api/graafik/admin/kuu?aasta=${aasta}&kuu=${kuu}`);
  if (!vastus || !vastus.vahetused) return;
  
  graafikKuuAndmed = vastus;
  graafikAndmed = vastus;
  
  if (aktiivsGraafikVaade === 'kalender') {
    kuvaKalender(vastus, parseInt(aasta), parseInt(kuu));
  } else {
    kuvaNimekirja(vastus);
  }
  
  kuvaKokkuvote(vastus);
  kuvaLohistatavadTootajad();
  
  // Uuenda töötaja select nimekirjavaates
  const sel = document.getElementById('g-lisa-worker');
  if (sel && merekohvikTootajad.length) {
    sel.innerHTML = merekohvikTootajad.map(w => `<option value="${w.id}">${w.nimi}</option>`).join('');
  }
  
  // Uuenda muuda vahetus modal töötajad
  const mv2 = document.getElementById('mv2-worker');
  if (mv2 && merekohvikTootajad.length) {
    mv2.innerHTML = merekohvikTootajad.map(w => `<option value="${w.id}">${w.nimi}</option>`).join('');
  }
}

function kuvaKalender(andmed, aasta, kuu) {
  const grid = document.getElementById('g-kalender-grid');
  if (!grid) return;
  
  const paevadMap = {};
  andmed.paevad.forEach(p => paevadMap[p.kuupaev.split('T')[0]] = p);
  
  const vahetusedMap = {};
  andmed.vahetused.forEach(v => {
    const kp = v.kuupaev.split('T')[0];
    if (!vahetusedMap[kp]) vahetusedMap[kp] = [];
    vahetusedMap[kp].push(v);
  });
  
  const staatusKlass = { suuryritus: 'suuryritus', kohvik: 'kohvik', suletud: 'suletud' };
  
  const esimene = new Date(aasta, kuu - 1, 1);
  const viimane = new Date(aasta, kuu, 0).getDate();
  let algusNadala = esimene.getDay();
  algusNadala = algusNadala === 0 ? 6 : algusNadala - 1; // E=0
  
  const tana = new Date().toISOString().split('T')[0];
  
  let html = `
    <div class="kalender-paev-label">E</div>
    <div class="kalender-paev-label">T</div>
    <div class="kalender-paev-label">K</div>
    <div class="kalender-paev-label">N</div>
    <div class="kalender-paev-label">R</div>
    <div class="kalender-paev-label nadalaloppupaev">L</div>
    <div class="kalender-paev-label nadalaloppupaev">P</div>
  `;
  
  // Tühjad rakud alguses
  for (let i = 0; i < algusNadala; i++) {
    html += `<div class="kalender-rakk tyyhi"></div>`;
  }
  
  for (let p = 1; p <= viimane; p++) {
    const iso = `${aasta}-${String(kuu).padStart(2,'0')}-${String(p).padStart(2,'0')}`;
    const info = paevadMap[iso];
    const vahetused = vahetusedMap[iso] || [];
    const nadalapaev = new Date(iso + 'T12:00:00').getDay();
    const onNadalaloppupaev = nadalapaev === 0 || nadalapaev === 6;
    const staatus = info?.staatus || 'tavaline';
    const klassid = ['kalender-rakk'];
    if (iso === tana) klassid.push('tana');
    if (onNadalaloppupaev) klassid.push('nadalaloppupaev');
    if (staatusKlass[staatus]) klassid.push(staatusKlass[staatus]);
    if (info?.lukustatud) klassid.push('lukustatud');
    
    const vahetusedHtml = vahetused.map(v => `
      <div class="rakk-vahetus" onclick="avaaMuudaVahetus2(${v.id}, ${v.worker_id}, '${v.algus.slice(0,5)}', '${v.lopp.slice(0,5)}', '${(v['märkus']||'').replace(/'/g,"\\'")}')">
        <span class="rakk-vahetus-nimi">${v.worker_nimi.split(' ')[0]}</span>
        <span class="rakk-vahetus-aeg">${v.algus.slice(0,5)}–${v.lopp.slice(0,5)}</span>
        <span class="rakk-vahetus-kustuta" onclick="event.stopPropagation();kustutaVahetus2(${v.id})">✕</span>
      </div>
    `).join('');
    
    const staatusMark = staatus === 'suletud' ? '🔴' : staatus === 'suuryritus' ? '🔵' : staatus === 'kohvik' ? '🟢' : '';
    
    html += `<div class="${klassid.join(' ')}" id="rakk-${iso}"
      ondragover="lohitatakseUle(event, '${iso}')"
      ondragleave="lohitatakseAra('${iso}')"
      ondrop="kukutatudPaevale(event, '${iso}')">
      <div class="rakk-nr">${p}${info?.lukustatud ? ' 🔒' : ''}</div>
      ${staatusMark ? `<div class="rakk-staatus">${staatusMark}</div>` : ''}
      ${vahetusedHtml}
    </div>`;
  }
  
  grid.innerHTML = html;
}

// ── KOKKUVÕTE ─────────────────────────────────────────────────────
function kuvaKokkuvote(andmed) {
  const paneel = document.getElementById('g-kokkuvote-paneel');
  const grid = document.getElementById('g-kokkuvote-grid');
  if (!paneel || !grid) return;
  
  if (!andmed.vahetused.length) {
    paneel.style.display = 'none';
    return;
  }
  
  const tunniMap = {};
  andmed.vahetused.forEach(v => {
    if (!tunniMap[v.worker_id]) tunniMap[v.worker_id] = { nimi: v.worker_nimi, tunnid: 0, vahetused: 0 };
    tunniMap[v.worker_id].tunnid += arvutaTunnid(v.algus, v.lopp);
    tunniMap[v.worker_id].vahetused++;
  });
  
  const sorted = Object.values(tunniMap).sort((a,b) => b.tunnid - a.tunnid);
  
  grid.innerHTML = sorted.map(w => `
    <div class="kokkuvote-kaart">
      <div class="kokkuvote-nimi">${w.nimi}</div>
      <div class="kokkuvote-tunnid">${w.tunnid.toFixed(1)}h</div>
      <div class="kokkuvote-vahetused">${w.vahetused} vahetust</div>
    </div>
  `).join('');
  
  paneel.style.display = 'block';
}

// ── NIMEKIRJAVAADE (vana loogika) ────────────────────────────────
function kuvaNimekirja(andmed) {
  const div = document.getElementById('adminGraafikSisu');
  if (!div) return;
  
  const vahetused = andmed.vahetused, paevadInfo = andmed.paevad || [], paevadMap = {};
  paevadInfo.forEach(p => paevadMap[p.kuupaev.split('T')[0]] = p);
  const paevadGrupp = {};
  vahetused.forEach(v => { const kp = v.kuupaev.split('T')[0]; if(!paevadGrupp[kp]) paevadGrupp[kp]=[]; paevadGrupp[kp].push(v); });
  paevadInfo.forEach(p => { const kp = p.kuupaev.split('T')[0]; if(!paevadGrupp[kp]) paevadGrupp[kp]=[]; });
  const staatusNimi = { tavaline:'', suuryritus:'🔵 Suurüritus', kohvik:'🟢 Ainult kohvik', suletud:'🔴 Suletud' };
  const KUUD2 = ['Jaanuar','Veebruar','Märts','Aprill','Mai','Juuni','Juuli','August','September','Oktoober','November','Detsember'];
  if(!Object.keys(paevadGrupp).length){ div.innerHTML='<div style="color:var(--hall);text-align:center;padding:20px">Selle kuu kirjeid pole</div>'; return; }
  div.innerHTML = Object.entries(paevadGrupp).sort().map(([kp, vahetusedKuupaev]) => {
    const d = new Date(kp+'T12:00:00'), nadalaPaev = ['P','E','T','K','N','R','L'][d.getDay()];
    const info = paevadMap[kp], staatus = info?.staatus||'tavaline';
    return `<div style="padding:10px 0;border-bottom:0.5px solid var(--piir2)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700;color:var(--tekst)">${d.getDate()}. ${KUUD2[d.getMonth()].slice(0,3)} (${nadalaPaev})</span>
        ${info?.lukustatud?'<span style="font-size:10px;color:#ef4444">🔒</span>':''}
        ${staatusNimi[staatus]?`<span style="font-size:11px;color:var(--tekst3)">${staatusNimi[staatus]}</span>`:''}
      </div>
      ${vahetusedKuupaev.length ? vahetusedKuupaev.map(v=>`
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0;font-size:12px">
          <span style="color:var(--hall);min-width:90px">${v.algus.slice(0,5)}–${v.lopp.slice(0,5)}</span>
          <span style="color:var(--tekst2);font-weight:600">${v.worker_nimi}</span>
          <button onclick='avaaMuudaVahetus2(${v.id}, ${v.worker_id}, "${v.algus.slice(0,5)}", "${v.lopp.slice(0,5)}", "${(v["märkus"]||"").replace(/"/g,"&quot;")}")' style="background:none;border:none;color:#5b9cf6;cursor:pointer">✏️</button>
          <button onclick="kustutaVahetus2(${v.id})" style="background:none;border:none;color:var(--hall);cursor:pointer">🗑</button>
        </div>`).join('') : '<div style="font-size:12px;color:#333">Vahetusi pole</div>'}
    </div>`;
  }).join('');
}

// ── MUUDA / KUSTUTA ───────────────────────────────────────────────
function avaaMuudaVahetus2(id, workerId, algus, lopp, markus) {
  document.getElementById('mv2-id').value = id;
  document.getElementById('mv2-algus').value = algus;
  document.getElementById('mv2-lopp').value = lopp;
  document.getElementById('mv2-markus').value = markus || '';
  const sel = document.getElementById('mv2-worker');
  if (sel) {
    Array.from(sel.options).forEach(o => o.selected = (parseInt(o.value) === workerId));
  }
  document.getElementById('muudaVahetusModal2').classList.add('avatud');
}

async function salvestaMuudaVahetus2() {
  const id = document.getElementById('mv2-id').value;
  const r = await api(`/api/graafik/admin/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      worker_id: document.getElementById('mv2-worker').value,
      algus: document.getElementById('mv2-algus').value,
      lopp: document.getElementById('mv2-lopp').value,
      märkus: document.getElementById('mv2-markus').value
    })
  });
  if (r.ok) {
    document.getElementById('muudaVahetusModal2').classList.remove('avatud');
    await laadiAdminGraafik();
  } else {
    alert(r.veateade || 'Viga salvestamisel');
  }
}

async function kustutaVahetus2(id) {
  if (!confirm('Kustutad selle vahetuse?')) return;
  await api(`/api/graafik/admin/${id}`, { method: 'DELETE' });
  await laadiAdminGraafik();
}

// ── PÄEVA HALDUS ──────────────────────────────────────────────────
function dokliPaev(kp) { const el = document.getElementById('g-admin-paev'); if(el) el.value = kp; }
function setStaatus(staatus, lukustatud) { 
  const s = document.getElementById('g-admin-staatus');
  const l = document.getElementById('g-admin-lukk');
  if(s) s.value = staatus; 
  if(l) l.checked = lukustatud; 
}

async function salvestaPaev() {
  const kuupaev = document.getElementById('g-admin-paev')?.value;
  const staatus = document.getElementById('g-admin-staatus')?.value;
  const lukustatud = document.getElementById('g-admin-lukk')?.checked;
  const markus = document.getElementById('g-admin-markus')?.value || '';
  if(!kuupaev){ alert('Vali kuupäev!'); return; }
  const r = await api('/api/graafik/admin/paev', {method:'POST', body:JSON.stringify({kuupaev, staatus, märkus: markus, lukustatud})});
  if(r.ok){ laadiAdminGraafik(); const el = document.getElementById('g-admin-markus'); if(el) el.value=''; }
  else alert(r.veateade||'Viga');
}

// ── KÄSITSI LISA (nimekirjavaade) ────────────────────────────────
async function adminLisaVahetus() {
  const worker_id = document.getElementById('g-lisa-worker')?.value;
  const kuupaev = document.getElementById('g-lisa-kuupaev')?.value;
  const algus = document.getElementById('g-lisa-algus')?.value;
  const lopp = document.getElementById('g-lisa-lopp')?.value;
  const markus = document.getElementById('g-lisa-markus')?.value || '';
  const teade = document.getElementById('g-lisa-teade');
  if(!worker_id||!kuupaev||!algus||!lopp){ if(teade){teade.style.display='block';teade.style.color='#ef4444';teade.textContent='Täida kõik väljad!';} return; }
  const r = await api('/api/graafik/admin/lisa', {method:'POST', body:JSON.stringify({worker_id, kuupaev, algus, lopp, märkus: markus})});
  if(r.ok){ if(teade) teade.style.display='none'; const m = document.getElementById('g-lisa-markus'); if(m) m.value=''; laadiAdminGraafik(); }
  else { if(teade){teade.style.display='block';teade.style.color='#ef4444';teade.textContent=r.veateade||'Viga lisamisel';} }
}

// Sule modal klõpsuga taustale
document.getElementById('muudaVahetusModal2')?.addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('avatud');
});
</script>
