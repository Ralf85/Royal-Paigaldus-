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
app.use('/api/graafik', require('./routes/graafik'));
// Minu vahetused (töötajale — ainult oma vahetused)
router.get('/minu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  if (!await onMerekohvik(req.session.workerId)) 
    return res.status(403).json({ ok: false });

  const vahetused = await pool.query(
    `SELECT g.*, w.nimi as worker_nimi
     FROM merekohvik_graafik g
     JOIN workers w ON g.worker_id=w.id
     WHERE g.worker_id=$1
       AND EXTRACT(YEAR FROM g.kuupaev)=$2 
       AND EXTRACT(MONTH FROM g.kuupaev)=$3
     ORDER BY g.kuupaev, g.algus`,
    [req.session.workerId, aasta, kuu]
  );

  const paevad = await pool.query(
    `SELECT * FROM merekohvik_paevad
     WHERE EXTRACT(YEAR FROM kuupaev)=$1 
       AND EXTRACT(MONTH FROM kuupaev)=$2`,
    [aasta, kuu]
  );

  res.json({ vahetused: vahetused.rows, paevad: paevad.rows });
});

// Lisa vahetus
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  if (!await onMerekohvik(req.session.workerId)) return res.status(403).json({ ok: false });
  
  const { kuupaev, algus, lopp, märkus } = req.body;
  if (!kuupaev || !algus || !lopp) return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  
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
router.delete('/:id', noudaSis
