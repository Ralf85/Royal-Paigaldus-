const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return cloudinary;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

// Kontrolli kas töötajal on RE lubatud
router.get('/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT 1 FROM re_lubatud WHERE worker_id=$1',
      [req.session.workerId]
    );
    res.json({ ok: true, lubatud: r.rows.length > 0 });
  } catch (err) {
    res.json({ ok: false, lubatud: false });
  }
});

// Lisa kulu (koos foto uploadiga)
router.post('/lisa', noudaSisslogimist, upload.single('foto'), async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    let foto_url = null, foto_public_id = null;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = getCloudinary().uploader.upload_stream(
          { folder: 'royal-paigaldus/rally-estonia', resource_type: 'image', quality: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      foto_url = result.secure_url;
      foto_public_id = result.public_id;
    }
    const r = await pool.query(
      `INSERT INTO re_kulud (worker_id, kuupaev, summa, selgitus, foto_url, foto_public_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.session.workerId, kuupaev, s, selgitus, foto_url, foto_public_id]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Töötaja enda kulud
router.get('/minu', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM re_kulud WHERE worker_id=$1 ORDER BY kuupaev DESC`,
      [req.session.workerId]
    );
    res.json({ ok: true, kulud: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Muuda kulu (koos uue fotoga)
router.post('/:id/uuenda', noudaSisslogimist, upload.single('foto'), async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    const vana = await pool.query(
      'SELECT * FROM re_kulud WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!vana.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    let foto_url = vana.rows[0].foto_url;
    let foto_public_id = vana.rows[0].foto_public_id;
    if (req.file) {
      if (foto_public_id) {
        try { await getCloudinary().uploader.destroy(foto_public_id); } catch(e) {}
      }
      const result = await new Promise((resolve, reject) => {
        const stream = getCloudinary().uploader.upload_stream(
          { folder: 'royal-paigaldus/rally-estonia', resource_type: 'image', quality: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      foto_url = result.secure_url;
      foto_public_id = result.public_id;
    }
    await pool.query(
      'UPDATE re_kulud SET kuupaev=$1, summa=$2, selgitus=$3, foto_url=$4, foto_public_id=$5 WHERE id=$6',
      [kuupaev, s, selgitus, foto_url, foto_public_id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kustuta kulu
router.delete('/:id', noudaSisslogimist, async (req, res) => {
  try {
    const kulu = await pool.query(
      'SELECT * FROM re_kulud WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!kulu.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    if (kulu.rows[0].foto_public_id) {
      try { await getCloudinary().uploader.destroy(kulu.rows[0].foto_public_id); } catch(e) {}
    }
    await pool.query('DELETE FROM re_kulud WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── ADMIN ────────────────────────────────────────────────────────

router.get('/admin/kulud', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    let query = `SELECT e.*, w.nimi as worker_nimi
                 FROM re_kulud e
                 JOIN workers w ON e.worker_id = w.id`;
    const params = [];
    if (aasta && kuu) {
      query += ` WHERE EXTRACT(YEAR FROM e.kuupaev)=$1 AND EXTRACT(MONTH FROM e.kuupaev)=$2`;
      params.push(aasta, kuu);
    }
    query += ` ORDER BY e.kuupaev DESC, w.nimi`;
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/admin/csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    let query = `SELECT e.kuupaev, w.nimi as worker_nimi, e.summa, e.selgitus, e.foto_url
                 FROM re_kulud e
                 JOIN workers w ON e.worker_id = w.id`;
    const params = [];
    if (aasta && kuu) {
      query += ` WHERE EXTRACT(YEAR FROM e.kuupaev)=$1 AND EXTRACT(MONTH FROM e.kuupaev)=$2`;
      params.push(aasta, kuu);
    }
    query += ` ORDER BY e.kuupaev, w.nimi`;
    const r = await pool.query(query, params);
    const kuuNimi = aasta && kuu ? `${aasta}_${String(kuu).padStart(2,'0')}` : 'koik';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rally_estonia_kulud_${kuuNimi}.csv"`);
    let csv = '\uFEFF';
    csv += 'Kuupaev;Tootaja;Summa (EUR);Selgitus;Foto link\r\n';
    let kokku = 0;
    r.rows.forEach(row => {
      const d = new Date(row.kuupaev);
      const kp = `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;
      const summa = parseFloat(row.summa);
      kokku += summa;
      const foto = row.foto_url || '';
      const selgitus = (row.selgitus || '').replace(/;/g, ',');
      csv += `${kp};${row.worker_nimi};${summa.toFixed(2).replace('.',',')};${selgitus};${foto}\r\n`;
    });
    csv += `KOKKU;;;${kokku.toFixed(2).replace('.',',')};;\r\n`;
    res.send(csv);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/admin/lubatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi,
       EXISTS(SELECT 1 FROM re_lubatud el WHERE el.worker_id=w.id) as lubatud
       FROM workers w WHERE w.aktiivne=true ORDER BY w.nimi`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

router.post('/admin/lubatud/:workerId', noudaAdmin, async (req, res) => {
  const { lubatud } = req.body;
  try {
    if (lubatud) {
      await pool.query(
        'INSERT INTO re_lubatud (worker_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [req.params.workerId]
      );
    } else {
      await pool.query('DELETE FROM re_lubatud WHERE worker_id=$1', [req.params.workerId]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
