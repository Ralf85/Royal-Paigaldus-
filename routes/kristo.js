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

// Lidli projektid kuu kaupa (kus on pilte)
router.get('/projektid', noudaKristo, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    const r = await pool.query(
      `SELECT
         o.id as objekt_id,
         o.nimi as objekt_nimi,
         DATE(t.kuupaev) as kuupaev,
         COUNT(DISTINCT p.id) as piltide_arv,
         STRING_AGG(DISTINCT w.nimi, ', ' ORDER BY w.nimi) as tootajad
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       JOIN workers w ON t.worker_id = w.id
       WHERE e.nimi = 'LIDL'
         AND EXTRACT(YEAR FROM t.kuupaev) = $1
         AND EXTRACT(MONTH FROM t.kuupaev) = $2
       GROUP BY o.id, o.nimi, DATE(t.kuupaev)
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY DATE(t.kuupaev) DESC, o.nimi`,
      [aasta, kuu]
    );
    res.json({ ok: true, projektid: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Pildid ühe projekti ja kuupäeva kohta
router.get('/pildid/:objektId', noudaKristo, async (req, res) => {
  const { kuupaev } = req.query;
  try {
    let query, params;
    if (kuupaev) {
      query = `SELECT p.id, p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               WHERE t.objekt_id = $1 AND DATE(t.kuupaev) = $2
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId, kuupaev];
    } else {
      query = `SELECT p.id, p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               WHERE t.objekt_id = $1
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId];
    }
    const r = await pool.query(query, params);
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

module.exports = router;
