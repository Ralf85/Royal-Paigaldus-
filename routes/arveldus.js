const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ══════════════════════════════════════════════════════════════════════════
// ARVELDUSE ÜLEVAADE (leht /arveldus, ainult admin)
//
// Töötajad kirjutavad oma tunnid ja km nii täpselt kui saavad — nende pealt makstakse palka ja seda
// see moodul EI muuda. Kliendi (Lidl) arvele võib admin tunde/km kokkuleppel ümardada. Ümardused
// tehakse siin päeva → poe → projekti kaupa ja salvestatakse eraldi tabelisse `arveldus`.
//
// "Arvele läinud" väärtus = admini sisestatud arve_tunnid / arve_km, kui see on olemas, muidu tegelik.
// Seda kasutavad: Lidli arve autotäitmine ja arve raport (routes/arved.js) ning Lidl Eesti lehe
// Excel (routes/kristo.js). Töötajad ümardust ei näe.
//
// Võti: ettevõte + kuupäev + objekt (0 = määramata) + Lidli projekt (0 = projektita).
// tegelik_tunnid / tegelik_km = tegelikud väärtused hetkel, kui admin rida viimati muutis või üle
// vaatas — kui töötaja hiljem oma kirjet muudab, näeb admin hoiatust "muutunud pärast ülevaatust".
// ══════════════════════════════════════════════════════════════════════════

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

let tabelValmis = null;
function looTabel() {
  if (!tabelValmis) {
    tabelValmis = pool.query(`
      CREATE TABLE IF NOT EXISTS arveldus (
        id SERIAL PRIMARY KEY,
        ettevote_id INTEGER NOT NULL,
        kuupaev DATE NOT NULL,
        objekt_id INTEGER NOT NULL DEFAULT 0,
        lidl_projekt_id INTEGER NOT NULL DEFAULT 0,
        arve_tunnid DECIMAL(10,2),
        arve_km DECIMAL(10,1),
        ule_vaadatud BOOLEAN NOT NULL DEFAULT false,
        tegelik_tunnid DECIMAL(10,2),
        tegelik_km DECIMAL(10,1),
        muudetud TIMESTAMP DEFAULT NOW(),
        UNIQUE (ettevote_id, kuupaev, objekt_id, lidl_projekt_id)
      );
    `).catch(err => { tabelValmis = null; throw err; });
  }
  return tabelValmis;
}
looTabel().catch(err => console.error('arveldus tabeli loomine ebaõnnestus:', err.message));

const r1 = n => Math.round((parseFloat(n) || 0) * 10) / 10;
const r2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const kpStr = d => (d && d.toISOString) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d || '').slice(0, 10);

