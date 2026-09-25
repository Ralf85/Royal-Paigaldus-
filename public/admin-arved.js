// admin-arved.js — Arved, Müüjad, Oma arved. Viimane fail: kutsub lõpus init().
// ── ARVED ─────────────────────────────────────────────────────────
let avRead = [];

function avFmtEur(n) { return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €'; }

// Vanemad üleslaetud failid (enne kui koodis lisati failidele käsitsi .pdf laiend) on Cloudinary's
// salvestatud ilma laiendita — Cloudinary'i "raw" tüüp ei tea siis, mis failitüüp see on, ja
// brauser näitab tühja lehte. Lisame laiendi vaates endas juurde, kui see puudub, andmebaasi
// midagi muutmata.
function avFailUrl(url) {
  if (!url) return url;
  const viimaneOsa = url.split('/').pop().split('?')[0];
  if (/\.[a-zA-Z0-9]{2,5}$/.test(viimaneOsa)) return url;
  return url + '.pdf';
}

let avKliendidList = [];

async function laadiArved() {
  const kliendid = await api('/api/arved/kliendid');
  avKliendidList = Array.isArray(kliendid) ? kliendid : [];
  const sel = document.getElementById('av-klient');
  const ettevotteOpts = kõikEttevotted.filter(e => e.tyyp !== 'edgf').map(e => `<option value="e-${e.id}">${e.nimi}</option>`).join('');
  const kliendiOpts = avKliendidList.map(k => `<option value="k-${k.id}">${k.nimi}</option>`).join('');
  sel.innerHTML = '<option value="">— Vali klient —</option>' +
    `<optgroup label="Minu ettevõtted">${ettevotteOpts}</optgroup>` +
    (kliendiOpts ? `<optgroup label="Muud kliendid">${kliendiOpts}</optgroup>` : '');
  const asSel = document.getElementById('as-ettevote');
  if (asSel) {
    asSel.innerHTML = '<option value="">— Muu / üldkulu —</option>' +
      kõikEttevotted.filter(e => e.tyyp !== 'edgf').map(e => `<option value="${e.id}">${e.nimi}</option>`).join('');
  }
  const alSel = document.getElementById('al-ettevote');
  if (alSel) {
    alSel.innerHTML = '<option value="">— vali —</option>' +
      kõikEttevotted.filter(e => e.tyyp !== 'edgf').map(e => `<option value="${e.id}">${e.nimi}</option>`).join('');
  }
  const kmAlgusEl = document.getElementById('km-algus');
  const kmLoppEl = document.getElementById('km-lopp');
  if (kmAlgusEl && !kmAlgusEl.value) {
    const t = new Date();
    kmAlgusEl.value = new Date(t.getFullYear(), t.getMonth(), 1).toISOString().split('T')[0];
    kmLoppEl.value = new Date(t.getFullYear(), t.getMonth() + 1, 0).toISOString().split('T')[0];
  }
  const kpEl = document.getElementById('av-kuupaev');
  if (kpEl && !kpEl.value) kpEl.value = new Date().toISOString().split('T')[0];
  const asKpEl = document.getElementById('as-kuupaev');
  if (asKpEl && !asKpEl.value) asKpEl.value = new Date().toISOString().split('T')[0];

  const kuuSel = document.getElementById('av-kuu-valik');
  const aastaSel = document.getElementById('av-aasta-valik');
  if (kuuSel && !kuuSel.options.length) {
    const t = new Date();
    KUUD.forEach((k, i) => { const o = document.createElement('option'); o.value = i + 1; o.textContent = k; if (i === t.getMonth()) o.selected = true; kuuSel.appendChild(o); });
    for (let y = t.getFullYear(); y >= t.getFullYear() - 2; y--) { const o = document.createElement('option'); o.value = y; o.textContent = y; if (y === t.getFullYear()) o.selected = true; aastaSel.appendChild(o); }
  }

  await avmLaadiMuujad();
  laadiArvedTabel();
  laadiSisseTabel();
  avSisseDropzoneSeadista();
  avLaadiDropzoneSeadista();
  avSumupDropzoneSeadista();
  avKiirDropzoneSeadista();
  await avPreviewNumber();
  if (!avRead.length) avLisaRida();
  avJoonistaRead();
}

// ── MÜÜJAD (adminni enda mitme ettevõtte haldus, sama muster mis töötaja Minu Arved moodulis) ──
let avmMuujad = [];
let avKmProtsent = 24;
async function avmLaadiMuujad() {
  const r = await api('/api/arved/muujad');
  avmMuujad = (r && r.ok && Array.isArray(r.muujad)) ? r.muujad : [];
  avmRenderNimekiri();
  avmRenderValik();
}
function avmRenderNimekiri() {
  const div = document.getElementById('avm-nimekiri');
  if (!avmMuujad.length) {
    div.innerHTML = '<div style="font-size:12px;color:var(--hall);padding:8px 0">Ühtegi ettevõtet pole veel lisatud — lisa esimene allolevast nupust.</div>';
    return;
  }
  div.innerHTML = avmMuujad.map(m => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:0.5px solid var(--piir2);flex-wrap:wrap">
      ${m.logo_url ? `<img src="${m.logo_url}" style="width:44px;height:30px;object-fit:contain;background:var(--sisend-bg);border-radius:5px">` : ''}
      <div style="flex:1;min-width:140px">
        <div style="font-size:13px;font-weight:600">${m.ettevote_nimi}${m.vaikimisi ? ' <span style="font-size:10px;color:#4ade80">★ vaikimisi</span>' : ''}</div>
        <div style="font-size:11px;color:var(--hall)">${m.km_kohuslane ? 'Käibemaksukohuslane (24%)' : 'Ei ole käibemaksukohuslane (0%)'}</div>
      </div>
      ${!m.vaikimisi ? `<button type="button" class="nupp hall" style="padding:5px 10px;font-size:11px" onclick="avmTeeVaikimisi(${m.id})">Tee vaikimisi</button>` : ''}
      <button type="button" class="nupp hall" style="padding:5px 10px;font-size:11px" onclick="avmMuudaMuuja(${m.id})">✏️</button>
      <button type="button" class="nupp punane" style="padding:5px 10px;font-size:11px" onclick="avmKustuta(${m.id})">🗑</button>
    </div>
  `).join('');
}
function avmRenderValik() {
  const sel = document.getElementById('av-muuja');
  sel.innerHTML = avmMuujad.map(m => `<option value="${m.id}">${m.ettevote_nimi}</option>`).join('');
  if (avmMuujad.length) {
    const vaikimisi = avmMuujad.find(m => m.vaikimisi) || avmMuujad[0];
    sel.value = vaikimisi.id;
  }
  avmMuujaValitud();
}
function avmMuujaValitud() {
  const id = parseInt(document.getElementById('av-muuja').value, 10);
  const m = avmMuujad.find(x => x.id === id);
  avKmProtsent = (m && m.km_kohuslane) ? 24 : 0;
  avJoonistaRead();
}
function avmAvaKaartJaKeri() {
  avSuljeUusArveModal();
  const keha = document.getElementById('avm-body');
  if (keha.style.display === 'none') avToggleKaart('avm-body', 'avm-nool');
  document.getElementById('avm-muujad-kaart').scrollIntoView({ behavior: 'smooth' });
}
function avmAvaVorm() {
  document.getElementById('avm-id').value = '';
  ['avm-nimi', 'avm-aadress', 'avm-rgkood', 'avm-kmkr', 'avm-telefon', 'avm-epost', 'avm-swift', 'avm-pangakonto'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('avm-km-kohuslane').checked = true;
  document.getElementById('avm-logo-plokk').style.display = 'none';
  document.getElementById('avm-teade').style.display = 'none';
  document.getElementById('avm-vorm').style.display = 'block';
}
function avmSuljeVorm() {
  document.getElementById('avm-vorm').style.display = 'none';
}
function avmMuudaMuuja(id) {
  const m = avmMuujad.find(x => x.id === id);
  if (!m) return;
  document.getElementById('avm-id').value = m.id;
  document.getElementById('avm-nimi').value = m.ettevote_nimi || '';
  document.getElementById('avm-aadress').value = m.aadress || '';
  document.getElementById('avm-rgkood').value = m.rg_kood || '';
  document.getElementById('avm-kmkr').value = m.kmkr || '';
  document.getElementById('avm-telefon').value = m.telefon || '';
  document.getElementById('avm-epost').value = m.epost || '';
  document.getElementById('avm-swift').value = m.swift || '';
  document.getElementById('avm-pangakonto').value = m.pangakonto || '';
  document.getElementById('avm-km-kohuslane').checked = m.km_kohuslane !== false;
  const logoPlokk = document.getElementById('avm-logo-plokk');
  logoPlokk.style.display = 'block';
  document.getElementById('avm-logo-eelvaade').innerHTML = m.logo_url ? `<img src="${m.logo_url}" style="width:100%;height:100%;object-fit:contain">` : '—';
  document.getElementById('avm-logo-eemalda-nupp').style.display = m.logo_url ? 'inline-block' : 'none';
  document.getElementById('avm-teade').style.display = 'none';
  document.getElementById('avm-vorm').style.display = 'block';
}
async function avmSalvesta() {
  const id = document.getElementById('avm-id').value;
  const nimi = document.getElementById('avm-nimi').value.trim();
  const teade = document.getElementById('avm-teade');
  if (!nimi) return naitaTeade('avm-teade', 'viga', 'Sisesta ettevõtte nimi');
  const body = {
    ettevote_nimi: nimi,
    aadress: document.getElementById('avm-aadress').value.trim(),
    rg_kood: document.getElementById('avm-rgkood').value.trim(),
    kmkr: document.getElementById('avm-kmkr').value.trim(),
    telefon: document.getElementById('avm-telefon').value.trim(),
    epost: document.getElementById('avm-epost').value.trim(),
    swift: document.getElementById('avm-swift').value.trim(),
    pangakonto: document.getElementById('avm-pangakonto').value.trim(),
    km_kohuslane: document.getElementById('avm-km-kohuslane').checked
  };
  const r = id
    ? await api('/api/arved/muujad/' + id, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/arved/muujad', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return naitaTeade('avm-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
  avmSuljeVorm();
  await avmLaadiMuujad();
}
async function avmTeeVaikimisi(id) {
  await api('/api/arved/muujad/' + id + '/vaikimisi', { method: 'PUT' });
  await avmLaadiMuujad();
}
async function avmKustuta(id) {
  if (!confirm('Kustutada see ettevõte?')) return;
  const r = await api('/api/arved/muujad/' + id, { method: 'DELETE' });
  if (!r.ok) return alert('Viga: ' + (r.veateade || 'kustutamine ebaõnnestus'));
  await avmLaadiMuujad();
}
async function avmLogoValitud(input) {
  const id = document.getElementById('avm-id').value;
  if (!id) return alert('Salvesta enne ettevõte ära, siis saad logo lisada.');
  if (!input.files || !input.files[0]) return;
  const fd = new FormData();
  fd.append('logo', input.files[0]);
  const res = await fetch('/api/arved/muujad/' + id + '/logo', { method: 'POST', headers: { 'x-session-token': TOKEN }, body: fd });
  const r = await res.json();
  input.value = '';
  if (!r.ok) return alert('Viga: ' + (r.veateade || 'üleslaadimine ebaõnnestus'));
  document.getElementById('avm-logo-eelvaade').innerHTML = `<img src="${r.logo_url}" style="width:100%;height:100%;object-fit:contain">`;
  document.getElementById('avm-logo-eemalda-nupp').style.display = 'inline-block';
  await avmLaadiMuujad();
}
async function avmEemaldaLogo() {
  const id = document.getElementById('avm-id').value;
  if (!id) return;
  await api('/api/arved/muujad/' + id + '/logo', { method: 'DELETE' });
  document.getElementById('avm-logo-eelvaade').innerHTML = '—';
  document.getElementById('avm-logo-eemalda-nupp').style.display = 'none';
  await avmLaadiMuujad();
}

function avAvaUusArveModal() {
  document.getElementById('avUusArveModal').classList.add('avatud');
}
function avSuljeUusArveModal() {
  document.getElementById('avUusArveModal').classList.remove('avatud');
}
function avAvaLisaKuluModal() {
  document.getElementById('avLisaKuluModal').classList.add('avatud');
}
function avSuljeLisaKuluModal() {
  document.getElementById('avLisaKuluModal').classList.remove('avatud');
}
document.getElementById('avUusArveModal')?.addEventListener('click', function(e) { if (e.target === this) avSuljeUusArveModal(); });
document.getElementById('avLisaKuluModal')?.addEventListener('click', function(e) { if (e.target === this) avSuljeLisaKuluModal(); });

function avKuuMuutus() {
  laadiArvedTabel();
  laadiSisseTabel();
}

function avKmAnalyysKaesolevKuu() {
  const t = new Date();
  const algus = new Date(t.getFullYear(), t.getMonth(), 1);
  const lopp = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  document.getElementById('km-algus').value = algus.toISOString().split('T')[0];
  document.getElementById('km-lopp').value = lopp.toISOString().split('T')[0];
  avUuendaKmAnalyys();
}
function avVahemikuFiltreeri(list, kpVali, algus, lopp) {
  if (!algus || !lopp) return list;
  return list.filter(x => {
    const kp = String(x[kpVali]).split('T')[0];
    return kp >= algus && kp <= lopp;
  });
}
async function avUuendaKmAnalyys() {
  const algus = document.getElementById('km-algus').value;
  const lopp = document.getElementById('km-lopp').value;
  try {
    const [valja, sisse] = await Promise.all([
      api('/api/arved'),
      api('/api/arved/sisse')
    ]);
    const valjaList = avVahemikuFiltreeri(Array.isArray(valja) ? valja : [], 'kuupaev', algus, lopp);
    const sisseList = avVahemikuFiltreeri(Array.isArray(sisse) ? sisse : [], 'kuupaev', algus, lopp);
    const kmValjas = valjaList.reduce((s, a) => s + (parseFloat(a.kaibemaks) || 0), 0);
    const kmSisse = sisseList.reduce((s, x) => s + (parseFloat(x.kaibemaks) || 0), 0);
    const vahe = kmValjas - kmSisse;
    const vEl = document.getElementById('km-valjas');
    const sEl = document.getElementById('km-sisse');
    const dEl = document.getElementById('km-vahe');
    const dSiltEl = document.getElementById('km-vahe-silt');
    if (vEl) vEl.textContent = avFmtEur(kmValjas);
    if (sEl) sEl.textContent = avFmtEur(kmSisse);
    if (dEl) {
      dEl.textContent = avFmtEur(vahe);
      dEl.style.color = vahe >= 0 ? '#fbbf24' : '#4ade80';
    }
    if (dSiltEl) dSiltEl.textContent = vahe >= 0 ? 'Vahe — tasumisele Maksuametile' : 'Vahe — mahaarvamisele/tagasi';
    const kaive = valjaList.reduce((s, a) => s + (parseFloat(a.summa_km_ta) || 0), 0);
    const kulud = sisseList.reduce((s, x) => s + ((parseFloat(x.summa) || 0) - (parseFloat(x.kaibemaks) || 0)), 0);
    const kasum = kaive - kulud;
    const kEl = document.getElementById('dt-kaive');
    const kuEl = document.getElementById('dt-kulud');
    const kaEl = document.getElementById('dt-kasum');
    if (kEl) kEl.textContent = avFmtEur(kaive);
    if (kuEl) kuEl.textContent = avFmtEur(kulud);
    if (kaEl) { kaEl.textContent = avFmtEur(kasum); kaEl.style.color = kasum >= 0 ? '#4ade80' : '#ef4444'; }
  } catch (e) { }
}

async function avPreviewNumber() {
  const njr = await api('/api/arved/jargmine-number');
  const njrEl = document.getElementById('arve-jargmine-nr');
  if (njrEl && njr.ok) njrEl.textContent = `järgmine number: ${njr.number}`;
}

let avPoList = [];
let avKontaktList = [];

function avViideTyyp() {
  return document.getElementById('av-viide-tyyp').value === 'projekt' ? 'projekt' : 'po';
}

function avViideTyypMuutus() {
  const tyyp = avViideTyyp();
  document.getElementById('av-viide-label').textContent = tyyp === 'projekt' ? 'Projektinumber (valikuline)' : 'PO number (valikuline)';
  document.getElementById('av-po').placeholder = tyyp === 'projekt' ? 'nt PRJ-2026-014' : 'nt 4501439102';
  const { tyyp: klienditüüp, id } = avKlientValik();
  avLaadiPoValikud(klienditüüp === 'ettevote' ? id : null);
}

async function avLaadiPoValikud(ettevoteId) {
  const sel = document.getElementById('av-po-valik');
  if (!ettevoteId) { avPoList = []; sel.innerHTML = '<option value="">— Vali salvestatud —</option>'; return; }
  const r = await api(`/api/arved/valikud?ettevote_id=${ettevoteId}&tyyp=${avViideTyyp()}`);
  avPoList = Array.isArray(r) ? r : [];
  sel.innerHTML = '<option value="">— Vali salvestatud —</option>' +
    avPoList.map(x => `<option value="${x.id}">${x.vaartus}${x.silt ? ' — ' + x.silt : ''}</option>`).join('');
}
function avPoValikMuutus() {
  const id = document.getElementById('av-po-valik').value;
  const item = avPoList.find(x => String(x.id) === id);
  if (item) document.getElementById('av-po').value = item.vaartus;
}
async function avSalvestaPoValik() {
  const ettevoteId = document.getElementById('av-klient').value;
  const vaartus = document.getElementById('av-po').value.trim();
  const tyyp = avViideTyyp();
  const siltNimi = tyyp === 'projekt' ? 'projektinumber' : 'PO number';
  if (!ettevoteId) return naitaTeade('arve-teade', 'viga', `Vali enne klient (ettevõte) — ${siltNimi}d salvestuvad ettevõtte kaupa.`);
  if (!vaartus) return naitaTeade('arve-teade', 'viga', `${siltNimi} on tühi.`);
  const silt = (prompt('Kellele see ' + siltNimi + ' kuulub? (nt Indrek) — jäta tühjaks kui pole vaja') || '').trim();
  const r = await api('/api/arved/valikud', { method: 'POST', body: JSON.stringify({ ettevote_id: ettevoteId, tyyp, vaartus, silt }) });
  if (r.ok) { await avLaadiPoValikud(ettevoteId); naitaTeade('arve-teade', 'ok', `✅ ${siltNimi} salvestatud valikusse.`); }
  else naitaTeade('arve-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
}

async function avLaadiKontaktValikud(ettevoteId) {
  const sel = document.getElementById('av-kontakt-valik');
  if (!ettevoteId) { avKontaktList = []; sel.innerHTML = '<option value="">— Vali salvestatud —</option>'; return; }
  const r = await api(`/api/arved/valikud?ettevote_id=${ettevoteId}&tyyp=kontakt`);
  avKontaktList = Array.isArray(r) ? r : [];
  sel.innerHTML = '<option value="">— Vali salvestatud —</option>' +
    avKontaktList.map(x => `<option value="${x.id}">${x.vaartus}</option>`).join('');
}
function avKontaktValikMuutus() {
  const id = document.getElementById('av-kontakt-valik').value;
  const item = avKontaktList.find(x => String(x.id) === id);
  if (item) document.getElementById('av-kontaktisik').value = item.vaartus;
}
async function avSalvestaKontaktValik() {
  const ettevoteId = document.getElementById('av-klient').value;
  const vaartus = document.getElementById('av-kontaktisik').value.trim();
  if (!ettevoteId) return naitaTeade('arve-teade', 'viga', 'Vali enne klient (ettevõte) — kontaktisikud salvestuvad ettevõtte kaupa.');
  if (!vaartus) return naitaTeade('arve-teade', 'viga', 'Kontaktisiku väli on tühi.');
  const r = await api('/api/arved/valikud', { method: 'POST', body: JSON.stringify({ ettevote_id: ettevoteId, tyyp: 'kontakt', vaartus }) });
  if (r.ok) { await avLaadiKontaktValikud(ettevoteId); naitaTeade('arve-teade', 'ok', '✅ Kontaktisik salvestatud valikusse.'); }
  else naitaTeade('arve-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
}

function avKlientValik() {
  const raw = document.getElementById('av-klient').value;
  if (!raw) return { tyyp: null, id: null };
  const [pref, idStr] = raw.split('-');
  return { tyyp: pref === 'e' ? 'ettevote' : 'klient', id: idStr };
}

function avKlientMuutus() {
  const valjadDiv = document.getElementById('av-ostja-valjad');
  const link = document.getElementById('av-uus-klient-link');
  const { tyyp, id } = avKlientValik();

  if (!tyyp) {
    valjadDiv.style.display = 'none';
    if (link) link.style.display = 'block';
    avLaadiPoValikud(null);
    avLaadiKontaktValikud(null);
    return;
  }
  valjadDiv.style.display = 'block';
  if (link) link.style.display = 'none';

  if (tyyp === 'ettevote') {
    const e = kõikEttevotted.find(x => String(x.id) === String(id));
    avLaadiPoValikud(id);
    avLaadiKontaktValikud(id);
    if (!e) return;
    document.getElementById('av-ostja-nimi').value = e.arve_nimi || e.nimi || '';
    document.getElementById('av-ostja-aadress').value = e.arve_aadress || '';
    document.getElementById('av-ostja-rgkood').value = e.arve_rg_kood || '';
    document.getElementById('av-ostja-kmkr').value = e.arve_kmkr || '';
    document.getElementById('av-kontaktisik').value = e.arve_kontakt_viimane || '';
    document.getElementById('av-maksetahtaeg-paevad').value = e.arve_maksetahtaeg_paevad || 14;
  } else {
    avLaadiPoValikud(null);
    avLaadiKontaktValikud(null);
    const k = avKliendidList.find(x => String(x.id) === String(id));
    if (!k) return;
    document.getElementById('av-ostja-nimi').value = k.nimi || '';
    document.getElementById('av-ostja-aadress').value = k.aadress || '';
    document.getElementById('av-ostja-rgkood').value = k.rg_kood || '';
    document.getElementById('av-ostja-kmkr').value = k.kmkr || '';
    document.getElementById('av-kontaktisik').value = k.kontaktisik || '';
    document.getElementById('av-maksetahtaeg-paevad').value = k.maksetahtaeg_paevad || 14;
  }
}

function avAvaUusKlient() {
  document.getElementById('av-klient').value = '';
  document.getElementById('av-ostja-valjad').style.display = 'block';
  document.getElementById('av-uus-klient-link').style.display = 'none';
  document.getElementById('av-ostja-nimi').value = '';
  document.getElementById('av-ostja-aadress').value = '';
  document.getElementById('av-ostja-rgkood').value = '';
  document.getElementById('av-ostja-kmkr').value = '';
  document.getElementById('av-kontaktisik').value = '';
  document.getElementById('av-maksetahtaeg-paevad').value = 14;
  avLaadiPoValikud(null);
  avLaadiKontaktValikud(null);
  document.getElementById('av-ostja-nimi').focus();
}

function avLisaRida(rida) {
  avRead.push(rida || { kirjeldus: '', kogus: 1, uhik: '', hind: 0, summa: 0 });
  avJoonistaRead();
}

function avEemaldaRida(idx) {
  avRead.splice(idx, 1);
  if (!avRead.length) avRead.push({ kirjeldus: '', kogus: 1, uhik: '', hind: 0, summa: 0 });
  avJoonistaRead();
}

// NB: varem kutsus iga klahvivajutus avJoonistaRead(), mis joonistas kogu tabeli uuesti —
// sisestusväli hävitati ja loodi uuesti, nii et kursor hüppas välja ja sai kirjutada ainult
// tähthaaval. Nüüd uuendame mudelit ja ainult arvutatud numbreid, välju ennast puutumata.
function avUuendaRida(idx, valjs, val) {
  avRead[idx][valjs] = val;
  if (valjs === 'kogus' || valjs === 'hind') {
    avRead[idx].summa = +((parseFloat(avRead[idx].kogus) || 0) * (parseFloat(avRead[idx].hind) || 0)).toFixed(2);
    const summaLahter = document.getElementById('av-rida-summa-' + idx);
    if (summaLahter) summaLahter.textContent = avFmtEur(avRead[idx].summa);
  }
  avUuendaKokkuvotted();
}

function avUuendaKokkuvotted() {
  const summaKmTa = avRead.reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
  const kaibemaks = summaKmTa * (avKmProtsent / 100);
  document.getElementById('av-summa-kmta').textContent = avFmtEur(summaKmTa);
  document.getElementById('av-kaibemaks').textContent = avFmtEur(kaibemaks);
  document.getElementById('av-kaibemaks-silt').textContent = `Käibemaks ${avKmProtsent}%`;
  document.getElementById('av-kokku').textContent = avFmtEur(summaKmTa + kaibemaks);
}

function avJoonistaRead() {
  const body = document.getElementById('av-read-body');
  body.innerHTML = avRead.map((r, idx) => `
    <tr>
      <td><input type="text" value="${(r.kirjeldus||'').replace(/"/g,'&quot;')}" oninput="avUuendaRida(${idx},'kirjeldus',this.value)"></td>
      <td><input type="number" step="0.1" value="${r.kogus}" oninput="avUuendaRida(${idx},'kogus',this.value)"></td>
      <td><input type="text" value="${r.uhik||''}" oninput="avUuendaRida(${idx},'uhik',this.value)"></td>
      <td><input type="number" step="0.01" value="${r.hind}" oninput="avUuendaRida(${idx},'hind',this.value)"></td>
      <td id="av-rida-summa-${idx}" style="text-align:right;font-weight:600">${avFmtEur(r.summa)}</td>
      <td><button onclick="avEemaldaRida(${idx})" style="background:none;border:none;color:var(--hall);cursor:pointer">✕</button></td>
    </tr>`).join('');
  avUuendaKokkuvotted();
}

async function avAutotaida(viis) {
  const { tyyp, id } = avKlientValik();
  const ettevoteId = tyyp === 'ettevote' ? id : null;
  const algus = document.getElementById('av-algus').value;
  const lopp = document.getElementById('av-lopp').value;
  if (!ettevoteId) return naitaTeade('arve-teade', 'viga', 'Autotäitmine töötab ainult "Minu ettevõtete" klientidega (Lidl/Cramo/Muu), mitte kolmanda osapoolega.');
  if (!algus || !lopp) return naitaTeade('arve-teade', 'viga', 'Vali periood (algus ja lõpp)!');
  const esitusHind = prompt('Esitushind (€/h, käibemaksuta) — see hind läheb arvele KLIENDILE, mitte töötaja tunnitasu:', '27');
  if (esitusHind === null) return;
  const esitus_hind = parseFloat(esitusHind) || 0;
  if (!esitus_hind) return naitaTeade('arve-teade', 'viga', 'Sisesta korrektne esitushind');
  const r = await api(`/api/arved/autotaita?ettevote_id=${ettevoteId}&algus=${algus}&lopp=${lopp}&viis=${viis}&esitus_hind=${esitus_hind}`);
  if (!r.ok) return naitaTeade('arve-teade', 'viga', r.veateade || 'Autotäitmine ebaõnnestus');
  if (!r.read.length) return naitaTeade('arve-teade', 'viga', 'Sellel perioodil ei leitud töökirjeid.');
  avRead = r.read;
  avJoonistaRead();
}

async function avSalvestaArve() {
  const { tyyp, id } = avKlientValik();
  const ettevoteId = tyyp === 'ettevote' ? id : null;
  const ostjaNimi = document.getElementById('av-ostja-nimi').value.trim();
  if (!ostjaNimi) return naitaTeade('arve-teade', 'viga', 'Sisesta ostja nimi!');
  const kehtivadRead = avRead.filter(r => (r.kirjeldus || '').trim() && parseFloat(r.summa) !== 0 || parseFloat(r.kogus) > 0);
  if (!kehtivadRead.length) return naitaTeade('arve-teade', 'viga', 'Lisa vähemalt üks arve rida!');
  if (!avmMuujad.length) return naitaTeade('arve-teade', 'viga', 'Lisa enne vähemalt üks müüja-ettevõte "Müüjad" alt');
  const body = {
    muuja_id: document.getElementById('av-muuja').value,
    ettevote_id: ettevoteId || null,
    ostja_nimi: ostjaNimi,
    ostja_aadress: document.getElementById('av-ostja-aadress').value,
    ostja_rg_kood: document.getElementById('av-ostja-rgkood').value,
    ostja_kmkr: document.getElementById('av-ostja-kmkr').value,
    kontaktisik: document.getElementById('av-kontaktisik').value,
    po_number: document.getElementById('av-po').value,
    viide_tyyp: avViideTyyp(),
    kuupaev: document.getElementById('av-kuupaev').value,
    maksetahtaeg_paevad: document.getElementById('av-maksetahtaeg-paevad').value,
    algus: document.getElementById('av-algus').value || null,
    lopp: document.getElementById('av-lopp').value || null,
    read: kehtivadRead
  };
  const r = await api('/api/arved', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return naitaTeade('arve-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
  naitaTeade('arve-teade', 'ok', `✅ Arve nr ${r.number} loodud!`);
  window.open(`/api/arved/${r.id}/pdf?_token=${TOKEN}`, '_blank');
  avRead = [];
  avLisaRida();
  document.getElementById('av-po').value = '';
  document.getElementById('av-viide-tyyp').value = 'po';
  avViideTyypMuutus();
  document.getElementById('av-ostja-nimi').value = '';
  document.getElementById('av-ostja-aadress').value = '';
  document.getElementById('av-ostja-rgkood').value = '';
  document.getElementById('av-ostja-kmkr').value = '';
  document.getElementById('av-kontaktisik').value = '';
  document.getElementById('av-algus').value = '';
  document.getElementById('av-lopp').value = '';
  document.getElementById('av-ostja-valjad').style.display = 'none';
  document.getElementById('av-uus-klient-link').style.display = 'block';
  await laadiArved();
  setTimeout(avSuljeUusArveModal, 900);
}

let avArvedList = [];
let avStaatusFilter = 'koik';
let avMuujaFilter = 'koik';
let avArvedValitud = new Set();

async function laadiArvedTabel() {
  const arved = await api('/api/arved');
  avArvedList = Array.isArray(arved) ? arved : [];
  avArvedValitud.clear();
  avUuendaMuujaFiltriValikud();
  avFiltreeriStaatus(avStaatusFilter);
  avUuendaKmAnalyys();
}

function avUuendaMuujaFiltriValikud() {
  const sel = document.getElementById('av-filt-muuja');
  if (!sel) return;
  const nimed = [...new Set(avArvedList.map(a => a.muuja_nimi).filter(Boolean))].sort();
  const praegune = avMuujaFilter;
  sel.innerHTML = '<option value="koik">Kõik müüjad</option>' + nimed.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');
  if (nimed.includes(praegune)) sel.value = praegune; else { avMuujaFilter = 'koik'; sel.value = 'koik'; }
}
function avFiltreeriMuuja(v) {
  avMuujaFilter = v;
  avJoonistaArvedTabel();
}
function avFiltreeriKuupaevad() {
  avJoonistaArvedTabel();
}
// Ühtne filtreerimisloogika (staatus + müüja + vabalt valitav kuupäevavahemik ZIP-i jaoks) —
// kasutab nii tabeli joonistamine kui "vali kõik" checkbox, et need kunagi lahku ei läheks.
function avFiltreeritudArved() {
  let arved = avStaatusFilter === 'koik' ? avArvedList : avArvedList.filter(a => a.staatus === avStaatusFilter);
  if (avMuujaFilter !== 'koik') arved = arved.filter(a => a.muuja_nimi === avMuujaFilter);
  const algus = document.getElementById('av-filt-algus')?.value;
  const lopp = document.getElementById('av-filt-lopp')?.value;
  if (algus) arved = arved.filter(a => String(a.kuupaev).slice(0, 10) >= algus);
  if (lopp) arved = arved.filter(a => String(a.kuupaev).slice(0, 10) <= lopp);
  return arved;
}

function avVaataArve(id, valitud) {
  if (valitud) avArvedValitud.add(id); else avArvedValitud.delete(id);
  avUuendaArvedZipNupp();
}
function avVaataKoikArved(koik) {
  avArvedValitud.clear();
  if (koik) avFiltreeritudArved().forEach(a => avArvedValitud.add(a.id));
  avJoonistaArvedTabel();
}
async function avMuudaArveMuuja(id, muujaId) {
  if (!muujaId) return;
  const r = await api(`/api/arved/${id}/muuja`, { method: 'PUT', body: JSON.stringify({ muuja_id: muujaId }) });
  if (!r || !r.ok) { alert((r && r.veateade) || 'Salvestamine ebaõnnestus — kontrolli, kas routes/arved.js on uuendatud'); return; }
  await laadiArvedTabel();
}
function avUuendaArvedZipNupp() {
  const nupp = document.getElementById('av-zip-nupp');
  if (!nupp) return;
  nupp.style.display = avArvedValitud.size ? 'inline-block' : 'none';
  nupp.textContent = `⬇️ Laadi valitud alla (${avArvedValitud.size} ZIP-ina)`;
}
function avLaadiArvedZip() {
  if (!avArvedValitud.size) return;
  window.open(`/api/arved/zip?ids=${[...avArvedValitud].join(',')}&_token=${TOKEN}`, '_blank');
}
function avLaadiKoikArvedZip() {
  if (!avArvedList.length) return;
  if (!confirm(`Laadid alla KÕIK ${avArvedList.length} arvet (filtreid eirates) ühe ZIP-ina. Jätkata?`)) return;
  window.open(`/api/arved/zip?ids=${avArvedList.map(a => a.id).join(',')}&_token=${TOKEN}`, '_blank');
}

function avFiltreeriStaatus(s) {
  avStaatusFilter = s;
  ['koik', 'maksmata', 'makstud'].forEach(k => {
    const btn = document.getElementById('av-filt-' + k);
    if (!btn) return;
    btn.classList.toggle('kull', k === s);
    btn.classList.toggle('hall', k !== s);
  });
  avJoonistaArvedTabel();
}

function avValitudKuuAasta() {
  const kuuEl = document.getElementById('av-kuu-valik');
  const aastaEl = document.getElementById('av-aasta-valik');
  return { kuu: kuuEl && kuuEl.value ? parseInt(kuuEl.value, 10) : null, aasta: aastaEl && aastaEl.value ? parseInt(aastaEl.value, 10) : null };
}
function avKuuFiltreeri(list, kpVali) {
  const { kuu, aasta } = avValitudKuuAasta();
  if (!kuu || !aasta) return list;
  return list.filter(x => {
    const d = new Date(x[kpVali]);
    return (d.getMonth() + 1) === kuu && d.getFullYear() === aasta;
  });
}

function avJoonistaArvedTabel() {
  const div = document.getElementById('arvedTabel');
  const arved = avFiltreeritudArved();
  if (!arved.length) { div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Arveid ei leitud</div>'; avUuendaArvedZipNupp(); return; }
  div.innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th><input type="checkbox" onchange="avVaataKoikArved(this.checked)"></th><th>Nr</th><th>Kuupäev</th><th>Müüja</th><th>Ostja</th><th style="text-align:right">Summa</th><th>Staatus</th><th>Tegevused</th></tr></thead><tbody>` +
    arved.map(a => {
      const praeguneMuuja = avmMuujad.find(m => m.ettevote_nimi === a.muuja_nimi);
      const vc = praeguneMuuja ? muujaVarv(praeguneMuuja.id) : '#565a61';
      return `
      <tr style="border-left:3px solid ${vc}">
        <td><input type="checkbox" ${avArvedValitud.has(a.id) ? 'checked' : ''} onchange="avVaataArve(${a.id}, this.checked)"></td>
        <td style="font-weight:600">${a.number}</td>
        <td>${formatKp(a.kuupaev)}</td>
        <td>${a.muuja_nimi
          ? `<span style="color:${vc};font-size:12px;font-weight:600">${a.muuja_nimi}</span>`
          : `<select onchange="avMuudaArveMuuja(${a.id}, this.value)" style="font-size:11px;padding:3px 6px;width:auto;border-color:#f87171"><option value="">⚠️ Vali müüja</option>${avmMuujad.map(m => `<option value="${m.id}">${m.ettevote_nimi}</option>`).join('')}</select>`}
        </td>
        <td>${a.ostja_nimi}${a.ettevote_nimi ? ` <span style="color:var(--hall);font-size:11px">(${a.ettevote_nimi})</span>` : ''}</td>
        <td style="text-align:right;font-weight:600">${avFmtEur(a.kokku)}</td>
        <td><span class="staatus-pill ${a.staatus==='makstud'?'roheline':'oranz'}" style="cursor:pointer" onclick="avMuudaStaatus(${a.id},'${a.staatus==='makstud'?'maksmata':'makstud'}')">${a.staatus==='makstud'?'Makstud':'Maksmata'}</span></td>
        <td style="display:flex;gap:6px">
          ${a.fail_url
            ? `<a href="${avFailUrl(a.fail_url)}" target="_blank" class="av-tegevus-ikoon" title="Ava fail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>`
            : `<a href="/api/arved/${a.id}/pdf?_token=${TOKEN}" target="_blank" class="av-tegevus-ikoon" title="Ava PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>`}
          <a href="/api/arved/${a.id}/pdf?_token=${TOKEN}" target="_blank" class="av-tegevus-ikoon" title="Laadi PDF alla"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 19h16"/></svg></a>
          <button onclick="avKustutaArve(${a.id})" class="av-tegevus-ikoon kustuta" title="Kustuta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </td>
      </tr>`;
    }).join('') + '</tbody></table></div>';
  avUuendaArvedZipNupp();
}

async function avMuudaStaatus(id, uusStaatus) {
  await api(`/api/arved/${id}/staatus`, { method: 'PUT', body: JSON.stringify({ staatus: uusStaatus }) });
  await laadiArvedTabel();
}

async function avKustutaArve(id) {
  if (!confirm('Kustutad selle arve jäädavalt?')) return;
  await api(`/api/arved/${id}`, { method: 'DELETE' });
  await laadiArvedTabel();
}

let avLaadiFail = null;

function avToggleLaadiVorm() {
  const vorm = document.getElementById('av-laadi-vorm');
  const nahtaval = vorm.style.display !== 'none';
  vorm.style.display = nahtaval ? 'none' : 'block';
  if (!nahtaval) {
    const kpEl = document.getElementById('al-kuupaev');
    if (kpEl && !kpEl.value) kpEl.value = new Date().toISOString().split('T')[0];
  }
}

let avSumupFail = null;

function avToggleSumupVorm() {
  const vorm = document.getElementById('av-sumup-vorm');
  vorm.style.display = vorm.style.display !== 'none' ? 'none' : 'block';
}

function avSumupDropzoneSeadista() {
  const zone = document.getElementById('av-sumup-dropzone');
  const input = document.getElementById('av-sumup-fail');
  if (!zone || zone.dataset.seadistatud) return;
  zone.dataset.seadistatud = '1';
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) avSumupValiFail(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#4ade80'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files[0]) avSumupValiFail(e.dataTransfer.files[0]);
  });
}

function avSumupValiFail(file) {
  avSumupFail = file;
  document.getElementById('av-sumup-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — kliki, et vahetada`;
  avLoeSumupFail(file);
}

async function avLoeSumupFail(file) {
  naitaTeade('su-loe-teade', 'ok', '🤖 Loen SumUp aruannet...');
  const fd = new FormData();
  fd.append('fail', file);
  const r = await api('/api/arved/sumup/loe', { method: 'POST', body: fd });
  if (!r.ok) { naitaTeade('su-loe-teade', 'viga', r.veateade || 'AI lugemine ebaõnnestus — täida käsitsi.'); document.getElementById('av-sumup-tulemus').style.display = 'block'; return; }
  if (r.periood_algus) document.getElementById('su-algus').value = r.periood_algus;
  if (r.periood_lopp) document.getElementById('su-lopp').value = r.periood_lopp;
  if (r.kaive_bruto) document.getElementById('su-kaive').value = r.kaive_bruto;
  if (r.tasud) document.getElementById('su-tasu').value = r.tasud;
  document.getElementById('av-sumup-tulemus').style.display = 'block';
  avSumupArvutaKm();
  naitaTeade('su-loe-teade', 'ok', '🤖 Väljad täidetud AI abil — kontrolli üle enne salvestamist!');
}

function avSumupArvutaKm() {
  const kaive = parseFloat(document.getElementById('su-kaive').value) || 0;
  const protsent = parseFloat(document.getElementById('su-km-protsent').value) || 24;
  const km = kaive - kaive / (1 + protsent / 100);
  document.getElementById('su-km-arvutatud').value = km.toFixed(2) + ' €';
}

async function avSalvestaSumup() {
  const algus = document.getElementById('su-algus').value;
  const lopp = document.getElementById('su-lopp').value;
  if (!algus || !lopp) return naitaTeade('su-teade', 'viga', 'Täida perioodi algus ja lõpp!');
  const fd = new FormData();
  fd.append('periood_algus', algus);
  fd.append('periood_lopp', lopp);
  fd.append('kaive_bruto', document.getElementById('su-kaive').value || 0);
  fd.append('kaibemaks_protsent', document.getElementById('su-km-protsent').value || 24);
  fd.append('tasud', document.getElementById('su-tasu').value || 0);
  if (avSumupFail) fd.append('fail', avSumupFail);
  const r = await api('/api/arved/sumup/salvesta', { method: 'POST', body: fd });
  if (!r.ok) return naitaTeade('su-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
  naitaTeade('su-teade', 'ok', '✅ Käive ja/või kulu lisatud!');
  avSumupFail = null;
  document.getElementById('av-sumup-fail').value = '';
  document.getElementById('av-sumup-dropzone-tekst').textContent = '📎 Lohista siia SumUp Payout Report PDF, või kliki valimiseks';
  ['su-algus','su-lopp','su-kaive','su-tasu','su-km-arvutatud'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('su-km-protsent').value = 24;
  document.getElementById('av-sumup-tulemus').style.display = 'none';
  avToggleSumupVorm();
  const [aasta, kuu] = lopp.split('-');
  const kuuSel = document.getElementById('av-kuu-valik');
  const aastaSel = document.getElementById('av-aasta-valik');
  if (kuuSel) kuuSel.value = String(parseInt(kuu, 10));
  if (aastaSel) {
    if (![...aastaSel.options].some(o => o.value === aasta)) {
      const o = document.createElement('option');
      o.value = aasta; o.textContent = aasta;
      aastaSel.appendChild(o);
    }
    aastaSel.value = aasta;
  }
  avStaatusFilter = 'koik';
  ['koik', 'maksmata', 'makstud'].forEach(k => {
    const btn = document.getElementById('av-filt-' + k);
    if (btn) { btn.classList.toggle('kull', k === 'koik'); btn.classList.toggle('hall', k !== 'koik'); }
  });
  await laadiArvedTabel();
}

function avLaadiDropzoneSeadista() {
  const zone = document.getElementById('av-laadi-dropzone');
  const input = document.getElementById('av-laadi-fail');
  if (!zone || zone.dataset.seadistatud) return;
  zone.dataset.seadistatud = '1';
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) avLaadiValiFail(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#4ade80'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files[0]) avLaadiValiFail(e.dataTransfer.files[0]);
  });
}
function avLaadiValiFail(file) {
  avLaadiFail = file;
  document.getElementById('av-laadi-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — kliki, et vahetada`;
  avLoeLaadiFail(file);
}

async function avLoeLaadiFail(file) {
  naitaTeade('al-teade', 'ok', '🤖 Loen arvet...');
  const fd = new FormData();
  fd.append('fail', file);
  const r = await api('/api/arved/laadi/loe', { method: 'POST', body: fd });
  if (!r.ok) { naitaTeade('al-teade', 'viga', r.veateade || 'AI lugemine ebaõnnestus — täida käsitsi.'); return; }
  if (r.number) document.getElementById('al-number').value = r.number;
  if (r.ostja_nimi) document.getElementById('al-ostja').value = r.ostja_nimi;
  if (r.kuupaev) document.getElementById('al-kuupaev').value = r.kuupaev;
  if (r.tahtaeg) document.getElementById('al-tahtaeg').value = r.tahtaeg;
  if (r.summa_km_ta) document.getElementById('al-summa-km-ta').value = r.summa_km_ta;
  if (r.kaibemaks) document.getElementById('al-kaibemaks').value = r.kaibemaks;
  if (r.kokku) document.getElementById('al-kokku').value = r.kokku;
  if (r.ettevote_id) document.getElementById('al-ettevote').value = r.ettevote_id;
  naitaTeade('al-teade', 'ok', '🤖 Väljad täidetud AI abil — kontrolli üle (eriti arve number!) ja vajuta Salvesta!');
}

async function avSalvestaLaadi() {
  const number = document.getElementById('al-number').value.trim();
  const kuupaev = document.getElementById('al-kuupaev').value;
  const ostja = document.getElementById('al-ostja').value.trim();
  if (!number || !kuupaev || !ostja) return naitaTeade('al-teade', 'viga', 'Täida arve number, kuupäev ja ostja nimi!');
  const fd = new FormData();
  fd.append('number', number);
  fd.append('kuupaev', kuupaev);
  fd.append('tahtaeg', document.getElementById('al-tahtaeg').value || '');
  fd.append('ostja_nimi', ostja);
  fd.append('ettevote_id', document.getElementById('al-ettevote').value);
  fd.append('summa_km_ta', document.getElementById('al-summa-km-ta').value || 0);
  fd.append('kaibemaks', document.getElementById('al-kaibemaks').value || 0);
  fd.append('kokku', document.getElementById('al-kokku').value || 0);
  fd.append('staatus', document.getElementById('al-staatus').value);
  if (avLaadiFail) fd.append('fail', avLaadiFail);
  const r = await api('/api/arved/laadi', { method: 'POST', body: fd });
  if (!r.ok) return naitaTeade('al-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
  naitaTeade('al-teade', 'ok', '✅ Arve lisatud ajalukku!');
  avLaadiFail = null;
  document.getElementById('av-laadi-fail').value = '';
  document.getElementById('av-laadi-dropzone-tekst').textContent = '📎 Lohista siia vana arve (pilt või PDF), või kliki valimiseks';
  ['al-number','al-tahtaeg','al-ostja','al-summa-km-ta','al-kaibemaks','al-kokku'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('al-ettevote').value = '';
  document.getElementById('al-staatus').value = 'maksmata';
  avToggleLaadiVorm();
  const [aasta, kuu] = kuupaev.split('-');
  const kuuSel = document.getElementById('av-kuu-valik');
  const aastaSel = document.getElementById('av-aasta-valik');
  if (kuuSel) kuuSel.value = String(parseInt(kuu, 10));
  if (aastaSel) {
    if (![...aastaSel.options].some(o => o.value === aasta)) {
      const o = document.createElement('option');
      o.value = aasta; o.textContent = aasta;
      aastaSel.appendChild(o);
    }
    aastaSel.value = aasta;
  }
  avStaatusFilter = 'koik';
  ['koik', 'maksmata', 'makstud'].forEach(k => {
    const btn = document.getElementById('av-filt-' + k);
    if (btn) { btn.classList.toggle('kull', k === 'koik'); btn.classList.toggle('hall', k !== 'koik'); }
  });
  await laadiArvedTabel();
}

function avKiirDropzoneSeadista() {
  const zone = document.getElementById('av-kiir-dropzone');
  const input = document.getElementById('av-kiir-fail');
  if (!zone || zone.dataset.seadistatud) return;
  zone.dataset.seadistatud = '1';
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) avKiirValiFail(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#4ade80'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files[0]) avKiirValiFail(e.dataTransfer.files[0]);
  });
}

function avAvatudNaita(kehaId, noolId) {
  const keha = document.getElementById(kehaId);
  if (keha && keha.style.display === 'none') avToggleKaart(kehaId, noolId);
}

async function avKiirValiFail(file) {
  document.getElementById('av-kiir-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — tuvastan...`;
  naitaTeade('av-kiir-teade', 'ok', '🤖 Loen faili ja tuvastan, kas see on sisse- või väljaminev...');
  const fd = new FormData();
  fd.append('fail', file);
  const r = await api('/api/arved/loe-suund', { method: 'POST', body: fd });
  document.getElementById('av-kiir-dropzone-tekst').textContent = '📎 Lohista siia arve või tšekk (pilt või PDF), või kliki valimiseks — ei pea ise valima, kas Sisse või Välja';
  document.getElementById('av-kiir-fail').value = '';
  if (!r.ok) { naitaTeade('av-kiir-teade', 'viga', r.veateade || 'AI lugemine ebaõnnestus — lisa käsitsi õigesse alamvaatesse.'); return; }

  if (r.suund === 'valja') {
    naitaTeade('av-kiir-teade', 'ok', '📤 Tuvastasin: VÄLJAMINEV arve — täidan vormi allpool, kontrolli üle!');
    avAvatudNaita('av-ajalugu-body', 'av-ajalugu-nool');
    if (document.getElementById('av-laadi-vorm').style.display === 'none') avToggleLaadiVorm();
    if (r.number) document.getElementById('al-number').value = r.number;
    if (r.vastaspool) document.getElementById('al-ostja').value = r.vastaspool;
    if (r.kuupaev) document.getElementById('al-kuupaev').value = r.kuupaev;
    if (r.tahtaeg) document.getElementById('al-tahtaeg').value = r.tahtaeg;
    if (r.summa_km_ta) document.getElementById('al-summa-km-ta').value = r.summa_km_ta;
    if (r.kaibemaks) document.getElementById('al-kaibemaks').value = r.kaibemaks;
    if (r.kokku) document.getElementById('al-kokku').value = r.kokku;
    if (r.ettevote_id) document.getElementById('al-ettevote').value = r.ettevote_id;
    avLaadiFail = file;
    document.getElementById('av-laadi-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — kliki, et vahetada`;
    document.getElementById('av-laadi-vorm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    naitaTeade('av-kiir-teade', 'ok', '📥 Tuvastasin: SISSETULEV tšekk/arve — täidan vormi allpool, kontrolli üle!');
    avAvaLisaKuluModal();
    if (r.kuupaev) document.getElementById('as-kuupaev').value = r.kuupaev;
    if (r.tahtaeg) document.getElementById('as-tahtaeg').value = r.tahtaeg;
    if (r.kokku) document.getElementById('as-summa').value = r.kokku;
    if (r.kaibemaks) document.getElementById('as-kaibemaks').value = r.kaibemaks;
    if (r.vastaspool) document.getElementById('as-kirjeldus').value = r.vastaspool;
    if (r.ettevote_id) document.getElementById('as-ettevote').value = r.ettevote_id;
    avSisseFail = file;
    document.getElementById('av-sisse-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — kliki, et vahetada`;
  }
}

let avSisseFail = null;
let avSisseList = [];

function avSisseDropzoneSeadista() {
  const zone = document.getElementById('av-sisse-dropzone');
  const input = document.getElementById('av-sisse-fail');
  if (!zone || zone.dataset.seadistatud) return;
  zone.dataset.seadistatud = '1';
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) avSisseValiFail(input.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#4ade80'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    if (e.dataTransfer.files[0]) avSisseValiFail(e.dataTransfer.files[0]);
  });
}
function avSisseValiFail(file) {
  avSisseFail = file;
  document.getElementById('av-sisse-dropzone-tekst').textContent = `📎 ${file.name} (${(file.size/1024).toFixed(0)} KB) — kliki, et vahetada`;
  avLoeSisseFail(file);
}

async function avLoeSisseFail(file) {
  naitaTeade('as-teade', 'ok', '🤖 Loen arvet...');
  const fd = new FormData();
  fd.append('fail', file);
  const r = await api('/api/arved/sisse/loe', { method: 'POST', body: fd });
  if (!r.ok) { naitaTeade('as-teade', 'viga', r.veateade || 'AI lugemine ebaõnnestus — täida käsitsi.'); return; }
  if (r.kuupaev) document.getElementById('as-kuupaev').value = r.kuupaev;
  if (r.tahtaeg) document.getElementById('as-tahtaeg').value = r.tahtaeg;
  if (r.summa) document.getElementById('as-summa').value = r.summa;
  if (r.kaibemaks) document.getElementById('as-kaibemaks').value = r.kaibemaks;
  if (r.ettevote) document.getElementById('as-kirjeldus').value = r.ettevote;
  if (r.ettevote_id) document.getElementById('as-ettevote').value = r.ettevote_id;
  naitaTeade('as-teade', 'ok', '🤖 Väljad täidetud AI abil — kontrolli üle ja vajuta Salvesta!');
}

let avSisseMuudaId = null;
let avSisseValitud = new Set();

let avSisseMuujaFilter = 'koik';
function muujaVarv(id) {
  if (!id) return '#565a61';
  const idx = avmMuujad.findIndex(m => String(m.id) === String(id));
  return TOOTAJA_VARVID[(idx >= 0 ? idx : 0) % TOOTAJA_VARVID.length];
}
function avUuendaSisseMuujaFiltriValikud() {
  const sel = document.getElementById('as-filt-muuja');
  if (!sel) return;
  const praegune = avSisseMuujaFilter;
  sel.innerHTML = '<option value="koik">Kõik minu ettevõtted</option>' + avmMuujad.map(m => `<option value="${m.id}">${m.ettevote_nimi}</option>`).join('');
  sel.value = praegune;
}
function avFiltreeriSisseMuuja(v) {
  avSisseMuujaFilter = v;
  avJoonistaSisseTabel();
}
async function avMuudaSisseMuuja(id, muujaId) {
  await api(`/api/arved/sisse/${id}/muuja`, { method: 'PUT', body: JSON.stringify({ muuja_id: muujaId || null }) });
  const rida = avSisseList.find(s => s.id === id);
  if (rida) rida.muuja_id = muujaId ? parseInt(muujaId, 10) : null;
  avJoonistaSisseTabel();
}

async function laadiSisseTabel() {
  const { kuu, aasta } = avValitudKuuAasta();
  const params = [];
  if (kuu) params.push('kuu=' + kuu);
  if (aasta) params.push('aasta=' + aasta);
  const sisse = await api('/api/arved/sisse' + (params.length ? '?' + params.join('&') : ''));
  avSisseList = Array.isArray(sisse) ? sisse : [];
  const muujaKaardistus = await api('/api/arved/sisse-muujad');
  if (muujaKaardistus && muujaKaardistus.ok && Array.isArray(muujaKaardistus.kaardistus)) {
    const map = {};
    muujaKaardistus.kaardistus.forEach(m => { map[m.id] = m.muuja_id; });
    avSisseList.forEach(s => { s.muuja_id = map[s.id] || null; });
  }
  avUuendaSisseMuujaFiltriValikud();
  avSisseValitud.clear();
  avJoonistaSisseTabel();
  avUuendaKmAnalyys();
}

function avJoonistaSisseTabel() {
  const div = document.getElementById('sisseTabel');
  const filtreeritudList = avSisseMuujaFilter === 'koik' ? avSisseList : avSisseList.filter(s => String(s.muuja_id) === String(avSisseMuujaFilter));
  if (!filtreeritudList.length) { div.innerHTML = '<div style="padding:24px;text-align:center;color:var(--hall)">Selle valiku kohta tšekke/arveid pole</div>'; document.getElementById('as-zip-nupp').style.display = 'none'; return; }
  const kokkuSumma = filtreeritudList.reduce((s, x) => s + (parseFloat(x.summa) || 0), 0);
  const kmSumma = filtreeritudList.reduce((s, x) => s + (parseFloat(x.kaibemaks) || 0), 0);
  const kmTaSumma = kokkuSumma - kmSumma;
  const muujaValikudBase = [{ id: '', ettevote_nimi: '— vali —' }].concat(avmMuujad);
  div.innerHTML = `<div style="overflow-x:auto"><table><thead><tr>
      <th><input type="checkbox" id="as-vali-koik" onchange="avVaataKoikSisse(this.checked)"></th>
      <th>Kuupäev</th><th>Tähtaeg</th><th>Minu ettevõte</th><th>Klient/projekt</th><th>Kirjeldus</th>
      <th style="text-align:right">Summa km-ta</th><th style="text-align:right">Käibemaks</th><th style="text-align:right">Kokku</th>
      <th>Staatus</th><th>Tegevused</th>
    </tr></thead><tbody>` +
    filtreeritudList.map(s => {
      const kmta = (parseFloat(s.summa) || 0) - (parseFloat(s.kaibemaks) || 0);
      const vc = muujaVarv(s.muuja_id);
      return `
      <tr style="border-left:3px solid ${vc}">
        <td><input type="checkbox" ${avSisseValitud.has(s.id) ? 'checked' : ''} onchange="avVaataSisse(${s.id}, this.checked)"></td>
        <td>${formatKp(s.kuupaev)}</td>
        <td>${s.tahtaeg ? formatKp(s.tahtaeg) : '<span style="color:var(--hall)">—</span>'}</td>
        <td><select onchange="avMuudaSisseMuuja(${s.id}, this.value)" style="font-size:12px;padding:4px 6px;width:auto;border-left:3px solid ${vc}">${muujaValikudBase.map(m => `<option value="${m.id}" ${String(m.id) === String(s.muuja_id||'') ? 'selected' : ''}>${m.ettevote_nimi}</option>`).join('')}</select></td>
        <td>${s.ettevote_nimi || '<span style="color:var(--hall)">—</span>'}</td>
        <td>${s.kirjeldus || ''}</td>
        <td style="text-align:right">${avFmtEur(kmta)}</td>
        <td style="text-align:right">${avFmtEur(s.kaibemaks)}</td>
        <td style="text-align:right;font-weight:600">${avFmtEur(s.summa)}</td>
        <td><span class="staatus-pill ${s.staatus==='makstud'?'roheline':'oranz'}" style="cursor:pointer" onclick="avMuudaSisseStaatus(${s.id},'${s.staatus==='makstud'?'ootel':'makstud'}')">${s.staatus==='makstud'?'Makstud':'Ootel'}</span></td>
        <td style="display:flex;gap:6px">
          ${s.fail_url ? `<a href="${avFailUrl(s.fail_url)}" target="_blank" class="av-tegevus-ikoon" title="Ava fail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>` : ''}
          <button onclick="avMuudaSisse(${s.id})" class="av-tegevus-ikoon" title="Muuda"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button onclick="avKustutaSisse(${s.id})" class="av-tegevus-ikoon kustuta" title="Kustuta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        </td>
      </tr>`;
    }).join('') +
    `</tbody></table></div><div style="padding:12px 18px;display:flex;justify-content:flex-end;gap:24px;font-size:13px;color:var(--hall);border-top:0.5px solid var(--piir2)">
      <span>Km-ta: <b style="color:var(--tekst2)">${avFmtEur(kmTaSumma)}</b></span>
      <span>Käibemaks: <b style="color:var(--tekst2)">${avFmtEur(kmSumma)}</b></span>
      <span>Kokku: <b style="color:var(--tekst2)">${avFmtEur(kokkuSumma)}</b></span>
    </div>`;
  avUuendaZipNupp();
}

function avVaataSisse(id, valitud) {
  if (valitud) avSisseValitud.add(id); else avSisseValitud.delete(id);
  avUuendaZipNupp();
}
function avVaataKoikSisse(koik) {
  avSisseValitud.clear();
  if (koik) avSisseList.forEach(s => avSisseValitud.add(s.id));
  avJoonistaSisseTabel();
}
function avUuendaZipNupp() {
  const nupp = document.getElementById('as-zip-nupp');
  const kustNupp = document.getElementById('as-kustuta-nupp');
  const hulgiSel = document.getElementById('as-hulgi-muuja');
  const hulgiNupp = document.getElementById('as-hulgi-nupp');
  const onValitud = avSisseValitud.size > 0;
  if (nupp) {
    nupp.style.display = onValitud ? 'inline-block' : 'none';
    nupp.textContent = `⬇️ Laadi valitud alla (${avSisseValitud.size} ZIP-ina)`;
  }
  if (kustNupp) {
    kustNupp.style.display = onValitud ? 'inline-block' : 'none';
    kustNupp.textContent = `🗑 Kustuta valitud (${avSisseValitud.size})`;
  }
  if (hulgiSel) {
    hulgiSel.style.display = onValitud ? 'inline-block' : 'none';
    if (onValitud && !hulgiSel.options.length) {
      hulgiSel.innerHTML = '<option value="">— määra minu ettevõte —</option>' +
        avmMuujad.map(m => `<option value="${m.id}">${m.ettevote_nimi}</option>`).join('');
    }
  }
  if (hulgiNupp) hulgiNupp.style.display = onValitud ? 'inline-block' : 'none';
}

// Hulgimääramine — ilma selleta tuleks ajaloolised kulud ükshaaval läbi klikkida,
// enne kui neid saab müüja järgi filtreerida ja raamatupidajale ZIP-ina saata.
async function avMaaraValitudMuuja() {
  const muujaId = document.getElementById('as-hulgi-muuja').value;
  if (!muujaId) { alert('Vali enne ettevõte, kelle alla need kulud lähevad'); return; }
  if (!avSisseValitud.size) return;
  const nimi = (avmMuujad.find(m => String(m.id) === String(muujaId)) || {}).ettevote_nimi || '';
  if (!confirm(`Määrad ${avSisseValitud.size} kirjet ettevõtte "${nimi}" alla?`)) return;
  const r = await api('/api/arved/sisse/muuja-hulgi', {
    method: 'PUT',
    body: JSON.stringify({ ids: [...avSisseValitud], muuja_id: muujaId })
  });
  if (!r || !r.ok) { alert((r && r.veateade) || 'Salvestamine ebaõnnestus'); return; }
  await laadiSisseTabel();
}

function avLaadiValitudZip() {
  if (!avSisseValitud.size) return;
  window.open(`/api/arved/sisse/zip?ids=${[...avSisseValitud].join(',')}&_token=${TOKEN}`, '_blank');
}

async function avKustutaValitudSisse() {
  if (!avSisseValitud.size) return;
  if (!confirm(`Kustutad ${avSisseValitud.size} valitud kirjet jäädavalt?`)) return;
  await api(`/api/arved/sisse?ids=${[...avSisseValitud].join(',')}`, { method: 'DELETE' });
  await laadiSisseTabel();
}
function avMuudaSisse(id) {
  const s = avSisseList.find(x => x.id === id);
  if (!s) return;
  avAvaLisaKuluModal();
  avSisseMuudaId = id;
  document.getElementById('as-vormi-pealkiri').textContent = '✏️ Muuda kirjet';
  document.getElementById('as-tuhista-nupp').style.display = 'inline-block';
  document.getElementById('as-salvesta-nupp').textContent = '💾 Salvesta muudatused';
  document.getElementById('as-kuupaev').value = String(s.kuupaev).split('T')[0];
  document.getElementById('as-tahtaeg').value = s.tahtaeg ? String(s.tahtaeg).split('T')[0] : '';
  document.getElementById('as-ettevote').value = s.ettevote_id || '';
  document.getElementById('as-kirjeldus').value = s.kirjeldus || '';
  document.getElementById('as-summa').value = s.summa;
  document.getElementById('as-kaibemaks').value = s.kaibemaks;
}

function avTuhistaSisseMuutmine() {
  avSisseMuudaId = null;
  avSisseFail = null;
  document.getElementById('as-vormi-pealkiri').textContent = '📥 Lisa tšekk/arve';
  document.getElementById('as-tuhista-nupp').style.display = 'none';
  document.getElementById('as-salvesta-nupp').textContent = '💾 Salvesta';
  document.getElementById('av-sisse-dropzone-tekst').textContent = '📎 Lohista siia pilt või PDF, või kliki valimiseks';
  document.getElementById('av-sisse-fail').value = '';
  document.getElementById('as-kuupaev').value = new Date().toISOString().split('T')[0];
  document.getElementById('as-tahtaeg').value = '';
  document.getElementById('as-kirjeldus').value = '';
  document.getElementById('as-summa').value = '';
  document.getElementById('as-kaibemaks').value = '';
  document.getElementById('as-ettevote').value = '';
}

async function avSalvestaSisse() {
  const kuupaev = document.getElementById('as-kuupaev').value;
  if (!kuupaev) return naitaTeade('as-teade', 'viga', 'Vali kuupäev!');
  const kirjeldusVaartus = document.getElementById('as-kirjeldus').value.trim();
  const summaVaartus = parseFloat(document.getElementById('as-summa').value) || 0;
  if (!avSisseFail && !summaVaartus && !kirjeldusVaartus) {
    return naitaTeade('as-teade', 'viga', 'Lisa vähemalt fail, summa või kirjeldus enne salvestamist!');
  }
  if (!document.getElementById('as-ettevote').value) {
    return naitaTeade('as-teade', 'viga', 'Vali ettevõte (lahter), kuhu see kulu läheb — kui pole selget, vali "Muu"!');
  }
  const fd = new FormData();
  fd.append('kuupaev', kuupaev);
  fd.append('tahtaeg', document.getElementById('as-tahtaeg').value || '');
  fd.append('ettevote_id', document.getElementById('as-ettevote').value);
  fd.append('kirjeldus', document.getElementById('as-kirjeldus').value);
  fd.append('summa', document.getElementById('as-summa').value || 0);
  fd.append('kaibemaks', document.getElementById('as-kaibemaks').value || 0);
  if (avSisseFail) fd.append('fail', avSisseFail);
  const r = avSisseMuudaId
    ? await api(`/api/arved/sisse/${avSisseMuudaId}`, { method: 'PUT', body: fd })
    : await api('/api/arved/sisse', { method: 'POST', body: fd });
  if (!r.ok) return naitaTeade('as-teade', 'viga', r.veateade || 'Salvestamine ebaõnnestus');
  naitaTeade('as-teade', 'ok', '✅ Salvestatud!');
  avTuhistaSisseMuutmine();
  await laadiSisseTabel();
  setTimeout(avSuljeLisaKuluModal, 900);
}

async function avMuudaSisseStaatus(id, uusStaatus) {
  await api(`/api/arved/sisse/${id}/staatus`, { method: 'PUT', body: JSON.stringify({ staatus: uusStaatus }) });
  await laadiSisseTabel();
}

async function avKustutaSisse(id) {
  if (!confirm('Kustutad selle kirje jäädavalt?')) return;
  await api(`/api/arved/sisse/${id}`, { method: 'DELETE' });
  await laadiSisseTabel();
}

function avToggleKaart(kehaId, noolId) {
  const keha = document.getElementById(kehaId);
  const nool = document.getElementById(noolId);
  if (!keha) return;
  const nahtav = keha.style.display !== 'none';
  keha.style.display = nahtav ? 'none' : 'block';
  if (nool) nool.textContent = nahtav ? '▼' : '▲';
}

function avToggleLigipaasPaneel() {
  const paneel = document.getElementById('av-ligipaas-paneel');
  const nool = document.getElementById('av-lig-nool');
  const nahtav = paneel.style.display !== 'none';
  paneel.style.display = nahtav ? 'none' : 'block';
  nool.textContent = nahtav ? '▼' : '▲';
  if (!nahtav) laadiArvedLigipaas();
}
async function laadiArvedLigipaas() {
  const r = await api('/api/arved/admin/lubatud');
  const div = document.getElementById('avLigipaasSisu');
  if (!Array.isArray(r) || !r.length) { div.innerHTML = '<span style="color:var(--hall);font-size:12px">Töötajaid ei leitud.</span>'; return; }
  div.innerHTML = r.map(w => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--piir2)">
      <span style="font-size:13px;color:${w.lubatud ? 'var(--tekst)' : 'var(--hall)'}">${w.lubatud ? '👤' : '·'} ${w.nimi}</span>
      <label class="toggle-switch">
        <input type="checkbox" ${w.lubatud ? 'checked' : ''} onchange="avToggleLigipaas(${w.id}, this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>`).join('');
}
async function avToggleLigipaas(workerId, lubatud) {
  await api(`/api/arved/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
}

function avToggleOaLigipaasPaneel() {
  const paneel = document.getElementById('av-oaligipaas-paneel');
  const nool = document.getElementById('av-oalig-nool');
  const nahtav = paneel.style.display !== 'none';
  paneel.style.display = nahtav ? 'none' : 'block';
  nool.textContent = nahtav ? '▼' : '▲';
  if (!nahtav) laadiOaArvedLigipaas();
}
async function laadiOaArvedLigipaas() {
  const r = await api('/api/omaarved/admin/lubatud');
  const div = document.getElementById('avOaLigipaasSisu');
  if (!Array.isArray(r) || !r.length) { div.innerHTML = '<span style="color:var(--hall);font-size:12px">Töötajaid ei leitud.</span>'; return; }
  div.innerHTML = r.map(w => `
    <div style="padding:9px 0;border-bottom:0.5px solid var(--piir2)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span style="font-size:13px;color:${w.lubatud ? 'var(--tekst)' : 'var(--hall)'};flex:1">${w.lubatud ? '🧾' : '·'} ${w.nimi}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${w.lubatud ? 'checked' : ''} onchange="avToggleOaLigipaas(${w.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${(w.muujad && w.muujad.length) ? `
        <div style="margin-top:6px;padding-left:20px;display:flex;flex-direction:column;gap:5px">
          ${w.muujad.map(m => `
            <div style="display:flex;align-items:center;gap:8px">
              ${m.logo_url ? `<img src="${m.logo_url}" style="width:24px;height:24px;object-fit:contain;background:#fff;border-radius:5px;padding:2px" title="Praegune logo">` : ''}
              <span style="font-size:12px;color:var(--hall);flex:1">${m.ettevote_nimi}${m.vaikimisi ? ' ★' : ''}</span>
              <button type="button" class="nupp hall" style="font-size:10px;padding:3px 8px" onclick="document.getElementById('oa-logo-${m.id}').click()">🖼️ Logo</button>
              <input type="file" id="oa-logo-${m.id}" accept="image/*" style="display:none" onchange="avLaadiOaLogo(${m.id}, this)">
            </div>`).join('')}
        </div>
      ` : `<div style="margin-top:4px;padding-left:20px;font-size:11px;color:var(--hall)">Töötaja pole veel ühtki ettevõtet lisanud</div>`}
    </div>`).join('');
}
async function avToggleOaLigipaas(workerId, lubatud) {
  await api(`/api/omaarved/admin/lubatud/${workerId}`, { method: 'POST', body: JSON.stringify({ lubatud }) });
}
async function avLaadiOaLogo(muujaId, input) {
  const fail = input.files && input.files[0];
  if (!fail) return;
  const fd = new FormData();
  fd.append('logo', fail);
  const r = await fetch(`/api/omaarved/admin/logo/${muujaId}`, { method: 'POST', headers: { 'x-session-token': TOKEN }, body: fd }).then(r => r.json());
  if (!r.ok) { alert('Logo üleslaadimine ebaõnnestus: ' + (r.veateade || '')); return; }
  input.value = '';
  laadiOaArvedLigipaas();
}

init();
