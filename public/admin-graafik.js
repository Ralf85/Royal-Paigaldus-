// admin-graafik.js — Graafiku loogika (eraldatud admin.html-ist)
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
    kalenderVaade && (kalenderVaade.style.display = 'block');
    nimekirjaVaade && (nimekirjaVaade.style.display = 'none');
    kalBtn.style.background = '#2563eb'; kalBtn.style.color = '#ffffff';
    nimBtn.style.background = 'var(--sisend-piir)'; nimBtn.style.color = 'var(--tekst3)';
    uuendaDefaultKuvamine();
  } else {
    kalenderVaade && (kalenderVaade.style.display = 'none');
    nimekirjaVaade && (nimekirjaVaade.style.display = 'block');
    kalBtn.style.background = 'var(--sisend-piir)'; kalBtn.style.color = 'var(--tekst3)';
    nimBtn.style.background = '#2563eb'; nimBtn.style.color = '#ffffff';
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
      <div class="tootaja-kaart-avatar" style="background:${tootajaVarv(w.id)}">${w.nimi[0]}</div>
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
    
    const vahetusedHtml = vahetused.map(v => {
      const vc = tootajaVarv(v.worker_id), vcRgb = tootajaVarvRgb(v.worker_id);
      return `
      <div class="rakk-vahetus" style="background:rgba(${vcRgb},0.18);border-color:rgba(${vcRgb},0.45);color:${vc}" onclick="avaaMuudaVahetus2(${v.id}, ${v.worker_id}, '${v.algus.slice(0,5)}', '${v.lopp.slice(0,5)}', '${(v['märkus']||'').replace(/'/g,"\\'")}')">
        <span class="rakk-vahetus-nimi">${v.worker_nimi.split(' ')[0]}</span>
        <span class="rakk-vahetus-aeg" style="color:rgba(${vcRgb},0.8)">${v.algus.slice(0,5)}–${v.lopp.slice(0,5)}</span>
        <span class="rakk-vahetus-kustuta" onclick="event.stopPropagation();kustutaVahetus2(${v.id})">✕</span>
      </div>
    `;
    }).join('');
    
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
    if (!tunniMap[v.worker_id]) tunniMap[v.worker_id] = { id: v.worker_id, nimi: v.worker_nimi, tunnid: 0, vahetused: 0 };
    tunniMap[v.worker_id].tunnid += arvutaTunnid(v.algus, v.lopp);
    tunniMap[v.worker_id].vahetused++;
  });

  const sorted = Object.values(tunniMap).sort((a,b) => b.tunnid - a.tunnid);

  grid.innerHTML = sorted.map(w => `
    <div class="kokkuvote-kaart" style="border-left:3px solid ${tootajaVarv(w.id)}">
      <div class="kokkuvote-nimi">${w.nimi}</div>
      <div class="kokkuvote-tunnid" style="color:${tootajaVarv(w.id)}">${w.tunnid.toFixed(1)}h</div>
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
