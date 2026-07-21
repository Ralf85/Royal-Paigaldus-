const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const KRISTO_WORKER_ID = 17;

function noudaKristo(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Logi sisse' });
  if (req.session.workerId !== KRISTO_WORKER_ID && !req.session.isAdmin) {
    return res.status(403).json({ ok: false, veateade: 'Ligipääs keelatud' });
  }
  next();
}

// Tase 1: Kõik kirjeldused (grupeeritud) - uusim üleval
router.get('/kirjeldused', noudaKristo, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COALESCE(t.kommentaar, 'Määramata') as kirjeldus,
         COUNT(DISTINCT o.id) as poodide_arv,
         COUNT(DISTINCT p.id) as piltide_arv,
         MAX(t.kuupaev) as viimane_kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       WHERE e.nimi = 'LIDL'
       GROUP BY COALESCE(t.kommentaar, 'Määramata')
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY MAX(t.kuupaev) DESC`
    );
    res.json({ ok: true, kirjeldused: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Tase 2: Poodide nimekiri kirjelduse järgi
router.get('/poed', noudaKristo, async (req, res) => {
  const { kirjeldus } = req.query;
  try {
    const r = await pool.query(
      `SELECT
         o.id as objekt_id,
         o.nimi as objekt_nimi,
         COUNT(DISTINCT p.id) as piltide_arv,
         MAX(t.kuupaev) as viimane_kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       WHERE e.nimi = 'LIDL'
         AND COALESCE(t.kommentaar, 'Määramata') = $1
       GROUP BY o.id, o.nimi
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY MAX(t.kuupaev) DESC, o.nimi`,
      [kirjeldus]
    );
    res.json({ ok: true, poed: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Tase 3: Pildid poe ja kirjelduse järgi
router.get('/pildid/:objektId', noudaKristo, async (req, res) => {
  const { kirjeldus } = req.query;
  try {
    const r = await pool.query(
      `SELECT p.id, p.url, DATE(t.kuupaev) as kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       WHERE t.objekt_id = $1
         AND COALESCE(t.kommentaar, 'Määramata') = $2
       ORDER BY t.kuupaev DESC, p.loodud`,
      [req.params.objektId, kirjeldus]
    );
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

module.exports = router;
