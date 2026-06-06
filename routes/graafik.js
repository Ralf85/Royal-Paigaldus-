const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

// Kontrolli kas töötaja on Merekohvikuga seotud
async function onMerekohvik(workerId) {
  const r = await pool.query(
    `SELECT we.id FROM worker_ettevotted we
     JOIN ettevotted e ON we.ettevote_id=e.id
     WHERE we.worker_id=$1 AND e.nimi='MEREKOHVIK'`,
    [workerId]
  );
  return r.rows.length > 0;
}

// Kuu graafik
router.get('/kuu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  if (!await onMerekohvik(req.session.workerId)) return res.status(403).json({ ok: false });
  
  const r = await pool.query(
    `SELECT g.*, w.nimi as worker_nimi
     FROM merekohvik_graafik g
     JOIN workers w ON g.worker_id=w.id
     WHERE EXTRACT(YEAR FROM g.kuupaev)=$1 AND EXTRACT(MONTH FROM g.kuupaev)=$2
     ORDER BY g.kuupaev, g.algus`,
    [aasta, kuu]
  );
  res.json(r.rows);
});

// Lisa vahetus
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  if (!await onMerekohvik(req.session.workerId)) return res.status(403).json({ ok: false });
  
  const { kuupaev, algus, lopp, märkus } = req.body;
  if (!kuupaev || !algus || !lopp) return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  
  try {
    await pool.query(
      `INSERT INTO merekohvik_graafik (worker_id, kuupaev, algus, lopp, märkus)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.session.workerId, kuupaev, algus, lopp, märkus || '']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kustuta oma vahetus
router.delete('/:id', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM merekohvik_graafik WHERE id=$1 AND worker_id=$2 RETURNING id',
      [req.params.id, req.session.workerId]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin: kõik vahetused
router.get('/admin/kuu', async (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json([]);
  const { aasta, kuu } = req.query;
  const r = await pool.query(
    `SELECT g.*, w.nimi as worker_nimi
     FROM merekohvik_graafik g
     JOIN workers w ON g.worker_id=w.id
     WHERE EXTRACT(YEAR FROM g.kuupaev)=$1 AND EXTRACT(MONTH FROM g.kuupaev)=$2
     ORDER BY g.kuupaev, g.algus`,
    [aasta, kuu]
  );
  res.json(r.rows);
});

// Admin: kustuta vahetus
router.delete('/admin/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ ok: false });
  await pool.query('DELETE FROM merekohvik_graafik WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
