const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

// Töötaja ettevõtted (ainult talle määratud)
router.get('/minu-ettevotted', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id, e.nimi, e.tyyp, we.tunnitasu
       FROM worker_ettevotted we
       JOIN ettevotted e ON we.ettevote_id = e.id
       WHERE we.worker_id = $1 AND e.aktiivne = true
       ORDER BY e.id`,
      [req.session.workerId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// Objektid ettevõtte järgi
router.get('/objektid/:ettevoteId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM objektid WHERE ettevote_id = $1 AND aktiivne = true ORDER BY nimi`,
      [req.params.ettevoteId]
    );
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// Lisa töökirje
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  const { ettevote_id, objekt_id, kuupaev, algus, lopp, kommentaar, kilomeetrid, lisakulu_summa, lisakulu_selgitus } = req.body;
  try {
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    let minutid = (lh * 60 + lm) - (ah * 60 + am);
    if (minutid < 0) minutid += 1440;
    let tunnid = minutid / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    const ettevoteInfo = await pool.query('SELECT tyyp FROM ettevotted WHERE id=$1', [ettevote_id]);
    const tyyp = ettevoteInfo.rows[0]?.tyyp || '';
    if (tyyp === 'cramo' && tunnid >= 6) {
      tunnid = tunnid - 0.5;
    }

    const km = parseFloat(kilomeetrid) || 0;
    const km_raha = km > 0 ? (km / 100 * 12) : 0;
    const lisakulu = parseFloat(lisakulu_summa) || 0;
    const lisakulu_sel = lisakulu_selgitus || '';

    const result = await pool.query(
      `INSERT INTO tookirjed (worker_id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, kilomeetrid, km_raha, lisakulu_summa, lisakulu_selgitus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [req.session.workerId, ettevote_id, objekt_id || null, kuupaev, algus, lopp, tunnid, kommentaar || '', km, km_raha, lisakulu, lisakulu_sel]
    );
    const kirjeId = result.rows[0].id;
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'LISA_TOOKIRJE', JSON.stringify({
        kirje_id: kirjeId, ettevote_id, objekt_id, kuupaev, algus, lopp,
        tunnid: tunnid.toFixed(2), kommentaar
      }), req.ip]
    );
    res.json({ ok: true, tunnid: tunnid.toFixed(2), km_raha: km_raha.toFixed(2), kirjeId, lounaPaus: tyyp === 'cramo' && tunnid < (minutid/60) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kustuta töökirje
router.delete('/kustuta/:id', noudaSisslogimist, async (req, res) => {
  try {
    const kirje = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, o.nimi as objekt_nimi
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id=e.id
       LEFT JOIN objektid o ON t.objekt_id=o.id
       WHERE t.id=$1 AND t.worker_id=$2`,
      [req.params.id, req.session.workerId]
    );
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    const k = kirje.rows[0];
    const r = await pool.query(
      `DELETE FROM tookirjed WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (r.rowCount === 0) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'KUSTUTA_TOOKIRJE', JSON.stringify({
        kirje_id: req.params.id, ettevote: k.ettevote_nimi,
        objekt: k.objekt_nimi, kuupaev: k.kuupaev,
        algus: k.algus, lopp: k.lopp, tunnid: k.tunnid
      }), req.ip]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kuu kokkuvõte
router.get('/kokkuvote', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  const wid = req.session.workerId;
  try {
    const kirjed = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp as ettevote_tyyp,
              COALESCE(o.nimi, '') as objekt_nimi,
              we.tunnitasu,
              COALESCE(t.kilomeetrid, 0) as kilomeetrid,
              COALESCE(t.km_raha, 0) as km_raha,
              COALESCE(t.lisakulu_summa, 0) as lisakulu_summa,
              COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       LEFT JOIN worker_ettevotted we ON (we.worker_id = t.worker_id AND we.ettevote_id = t.ettevote_id)
       WHERE t.worker_id=$1 AND EXTRACT(YEAR FROM t.kuupaev)=$2 AND EXTRACT(MONTH FROM t.kuupaev)=$3
       ORDER BY t.kuupaev, t.algus`,
      [wid, aasta, kuu]
    );

    let teenitud = 0;
    kirjed.rows.forEach(k => {
      teenitud += parseFloat(k.tunnid) * parseFloat(k.tunnitasu || 0);
      teenitud += parseFloat(k.km_raha || 0);
      teenitud += parseFloat(k.lisakulu_summa || 0);
    });

    // Lisa vabad lisakulud
    const lisakulud = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [wid, aasta, kuu]
    );
    lisakulud.rows.forEach(l => {
      teenitud += parseFloat(l.summa);
    });

    const kogutunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);

    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [wid, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);

    res.json({
      ok: true,
      kirjed: kirjed.rows,
      lisakulud: lisakulud.rows,
      kogutunnid: kogutunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (teenitud - makstud).toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Tulevased tööd
router.get('/tulevased', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp,
              COALESCE(o.nimi, '') as objekt_nimi
       FROM tulevased_tood t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       WHERE t.worker_id=$1 AND t.kuupaev >= CURRENT_DATE
       ORDER BY t.kuupaev, t.algus_kell`,
      [req.session.workerId]
    );
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// ── VABAD LISAKULUD ─────────────────────────────────────────────

// Lisa lisakulu
router.post('/lisakulu/lisa', noudaSisslogimist, async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    await pool.query(
      `INSERT INTO lisakulud (worker_id, kuupaev, summa, selgitus) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, kuupaev, s, selgitus]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kuu lisakulud
router.get('/lisakulu/kuu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    const r = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [req.session.workerId, aasta, kuu]
    );
    res.json({ ok: true, kulud: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kustuta lisakulu
router.delete('/lisakulu/:id', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM lisakulud WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

module.exports = router;