// Päev + pood + projekt grupid koos tegelike ja arvele minevate väärtustega.
// lisaTingimus / lisaParam: nt Lidl Eesti Exceli projektifilter (SQL t.* veergudel).
async function arveldatavadGrupid(ettevoteId, algus, lopp, lisaTingimus, lisaParam) {
  await looTabel();
  const params = [ettevoteId];
  let periood = '';
  if (algus && lopp) { params.push(algus, lopp); periood = `AND t.kuupaev BETWEEN $2 AND $3`; }
  let lisa = '';
  if (lisaTingimus) { params.push(lisaParam); lisa = `AND ${lisaTingimus.replace(/\$X/g, '$' + params.length)}`; }
  const r = await pool.query(
    `SELECT to_char(t.kuupaev, 'YYYY-MM-DD') AS kp, COALESCE(t.objekt_id, 0) AS objekt_id, COALESCE(t.lidl_projekt_id, 0) AS lidl_projekt_id,
            COALESCE(o.nimi, 'Objekt määramata') AS objekt_nimi, lp.nimi AS projekt_nimi,
            string_agg(DISTINCT NULLIF(t.kommentaar, ''), ' | ') AS kommentaarid,
            string_agg(DISTINCT w.nimi, ', ') AS tootajad,
            string_agg(w.nimi || ' ' || to_char(t.algus, 'HH24:MI') || '–' || to_char(t.lopp, 'HH24:MI'), ' · ' ORDER BY t.algus, w.nimi) AS ajad,
            COUNT(*)::int AS kirjeid,
            SUM(COALESCE(t.tunnid, 0)) AS tegelik_tunnid,
            SUM(COALESCE(t.kilomeetrid, 0)) AS tegelik_km,
            a.arve_tunnid, a.arve_km, COALESCE(a.ule_vaadatud, false) AS ule_vaadatud,
            a.tegelik_tunnid AS snap_tunnid, a.tegelik_km AS snap_km
     FROM tookirjed t
     JOIN workers w ON w.id = t.worker_id
     LEFT JOIN objektid o ON o.id = t.objekt_id
     LEFT JOIN lidl_projektid lp ON lp.id = t.lidl_projekt_id
     LEFT JOIN arveldus a ON a.ettevote_id = t.ettevote_id AND a.kuupaev = t.kuupaev
          AND a.objekt_id = COALESCE(t.objekt_id, 0) AND a.lidl_projekt_id = COALESCE(t.lidl_projekt_id, 0)
     WHERE t.ettevote_id = $1 ${periood} ${lisa}
     GROUP BY t.kuupaev, COALESCE(t.objekt_id, 0), COALESCE(t.lidl_projekt_id, 0), o.nimi, lp.nimi,
              a.arve_tunnid, a.arve_km, a.ule_vaadatud, a.tegelik_tunnid, a.tegelik_km
     ORDER BY t.kuupaev, (o.nimi IS NULL),
              NULLIF(regexp_replace(o.nimi, '^(\\d+).*$', '\\1'), o.nimi)::int NULLS LAST, o.nimi, lp.nimi NULLS LAST`,
    params
  );
  return r.rows.map(g => {
    const tegT = r2(g.tegelik_tunnid), tegKm = r1(g.tegelik_km);
    const arveT = g.arve_tunnid === null ? tegT : r2(g.arve_tunnid);
    const arveKm = g.arve_km === null ? tegKm : r1(g.arve_km);
    const muutunud = g.snap_tunnid !== null && g.snap_km !== null &&
      (Math.abs(r2(g.snap_tunnid) - tegT) > 0.004 || Math.abs(r1(g.snap_km) - tegKm) > 0.04);
    return {
      kuupaev: g.kp, objekt_id: g.objekt_id, lidl_projekt_id: g.lidl_projekt_id,
      objekt_nimi: g.objekt_nimi, maaramata: !g.objekt_id,
      projekt_nimi: g.projekt_nimi || g.kommentaarid || 'Tehtud tööd',
      tootajad: g.tootajad || '', ajad: g.ajad || '', kirjeid: g.kirjeid,
      tegelik_tunnid: tegT, tegelik_km: tegKm,
      arve_tunnid: arveT, arve_km: arveKm,
      tunnid_muudetud: g.arve_tunnid !== null && Math.abs(arveT - tegT) > 0.004,
      km_muudetud: g.arve_km !== null && Math.abs(arveKm - tegKm) > 0.04,
      ule_vaadatud: !!g.ule_vaadatud,
      muutunud
    };
  });
}

