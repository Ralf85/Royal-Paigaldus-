// ── ETTEVÕTTED (tab13) ─────────────────────────────────────────────────────
// Minu enda ettevõtete (arve_muujad) raport: tulud, kulud, kasum ja käibemaks EMTAle.
// Andmed tulevad olemasolevatest päringutest — müügiarved (/api/arved) ja
// ostuarved/tšekid (/api/arved/sisse). Töötasusid siin EI arvestata (need on Kokkuvõtte lehel).

let etMuujad = [];
let etArved = [];
let etSisse = [];
let etValitudId = null;      // number | 'maaramata' | null
let etLaetud = false;

function etEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function etNum(v) { return parseFloat(v) || 0; }
function etEur(n) {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return v.toLocaleString('et-EE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function etKp(v) { return String(v || '').split('T')[0]; }
function etKpEt(v) { const p = etKp(v).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : ''; }

async function laadiEttevotted() {
  const kuuEl = document.getElementById('et-kuu');
  const aastaEl = document.getElementById('et-aasta');
  if (!kuuEl.options.length) {
    const t = new Date();
    kuuEl.innerHTML = '<option value="0">Terve aasta</option>' +
      KUUD.map((k, i) => `<option value="${i + 1}"${i === t.getMonth() ? ' selected' : ''}>${k}</option>`).join('');
    let ah = '';
    for (let y = t.getFullYear(); y >= t.getFullYear() - 4; y--) ah += `<option value="${y}">${y}</option>`;
    aastaEl.innerHTML = ah;
  }
  const sisu = document.getElementById('et-sisu');
  if (!etLaetud) sisu.innerHTML = '<div class="et-tyhi">Laadimine...</div>';
  try {
    const [m, a, s] = await Promise.all([api('/api/arved/muujad'), api('/api/arved'), api('/api/arved/sisse')]);
    etMuujad = (m && Array.isArray(m.muujad)) ? m.muujad : [];
    etArved = Array.isArray(a) ? a : [];
    etSisse = Array.isArray(s) ? s : [];
    etLaetud = true;
    etRender();
  } catch (e) {
    sisu.innerHTML = '<div class="et-tyhi">Andmete laadimine ebaõnnestus</div>';
  }
}

// Kas kirje kuulub valitud perioodi (kuu = 0 → terve aasta)
function etPerioodis(kp, aasta, kuu) {
  const p = etKp(kp).split('-');
  if (parseInt(p[0], 10) !== aasta) return false;
  return kuu === 0 || parseInt(p[1], 10) === kuu;
}
function etKuulub(rida, id) {
  return id === 'maaramata' ? !rida.muuja_id : rida.muuja_id === id;
}

// Ühe ettevõtte näitajad valitud perioodis
function etArvuta(id, aasta, kuu) {
  const muuja = etMuujad.find(x => x.id === id);
  const kmKohuslane = muuja ? muuja.km_kohuslane !== false : true;
  const muuk = etArved.filter(a => etKuulub(a, id) && etPerioodis(a.kuupaev, aasta, kuu));
  const ost = etSisse.filter(s => etKuulub(s, id) && etPerioodis(s.kuupaev, aasta, kuu));
  const tulud = muuk.reduce((s, a) => s + etNum(a.summa_km_ta), 0);
  const kmMuuk = muuk.reduce((s, a) => s + etNum(a.kaibemaks), 0);
  const kmOst = ost.reduce((s, x) => s + etNum(x.kaibemaks), 0);
  const ostKokku = ost.reduce((s, x) => s + etNum(x.summa), 0);
  // KM-kohuslane saab ostude käibemaksu maha arvata → kulu on km-ta summa.
  // Mitte-kohuslasel on kulu kogu summa ja käibemaksu EMTAle ei teki.
  const kulud = kmKohuslane ? ostKokku - kmOst : ostKokku;
  const kmTasuda = kmKohuslane ? kmMuuk - kmOst : 0;
  return { muuja, kmKohuslane, muuk, ost, tulud, kulud, kasum: tulud - kulud, kmMuuk, kmOst, kmTasuda };
}

function etPeriood() {
  return {
    aasta: parseInt(document.getElementById('et-aasta').value, 10),
    kuu: parseInt(document.getElementById('et-kuu').value, 10)
  };
}
function etPerioodiNimi(aasta, kuu) { return kuu === 0 ? `${aasta}` : `${KUUD[kuu - 1]} ${aasta}`; }
// KMD ja käibemaksu tasumise tähtaeg on järgmise kuu 20. kuupäev.
function etKmTahtaeg(aasta, kuu) {
  const a = kuu === 12 ? aasta + 1 : aasta;
  const k = kuu === 12 ? 1 : kuu + 1;
  return `20.${String(k).padStart(2, '0')}.${a}`;
}

function etVali(id) {
  etValitudId = id;
  etRender();
  const el = document.getElementById('et-detail');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function etRender() {
  const sisu = document.getElementById('et-sisu');
  const { aasta, kuu } = etPeriood();
  const idd = etMuujad.map(m => m.id);
  if (etArved.some(a => !a.muuja_id) || etSisse.some(s => !s.muuja_id)) idd.push('maaramata');
  if (!idd.length) {
    sisu.innerHTML = '<div class="et-tyhi">Ühtegi ettevõtet pole veel lisatud. Lisa oma ettevõte lehel Arved → „Müüjad“.</div>';
    return;
  }
  if (etValitudId !== null && !idd.includes(etValitudId)) etValitudId = null;

  let html = `<div class="et-kaardid">`;
  idd.forEach(id => {
    const r = etArvuta(id, aasta, kuu);
    const nimi = id === 'maaramata' ? 'Ettevõte määramata' : r.muuja.ettevote_nimi;
    const arg = id === 'maaramata' ? `'maaramata'` : id;
    html += `<button type="button" class="et-kaart${etValitudId === id ? ' aktiivne' : ''}" onclick="etVali(${arg})">
      <div class="et-kaart-pea">
        <span class="et-kaart-nimi">${etEsc(nimi)}</span>
        ${id !== 'maaramata' && !r.kmKohuslane ? '<span class="staatus-pill hall">Ei ole KM-kohuslane</span>' : ''}
      </div>
      <div class="et-kaart-read">
        <div><span>Tulud</span><b style="color:var(--roheline)">${etEur(r.tulud)}</b></div>
        <div><span>Kulud</span><b style="color:var(--punane)">${etEur(r.kulud)}</b></div>
        <div><span>Kasum</span><b style="color:${r.kasum >= 0 ? 'var(--tekst)' : 'var(--punane)'}">${etEur(r.kasum)}</b></div>
        <div class="et-kaart-km"><span>${r.kmTasuda >= 0 ? 'KM tasuda EMTAle' : 'KM tagasi EMTAlt'}</span><b style="color:var(--kuld)">${r.kmKohuslane ? etEur(Math.abs(r.kmTasuda)) : '—'}</b></div>
      </div>
      <div class="et-kaart-jalus">Vaata raportit ›</div>
    </button>`;
  });
  html += `</div>`;

  if (etValitudId === null) {
    html += `<div class="et-tyhi">Vajuta ettevõttele, et näha raportit · ${etEsc(etPerioodiNimi(aasta, kuu))}</div>`;
  } else {
    html += etRenderDetail(etValitudId, aasta, kuu);
  }
  sisu.innerHTML = html;
}

function etStat(silt, vaartus, varv, sub) {
  return `<div class="stat-kaart"><div>
    <div class="stat-kaart-label">${silt}</div>
    <div class="stat-kaart-val" style="font-size:20px${varv ? ';color:' + varv : ''}">${vaartus}</div>
    ${sub ? `<div class="stat-kaart-sub">${sub}</div>` : ''}
  </div></div>`;
}

function etRenderDetail(id, aasta, kuu) {
  const r = etArvuta(id, aasta, kuu);
  const nimi = id === 'maaramata' ? 'Ettevõte määramata' : r.muuja.ettevote_nimi;
  const periood = etPerioodiNimi(aasta, kuu);

  // Laekumata müügiarved ja maksmata ostuarved — kogu aja peale, mitte ainult valitud perioodis.
  const laekumata = etArved.filter(a => etKuulub(a, id) && a.staatus !== 'makstud');
  const maksmata = etSisse.filter(s => etKuulub(s, id) && s.staatus !== 'makstud');
  const laekumataSumma = laekumata.reduce((s, a) => s + etNum(a.kokku), 0);
  const maksmataSumma = maksmata.reduce((s, x) => s + etNum(x.summa), 0);

  let kmSub = '';
  if (!r.kmKohuslane) kmSub = 'ettevõte ei ole KM-kohuslane';
  else if (kuu !== 0) kmSub = r.kmTasuda >= 0 ? `tähtaeg ${etKmTahtaeg(aasta, kuu)}` : 'enammakse — EMTA tagastab või jääb ettemaksuks';
  else kmSub = 'aasta kokku — kuude kaupa vt allpool';

  let html = `<div id="et-detail" class="et-detail">
    <div class="et-detail-pea">
      <div>
        <div class="et-detail-nimi">${etEsc(nimi)}</div>
        <div class="et-detail-sub">${etEsc(periood)}${r.muuja && r.muuja.rg_kood ? ' · reg ' + etEsc(r.muuja.rg_kood) : ''}${r.muuja && r.muuja.kmkr ? ' · KMKR ' + etEsc(r.muuja.kmkr) : ''}</div>
      </div>
    </div>
    ${id === 'maaramata' ? '<div class="et-markus">Need arved ja kulud ei ole ühegi sinu ettevõttega seotud. Määra neile ettevõte lehel Arved, siis liiguvad need õige ettevõtte raportisse.</div>' : ''}

    <div class="et-ala-pealkiri">Tulud ja kulud (käibemaksuta)</div>
    <div class="et-stat-rida">
      ${etStat('Tulud', etEur(r.tulud), 'var(--roheline)', `${r.muuk.length} müügiarvet`)}
      ${etStat('Kulud', etEur(r.kulud), 'var(--punane)', `${r.ost.length} ostuarvet/tšekki`)}
      ${etStat('Kasum', etEur(r.kasum), r.kasum >= 0 ? '' : 'var(--punane)', 'tulud − kulud, ilma töötasudeta')}
    </div>

    <div class="et-ala-pealkiri">Käibemaks EMTAle</div>
    <div class="et-stat-rida">
      ${etStat('KM müügilt', r.kmKohuslane ? etEur(r.kmMuuk) : '—', '', 'müügiarvetelt')}
      ${etStat('KM ostudelt', r.kmKohuslane ? etEur(r.kmOst) : '—', '', 'mahaarvatav sisendkäibemaks')}
      ${etStat(r.kmTasuda >= 0 ? 'Tasuda EMTAle' : 'Tagasi EMTAlt', r.kmKohuslane ? etEur(Math.abs(r.kmTasuda)) : '—', 'var(--kuld)', kmSub)}
    </div>

    <div class="et-ala-pealkiri">Raha liikumine (kõik perioodid)</div>
    <div class="et-stat-rida">
      ${etStat('Klientidelt laekumata', etEur(laekumataSumma), '', `${laekumata.length} maksmata müügiarvet`)}
      ${etStat('Tarnijatele maksmata', etEur(maksmataSumma), '', `${maksmata.length} ootel ostuarvet`)}
    </div>`;

  // Aasta kuude kaupa
  html += `<div class="et-ala-pealkiri">${aasta} kuude kaupa</div>
    <div class="et-tabel-umbris"><table>
      <thead><tr><th>Kuu</th><th style="text-align:right">Tulud</th><th style="text-align:right">Kulud</th><th style="text-align:right">Kasum</th>
      <th style="text-align:right">KM müügilt</th><th style="text-align:right">KM ostudelt</th><th style="text-align:right">KM EMTAle</th><th>Tähtaeg</th></tr></thead><tbody>`;
  const sum = { tulud: 0, kulud: 0, kasum: 0, kmMuuk: 0, kmOst: 0, kmTasuda: 0 };
  for (let k = 1; k <= 12; k++) {
    const x = etArvuta(id, aasta, k);
    Object.keys(sum).forEach(v => sum[v] += x[v]);
    const tyhi = !x.muuk.length && !x.ost.length;
    const km = v => r.kmKohuslane ? etEur(v) : '—';
    html += `<tr class="${k === kuu ? 'et-rida-valitud' : ''}${tyhi ? ' et-rida-tyhi' : ''}">
      <td>${KUUD[k - 1]}</td>
      <td style="text-align:right">${tyhi ? '—' : etEur(x.tulud)}</td>
      <td style="text-align:right">${tyhi ? '—' : etEur(x.kulud)}</td>
      <td style="text-align:right;color:${x.kasum < 0 ? 'var(--punane)' : 'inherit'}">${tyhi ? '—' : etEur(x.kasum)}</td>
      <td style="text-align:right">${tyhi ? '—' : km(x.kmMuuk)}</td>
      <td style="text-align:right">${tyhi ? '—' : km(x.kmOst)}</td>
      <td style="text-align:right;font-weight:700;color:var(--kuld)">${tyhi ? '—' : km(x.kmTasuda)}</td>
      <td style="color:var(--hall)">${tyhi || !r.kmKohuslane ? '' : etKmTahtaeg(aasta, k)}</td>
    </tr>`;
  }
  const km = v => r.kmKohuslane ? etEur(v) : '—';
  html += `<tr style="font-weight:700;border-top:1px solid var(--piir)">
      <td>KOKKU</td>
      <td style="text-align:right">${etEur(sum.tulud)}</td><td style="text-align:right">${etEur(sum.kulud)}</td>
      <td style="text-align:right">${etEur(sum.kasum)}</td><td style="text-align:right">${km(sum.kmMuuk)}</td>
      <td style="text-align:right">${km(sum.kmOst)}</td><td style="text-align:right;color:var(--kuld)">${km(sum.kmTasuda)}</td><td></td>
    </tr></tbody></table></div>`;

  // Perioodi arved
  html += `<div class="et-ala-pealkiri">Müügiarved · ${etEsc(periood)}</div>`;
  if (!r.muuk.length) html += `<div class="et-tyhi et-tyhi-vaike">Selles perioodis müügiarveid pole</div>`;
  else {
    html += `<div class="et-tabel-umbris"><table><thead><tr><th>Kuupäev</th><th>Number</th><th>Klient</th>
      <th style="text-align:right">Summa km-ta</th><th style="text-align:right">KM</th><th style="text-align:right">Kokku</th><th>Staatus</th></tr></thead><tbody>`;
    r.muuk.forEach(a => {
      html += `<tr><td>${etKpEt(a.kuupaev)}</td><td>${etEsc(a.number)}</td><td>${etEsc(a.ostja_nimi || a.ettevote_nimi || '')}</td>
        <td style="text-align:right">${etEur(etNum(a.summa_km_ta))}</td><td style="text-align:right">${etEur(etNum(a.kaibemaks))}</td>
        <td style="text-align:right;font-weight:700">${etEur(etNum(a.kokku))}</td>
        <td><span class="staatus-pill ${a.staatus === 'makstud' ? 'roheline' : 'punane'}">${a.staatus === 'makstud' ? 'Laekunud' : 'Laekumata'}</span></td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  html += `<div class="et-ala-pealkiri">Ostuarved ja tšekid · ${etEsc(periood)}</div>`;
  if (!r.ost.length) html += `<div class="et-tyhi et-tyhi-vaike">Selles perioodis kulusid pole</div>`;
  else {
    html += `<div class="et-tabel-umbris"><table><thead><tr><th>Kuupäev</th><th>Kirjeldus</th>
      <th style="text-align:right">Summa km-ta</th><th style="text-align:right">KM</th><th style="text-align:right">Kokku</th><th>Staatus</th></tr></thead><tbody>`;
    r.ost.forEach(s => {
      const kokku = etNum(s.summa), kmv = etNum(s.kaibemaks);
      html += `<tr><td>${etKpEt(s.kuupaev)}</td><td>${etEsc(s.kirjeldus || s.ettevote_nimi || '')}</td>
        <td style="text-align:right">${etEur(kokku - kmv)}</td><td style="text-align:right">${etEur(kmv)}</td>
        <td style="text-align:right;font-weight:700">${etEur(kokku)}</td>
        <td><span class="staatus-pill ${s.staatus === 'makstud' ? 'roheline' : 'oranz'}">${s.staatus === 'makstud' ? 'Makstud' : 'Ootel'}</span></td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  html += `<div class="et-markus">Raport arvestab rakendusse sisestatud müügiarveid ning ostuarveid/tšekke arve kuupäeva järgi. Töötasud ja tööjõumaksud siin ei kajastu. Enne KMD esitamist kontrolli summad raamatupidajaga üle.</div>
  </div>`;
  return html;
}
