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

// ZIP allalaadimine Kristole
router.get('/zip/:objektId', noudaKristo, async (req, res) => {
  const archiver = require('archiver');
  const https = require('https');
  const http = require('http');
  const { kirjeldus } = req.query;
  try {
    let query, params;
    if (kirjeldus) {
      query = `SELECT p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               WHERE t.objekt_id = $1 AND COALESCE(t.kommentaar, 'Määramata') = $2
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId, kirjeldus];
    } else {
      query = `SELECT p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               WHERE t.objekt_id = $1
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId];
    }
    const pildid = await pool.query(query, params);
    if (!pildid.rows.length) return res.status(404).json({ ok: false, veateade: 'Pilte ei leitud' });

    const objektInfo = await pool.query('SELECT nimi FROM objektid WHERE id=$1', [req.params.objektId]);
    const objektNimi = (objektInfo.rows[0]?.nimi || 'pildid').replace(/[^a-zA-Z0-9]/g, '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${objektNimi}_pildid.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const pilt of pildid.rows) {
      const kuupaev = String(pilt.kuupaev).split('T')[0];
      const fileName = `${kuupaev}_${pilt.nimi || 'pilt.jpg'}`.replace(/[^a-zA-Z0-9-_.]/g, '_');
      await new Promise((resolve, reject) => {
        const url = new URL(pilt.url);
        const proto = url.protocol === 'https:' ? https : http;
        proto.get(pilt.url, (imgRes) => {
          archive.append(imgRes, { name: fileName });
          imgRes.on('end', resolve);
          imgRes.on('error', reject);
        }).on('error', reject);
      });
    }
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

module.exports = router;
