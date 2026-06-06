const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Middleware: kas töötaja on sisse logitud?
function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) {
    return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  }
  next();
}

// Töötaja enda tulevased tööd
router.get('/tulevased', noudaSisslogimist, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tulevased_tood
       WHERE worker_id = $1 AND kuupaev >= CURRENT_DATE
       ORDER BY kuupaev, algus_kell`,
      [req.session.workerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});


router.get('/objektid', noudaSisslogimist, async (req, res) => {
  const result = await pool.query('SELECT * FROM objektid WHERE aktiivne = true ORDER BY nimi');
  res.json(result.rows);
});

// Lisa uus töökirje
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  const { objekt_id, kuupaev, algus, lopp, kommentaar } = req.body;
  try {
    // Arvuta tunnid
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    const tunnid = ((lh * 60 + lm) - (ah * 60 + am)) / 60;

    if (tunnid <= 0) {
      return res.json({ ok: false, veateade: 'Lõpuaeg peab olema hiljem kui algusaeg' });
    }
    if (tunnid > 16) {
      return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });
    }

    await pool.query(
      `INSERT INTO tookirjed (worker_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.session.workerId, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar || '']
    );
    res.json({ ok: true, tunnid: tunnid.toFixed(2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kustuta töökirje (ainult enda omad, ainult tänased)
router.delete('/kustuta/:id', noudaSisslogimist, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM tookirjed WHERE id = $1 AND worker_id = $2 AND kuupaev = CURRENT_DATE RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (result.rowCount === 0) {
      return res.json({ ok: false, veateade: 'Kirjet ei leitud või ei saa kustutada' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Töötaja kuu kokkuvõte
router.get('/kokkuvote', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  const workerId = req.session.workerId;
  try {
    // Töökirjed
    const kirjed = await pool.query(
      `SELECT t.*, o.nimi as objekt_nimi
       FROM tookirjed t
       JOIN objektid o ON t.objekt_id = o.id
       WHERE t.worker_id = $1
         AND EXTRACT(YEAR FROM t.kuupaev) = $2
         AND EXTRACT(MONTH FROM t.kuupaev) = $3
       ORDER BY t.kuupaev, t.algus`,
      [workerId, aasta, kuu]
    );

    // Tunnitasu
    const worker = await pool.query('SELECT tunnitasu FROM workers WHERE id = $1', [workerId]);
    const tunnitasu = parseFloat(worker.rows[0].tunnitasu);

    // Kogutunnid ja teenitud
    const kogutunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);
    const teenitud = kogutunnid * tunnitasu;

    // Makstud summad
    const maksed = await pool.query(
      `SELECT SUM(summa) as kokku FROM maksed
       WHERE worker_id = $1
         AND EXTRACT(YEAR FROM kuupaev) = $2
         AND EXTRACT(MONTH FROM kuupaev) = $3`,
      [workerId, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku || 0);

    res.json({
      ok: true,
      kirjed: kirjed.rows,
      kogutunnid: kogutunnid.toFixed(2),
      tunnitasu,
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (teenitud - makstud).toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

module.exports = router;
