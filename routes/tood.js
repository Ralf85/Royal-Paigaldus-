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
router.get('/objektid/:ettevoteId', noudaSisslogimist, async (req, res) => {
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
  const { ettevote_id, objekt_id, kuupaev, algus, lopp, kommentaar } = req.body;
  try {
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    const tunnid = ((lh * 60 + lm) - (ah * 60 + am)) / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Lõpuaeg peab olema hiljem kui algusaeg' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    await pool.query(
      `INSERT INTO tookirjed (worker_id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.session.workerId, ettevote_id, objekt_id || null, kuupaev, algus, lopp, tunnid, kommentaar || '']
    );
    res.json({ ok: true, tunnid: tunnid.toFixed(2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kustuta töökirje (ainult tänased)
router.delete('/kustuta/:id', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM tookirjed WHERE id=$1 AND worker_id=$2 AND kuupaev=CURRENT_DATE RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (r.rowCount === 0) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
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
              we.tunnitasu
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

module.exports = router;
