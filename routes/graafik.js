const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

function noudaAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ ok: false });
  next();
}

async function onMerekohvik(workerId) {
  const r = await pool.query(
    `SELECT we.id FROM worker_ettevotted we
     JOIN ettevotted e ON we.ettevote_id=e.id
     WHERE we.worker_id=$1 AND e.nimi='MEREKOHVIK'`,
    [workerId]
  );
  return r.rows.length > 0;
}

// Kuu graafik (töötajale)
router.get('/kuu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  if (!await onMerekohvik(req.session.workerId)) return res.status(403).json({ ok: false });
  
  const vahetused = await pool.query(
    `SELECT g.*, w.nimi as worker_nimi
     FROM merekohvik_graafik g
     JOIN workers w ON g.worker_id=w.id
     WHERE EXTRACT(YEAR FROM g.kuupaev)=$1 AND EXTRACT(MONTH FROM g.kuupaev)=$2
     ORDER BY g.kuupaev, g.algus`,
    [aasta, kuu]
  );

  const paevad = await pool.query(
    `SELECT * FROM merekohvik_paevad
     WHERE EXTRACT(YEAR FROM kuupaev)=$1 AND EXTRACT(MONTH FROM kuupaev)=$2`,
    [aasta, kuu]
  );

  res.json({ vahetused: vahetused.rows, paevad: paevad.rows });
});

// Lisa vahetus
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  if (!await onMerekohvik(req.session.workerId)) return res.status(403).json({ ok: false });
  
  const { kuupaev, algus, lopp, märkus } = req.body;
  if (!kuupaev || !algus || !lopp) return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  
  // Kontrolli kas päev on lukustatud
  const lukk = await pool.query('SELECT lukustatud FROM merekohvik_paevad WHERE kuupaev=$1', [kuupaev]);
  if (lukk.rows.length && lukk.rows[0].lukustatud) {
    return res.json({ ok: false, veateade: 'See päev on lukustatud' });
  }
  
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

// ── ADMIN ──────────────────────────────────────────────────────────

// Admin: lisa vahetus
router.post('/admin/lisa', noudaAdmin, async (req, res) => {
  const { worker_id, kuupaev, algus, lopp, märkus } = req.body;
  if (!worker_id || !kuupaev || !algus || !lopp) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  // Kontrolli kas päev on lukustatud
  const lukk = await pool.query('SELECT lukustatud FROM merekohvik_paevad WHERE kuupaev=$1', [kuupaev]);
  if (lukk.rows.length && lukk.rows[0].lukustatud) {
    return res.json({ ok: false, veateade: 'See päev on lukustatud' });
  }
  try {
    await pool.query(
      `INSERT INTO merekohvik_graafik (worker_id, kuupaev, algus, lopp, märkus)
       VALUES ($1, $2, $3, $4, $5)`,
      [worker_id, kuupaev, algus, lopp, märkus || '']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin: kuu graafik
router.get('/admin/kuu', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const vahetused = await pool.query(
    `SELECT g.*, w.nimi as worker_nimi
     FROM merekohvik_graafik g
     JOIN workers w ON g.worker_id=w.id
     WHERE EXTRACT(YEAR FROM g.kuupaev)=$1 AND EXTRACT(MONTH FROM g.kuupaev)=$2
     ORDER BY g.kuupaev, g.algus`,
    [aasta, kuu]
  );
  const paevad = await pool.query(
    `SELECT * FROM merekohvik_paevad
     WHERE EXTRACT(YEAR FROM kuupaev)=$1 AND EXTRACT(MONTH FROM kuupaev)=$2`,
    [aasta, kuu]
  );
  res.json({ vahetused: vahetused.rows, paevad: paevad.rows });
});

// Admin: uuenda päeva staatust
router.post('/admin/paev', noudaAdmin, async (req, res) => {
  const { kuupaev, staatus, märkus, lukustatud } = req.body;
  try {
    await pool.query(
      `INSERT INTO merekohvik_paevad (kuupaev, staatus, märkus, lukustatud)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kuupaev) DO UPDATE SET staatus=$2, märkus=$3, lukustatud=$4`,
      [kuupaev, staatus || 'tavaline', märkus || '', lukustatud || false]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin: kustuta vahetus
router.delete('/admin/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM merekohvik_graafik WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;

// Muuda vahetust (admin)
router.put('/admin/:id', noudaAdmin, async (req, res) => {
  const { worker_id, algus, lopp, märkus } = req.body;
  try {
    await pool.query(
      'UPDATE merekohvik_graafik SET worker_id=$1, algus=$2, lopp=$3, märkus=$4 WHERE id=$5',
      [worker_id, algus, lopp, märkus||'', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