// ── API ───────────────────────────────────────────────────────────────────
router.get('/', noudaAdmin, async (req, res) => {
  const { ettevote_id, algus, lopp } = req.query;
  if (!ettevote_id || !algus || !lopp) return res.json({ ok: false, veateade: 'Vali ettevõte ja periood' });
  try {
    const grupid = await arveldatavadGrupid(ettevote_id, algus, lopp);
    res.json({ ok: true, grupid });
  } catch (err) {
    console.error('arveldus:', err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Ühe rea (päev + pood + projekt) arvele minevad tunnid/km. Tühi väärtus = tagasi tegelikule.
router.put('/rida', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const ettevoteId = parseInt(b.ettevote_id, 10);
  const kp = String(b.kuupaev || '').slice(0, 10);
  const objektId = parseInt(b.objekt_id, 10) || 0;
  const projektId = parseInt(b.lidl_projekt_id, 10) || 0;
  if (!ettevoteId || !/^\d{4}-\d{2}-\d{2}$/.test(kp)) return res.json({ ok: false, veateade: 'Vigased andmed' });
  const loe = (v, max) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseFloat(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > max) return undefined;
    return n;
  };
  const t = loe(b.arve_tunnid, 200), km = loe(b.arve_km, 10000);
  if (t === undefined || km === undefined) return res.json({ ok: false, veateade: 'Kontrolli numbreid' });
  try {
    await looTabel();
    const teg = await pool.query(
      `SELECT COALESCE(SUM(tunnid), 0) AS t, COALESCE(SUM(kilomeetrid), 0) AS km FROM tookirjed
       WHERE ettevote_id=$1 AND kuupaev=$2 AND COALESCE(objekt_id, 0)=$3 AND COALESCE(lidl_projekt_id, 0)=$4`,
      [ettevoteId, kp, objektId, projektId]);
    const ule = b.ule_vaadatud === undefined ? null : !!b.ule_vaadatud;
    await pool.query(
      `INSERT INTO arveldus (ettevote_id, kuupaev, objekt_id, lidl_projekt_id, arve_tunnid, arve_km, ule_vaadatud, tegelik_tunnid, tegelik_km, muudetud)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, true),$8,$9,NOW())
       ON CONFLICT (ettevote_id, kuupaev, objekt_id, lidl_projekt_id) DO UPDATE SET
         arve_tunnid=$5, arve_km=$6, ule_vaadatud=COALESCE($7, arveldus.ule_vaadatud, true),
         tegelik_tunnid=$8, tegelik_km=$9, muudetud=NOW()`,
      [ettevoteId, kp, objektId, projektId, t, km, ule, teg.rows[0].t, teg.rows[0].km]);
    res.json({ ok: true });
  } catch (err) {
    console.error('arveldus rida:', err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Terve päev üle vaadatud / mitte (ümardusi ei muuda; uuendab tegelike väärtuste hetktõmmise)
router.put('/paev', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const ettevoteId = parseInt(b.ettevote_id, 10);
  const kp = String(b.kuupaev || '').slice(0, 10);
  if (!ettevoteId || !/^\d{4}-\d{2}-\d{2}$/.test(kp)) return res.json({ ok: false, veateade: 'Vigased andmed' });
  const ule = !!b.ule_vaadatud;
  try {
    await looTabel();
    await pool.query(
      `INSERT INTO arveldus (ettevote_id, kuupaev, objekt_id, lidl_projekt_id, ule_vaadatud, tegelik_tunnid, tegelik_km, muudetud)
       SELECT ettevote_id, kuupaev, COALESCE(objekt_id, 0), COALESCE(lidl_projekt_id, 0), $3,
              SUM(COALESCE(tunnid, 0)), SUM(COALESCE(kilomeetrid, 0)), NOW()
       FROM tookirjed WHERE ettevote_id=$1 AND kuupaev=$2
       GROUP BY ettevote_id, kuupaev, COALESCE(objekt_id, 0), COALESCE(lidl_projekt_id, 0)
       ON CONFLICT (ettevote_id, kuupaev, objekt_id, lidl_projekt_id) DO UPDATE SET
         ule_vaadatud=EXCLUDED.ule_vaadatud, tegelik_tunnid=EXCLUDED.tegelik_tunnid, tegelik_km=EXCLUDED.tegelik_km, muudetud=NOW()`,
      [ettevoteId, kp, ule]);
    res.json({ ok: true });
  } catch (err) {
    console.error('arveldus päev:', err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

module.exports = router;
module.exports.arveldatavadGrupid = arveldatavadGrupid;
