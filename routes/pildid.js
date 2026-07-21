const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const archiver = require('archiver');
const https = require('https');
const http = require('http');

function getCloudinary() {
  console.log('Cloudinary config:', { cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY ? 'OK' : 'PUUDUB', api_secret: process.env.CLOUDINARY_API_SECRET ? 'OK' : 'PUUDUB' });
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  return cloudinary;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per pilt
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Ainult pildifailid!'));
  }
});

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// Laadi pildid üles (kuni 12 korraga)
router.post('/lisa', noudaSisslogimist, upload.array('pildid', 12), async (req, res) => {
  const { kirje_id } = req.body;
  if (!kirje_id) return res.json({ ok: false, veateade: 'kirje_id puudub' });

  try {
    // Kontrolli et töökirje kuulub sellele töötajale
    const kirje = await pool.query(
      `SELECT t.*, e.tyyp, o.nimi as objekt_nimi FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       WHERE t.id=$1 AND t.worker_id=$2`,
      [kirje_id, req.session.workerId]
    );
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });

    const k = kirje.rows[0];
    const objektNimi = (k.objekt_nimi || 'objekt').replace(/[^a-zA-Z0-9]/g, '_');
    const kuupaev = k.kuupaev.toISOString ? k.kuupaev.toISOString().split('T')[0] : String(k.kuupaev).split('T')[0];
    const folder = `royal-paigaldus/${objektNimi}/${kuupaev}`;

    const uploaded = [];
    const files = req.files || [];

    for (const file of files) {
      const result = await new Promise((resolve, reject) => {
        const stream = getCloudinary().uploader.upload_stream(
          { folder, resource_type: 'image', quality: 'auto', fetch_format: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(file.buffer);
      });
      await pool.query(
        'INSERT INTO tookirje_pildid (tookirje_id, url, public_id, nimi) VALUES ($1,$2,$3,$4)',
        [kirje_id, result.secure_url, result.public_id, file.originalname]
      );
      uploaded.push({ url: result.secure_url, public_id: result.public_id });
    }

    res.json({ ok: true, pildid: uploaded, arv: uploaded.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Töökirje pildid
router.get('/tookirje/:tookirjeId', async (req, res) => {
  const r = await pool.query('SELECT * FROM tookirje_pildid WHERE tookirje_id=$1 ORDER BY loodud', [req.params.tookirjeId]);
  res.json(r.rows);
});

// Kustuta pilt
router.delete('/:piltId', noudaSisslogimist, async (req, res) => {
  try {
    const pilt = await pool.query(
      `SELECT p.*, t.worker_id FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       WHERE p.id=$1`,
      [req.params.piltId]
    );
    if (!pilt.rows.length) return res.json({ ok: false, veateade: 'Pilti ei leitud' });
    if (pilt.rows[0].worker_id !== req.session.workerId && !req.session.isAdmin) return res.status(401).json({ ok: false });
    await getCloudinary().uploader.destroy(pilt.rows[0].public_id);
    await pool.query('DELETE FROM tookirje_pildid WHERE id=$1', [req.params.piltId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin: kõik pildid objekti kaupa
router.get('/admin/objektid', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT o.id, o.nimi, e.nimi as ettevote_nimi, COUNT(p.id) as piltide_arv
     FROM objektid o
     JOIN ettevotted e ON o.ettevote_id = e.id
     LEFT JOIN tookirjed t ON t.objekt_id = o.id
     LEFT JOIN tookirje_pildid p ON p.tookirje_id = t.id
     GROUP BY o.id, o.nimi, e.nimi HAVING COUNT(p.id) > 0
     ORDER BY e.nimi, o.nimi`
  );
  res.json(r.rows);
});

// Admin: pildid ühe objekti kohta
router.get('/admin/objekt/:objektId', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT p.*, t.kuupaev, w.nimi as worker_nimi, o.nimi as objekt_nimi
     FROM tookirje_pildid p
     JOIN tookirjed t ON p.tookirje_id = t.id
     JOIN workers w ON t.worker_id = w.id
     JOIN objektid o ON t.objekt_id = o.id
     WHERE t.objekt_id=$1
     ORDER BY t.kuupaev DESC, p.loodud`,
    [req.params.objektId]
  );
  res.json(r.rows);
});

// Admin: ZIP allalaadimine objekti piltidest
router.get('/admin/zip/:objektId', noudaAdmin, async (req, res) => {
  try {
    const pildid = await pool.query(
      `SELECT p.url, p.nimi, t.kuupaev, w.nimi as worker_nimi, o.nimi as objekt_nimi
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN workers w ON t.worker_id = w.id
       JOIN objektid o ON t.objekt_id = o.id
       WHERE t.objekt_id=$1
       ORDER BY t.kuupaev, p.loodud`,
      [req.params.objektId]
    );
    if (!pildid.rows.length) return res.status(404).json({ ok: false, veateade: 'Pilte ei leitud' });
    const objektNimi = pildid.rows[0].objekt_nimi.replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${objektNimi}_pildid.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    for (const pilt of pildid.rows) {
      const kuupaev = String(pilt.kuupaev).split('T')[0];
      const fileName = `${kuupaev}_${pilt.worker_nimi}_${pilt.nimi || 'pilt.jpg'}`.replace(/[^a-zA-Z0-9-_.]/g, '_');
      await new Promise((resolve, reject) => {
        const url = new URL(pilt.url);
        const proto = url.protocol === 'https:' ? https : http;
        proto.get(pilt.url, (imgRes) => { archive.append(imgRes, { name: fileName }); imgRes.on('end', resolve); imgRes.on('error', reject); }).on('error', reject);
      });
    }
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Töötaja enda kirjete pildid batch
router.get('/batch', noudaSisslogimist, async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.json({ ok: true, pildid: [] });
  try {
    const idList = ids.split(',').map(Number).filter(Boolean);
    if (!idList.length) return res.json({ ok: true, pildid: [] });
    const r = await pool.query(
      `SELECT p.*, t.worker_id FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       WHERE p.tookirje_id = ANY($1) AND t.worker_id = $2
       ORDER BY p.loodud ASC`,
      [idList, req.session.workerId]
    );
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    res.json({ ok: true, pildid: [] });
  }
});

module.exports = router;
