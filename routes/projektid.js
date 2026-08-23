const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// ── ÜLDINE PROJEKTIDE MOODUL ────────────────────────────────────────────
// Asendab varasemaid eraldi routes/edgf.js ja routes/re.js faile — sama loogika,
// aga parametriseeritud (:projektId) nii, et uue projekti (nt tulevane üritus) saab
// adminnist luua ilma uut koodi kirjutamata. Lisaks on siin AI tšekilugemine (Anthropic),
// mida vanades EDGF/RE moodulites polnud.

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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Ainult pildid või PDF-id!'));
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

async function omabLigipaasu(projektId, workerId) {
  const r = await pool.query('SELECT 1 FROM projekti_lubatud WHERE projekt_id=$1 AND worker_id=$2', [projektId, workerId]);
  return r.rows.length > 0;
}

// ── TÖÖTAJA POOL ─────────────────────────────────────────────────────

// Millistele projektidele on töötajal ligipääs — kaasa arvestatud valitud kuu kulude summa,
// et adminni tootaja.html saaks kaardid kohe õigete numbritega renderdada ilma lisapäringuteta.
router.get('/minu-projektid', noudaSisslogimist, async (req, res) => {
  try {
    const { aasta, kuu } = req.query;
    const projektid = await pool.query(`
      SELECT p.id, p.nimi, p.ikoon, p.varv
      FROM projektid p
      JOIN projekti_lubatud pl ON pl.projekt_id = p.id
      WHERE pl.worker_id = $1 AND p.aktiivne = true
      ORDER BY p.jrk_nr, p.nimi
    `, [req.session.workerId]);
    const tulemus = [];
    for (const p of projektid.rows) {
      let kuu_summa = 0;
      if (aasta && kuu) {
        const s = await pool.query(`
          SELECT COALESCE(SUM(summa),0) as summa FROM projekti_kulud
          WHERE projekt_id=$1 AND worker_id=$2 AND EXTRACT(YEAR FROM kuupaev)=$3 AND EXTRACT(MONTH FROM kuupaev)=$4
        `, [p.id, req.session.workerId, aasta, kuu]);
        kuu_summa = parseFloat(s.rows[0].summa) || 0;
      }
      tulemus.push({ id: p.id, nimi: p.nimi, ikoon: p.ikoon, varv: p.varv, kuu_summa });
    }
    res.json({ ok: true, projektid: tulemus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Lisa kulu (koos foto uploadiga)
router.post('/:projektId/lisa', noudaSisslogimist, upload.single('foto'), async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    if (!(await omabLigipaasu(req.params.projektId, req.session.workerId))) {
      return res.status(403).json({ ok: false, veateade: 'Ligipääs puudub' });
    }
    let foto_url = null, foto_public_id = null;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = getCloudinary().uploader.upload_stream(
          { folder: 'royal-paigaldus/projektid', resource_type: 'image', quality: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      foto_url = result.secure_url;
      foto_public_id = result.public_id;
    }
    const r = await pool.query(
      `INSERT INTO projekti_kulud (projekt_id, worker_id, kuupaev, summa, selgitus, foto_url, foto_public_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.params.projektId, req.session.workerId, kuupaev, s, selgitus, foto_url, foto_public_id]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Töötaja enda kulud selles projektis
router.get('/:projektId/minu', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM projekti_kulud WHERE projekt_id=$1 AND worker_id=$2 ORDER BY kuupaev DESC`,
      [req.params.projektId, req.session.workerId]
    );
    res.json({ ok: true, kulud: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// AI loeb tšeki/arve pildilt kuupäeva, summa ja selgituse (müüja nime) automaatselt
router.post('/:projektId/loe', noudaSisslogimist, upload.single('fail'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Faili ei leitud' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ ok: false, veateade: 'AI lugemine pole seadistatud (ANTHROPIC_API_KEY puudub Railway keskkonnamuutujates).' });
  }
  try {
    if (!(await omabLigipaasu(req.params.projektId, req.session.workerId))) {
      return res.status(403).json({ ok: false, veateade: 'Ligipääs puudub' });
    }
    const isPdf = req.file.mimetype === 'application/pdf';
    const base64 = req.file.buffer.toString('base64');
    const sisuBlokk = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64 } };
    const juhis = `Sa vaatad ühte kuluchekki või arvet. Vasta AINULT JSON-objektiga, ilma muu tekstita, koodiplokkideta:
{"kuupaev": "YYYY-MM-DD (tšeki/arve kuupäev)", "summa": <lõppsumma eurodes, number>, "selgitus": "lühike kirjeldus, mis on ostetud ja kust (nt 'Kütus - Circle K' või 'Toidukaubad - Rimi')"}
Kui mõnda välja ei leia, kasuta kuupaeva/selgituse jaoks tühja stringi ja summa jaoks 0.`;
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: [sisuBlokk, { type: 'text', text: juhis }] }]
      })
    });
    const data = await apiResp.json();
    if (!apiResp.ok) {
      console.error('Anthropic API viga:', data);
      return res.json({ ok: false, veateade: (data.error && data.error.message) || 'AI lugemine ebaõnnestus' });
    }
    const tekst = (data.content && data.content[0] && data.content[0].text) || '';
    let väljad;
    try {
      const vaste = tekst.match(/\{[\s\S]*\}/);
      väljad = JSON.parse(vaste ? vaste[0] : tekst);
    } catch (e) {
      return res.json({ ok: false, veateade: 'AI vastust ei õnnestunud lugeda' });
    }
    res.json({
      ok: true,
      kuupaev: väljad.kuupaev || '',
      summa: parseFloat(väljad.summa) || 0,
      selgitus: väljad.selgitus || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'AI lugemine ebaõnnestus: ' + err.message });
  }
});

// Muuda kulu koos fotoga
router.post('/kulu/:id/uuenda', noudaSisslogimist, upload.single('foto'), async (req, res) => {
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
      'SELECT * FROM projekti_kulud WHERE id=$1 AND worker_id=$2',
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
          { folder: 'royal-paigaldus/projektid', resource_type: 'image', quality: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(req.file.buffer);
      });
      foto_url = result.secure_url;
      foto_public_id = result.public_id;
    }
    await pool.query(
      'UPDATE projekti_kulud SET kuupaev=$1, summa=$2, selgitus=$3, foto_url=$4, foto_public_id=$5 WHERE id=$6',
      [kuupaev, s, selgitus, foto_url, foto_public_id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Muuda kulu (ilma fotota)
router.put('/kulu/:id', noudaSisslogimist, async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    const r = await pool.query(
      'SELECT * FROM projekti_kulud WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!r.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    await pool.query(
      'UPDATE projekti_kulud SET kuupaev=$1, summa=$2, selgitus=$3 WHERE id=$4',
      [kuupaev, s, selgitus, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kustuta kulu
router.delete('/kulu/:id', noudaSisslogimist, async (req, res) => {
  try {
    const kulu = await pool.query(
      'SELECT * FROM projekti_kulud WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!kulu.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    if (kulu.rows[0].foto_public_id) {
      try { await getCloudinary().uploader.destroy(kulu.rows[0].foto_public_id); } catch(e) {}
    }
    await pool.query('DELETE FROM projekti_kulud WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/:projektId/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    const lubatud = await omabLigipaasu(req.params.projektId, req.session.workerId);
    res.json({ ok: true, lubatud });
  } catch (err) {
    res.json({ ok: false, lubatud: false });
  }
});

// ── ADMIN ────────────────────────────────────────────────────────────

router.get('/admin/projektid', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM projektid ORDER BY jrk_nr, nimi`);
    res.json({ ok: true, projektid: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.post('/admin/projektid', noudaAdmin, async (req, res) => {
  const { nimi, ikoon, varv } = req.body;
  if (!nimi || !nimi.trim()) return res.json({ ok: false, veateade: 'Sisesta projekti nimi' });
  try {
    const jrk = await pool.query(`SELECT COALESCE(MAX(jrk_nr),0)+1 as jrk FROM projektid`);
    const r = await pool.query(
      `INSERT INTO projektid (nimi, ikoon, varv, jrk_nr) VALUES ($1,$2,$3,$4) RETURNING id`,
      [nimi.trim(), ikoon || '📁', varv || '#7c3aed', jrk.rows[0].jrk]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.put('/admin/projektid/:id', noudaAdmin, async (req, res) => {
  const { nimi, ikoon, varv, aktiivne } = req.body;
  try {
    await pool.query(
      `UPDATE projektid SET nimi=COALESCE($1,nimi), ikoon=COALESCE($2,ikoon), varv=COALESCE($3,varv), aktiivne=COALESCE($4,aktiivne) WHERE id=$5`,
      [nimi || null, ikoon || null, varv || null, typeof aktiivne === 'boolean' ? aktiivne : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/admin/:projektId/kulud', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    let query = `SELECT k.*, w.nimi as worker_nimi
                 FROM projekti_kulud k
                 JOIN workers w ON k.worker_id = w.id
                 WHERE k.projekt_id = $1`;
    const params = [req.params.projektId];
    if (aasta && kuu) {
      query += ` AND EXTRACT(YEAR FROM k.kuupaev)=$2 AND EXTRACT(MONTH FROM k.kuupaev)=$3`;
      params.push(aasta, kuu);
    }
    query += ` ORDER BY k.kuupaev DESC, w.nimi`;
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/admin/:projektId/csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    const projekt = await pool.query(`SELECT nimi FROM projektid WHERE id=$1`, [req.params.projektId]);
    const projektiNimi = (projekt.rows[0] && projekt.rows[0].nimi) || 'projekt';
    let query = `SELECT k.kuupaev, w.nimi as worker_nimi, k.summa, k.selgitus, k.foto_url
                 FROM projekti_kulud k
                 JOIN workers w ON k.worker_id = w.id
                 WHERE k.projekt_id = $1`;
    const params = [req.params.projektId];
    if (aasta && kuu) {
      query += ` AND EXTRACT(YEAR FROM k.kuupaev)=$2 AND EXTRACT(MONTH FROM k.kuupaev)=$3`;
      params.push(aasta, kuu);
    }
    query += ` ORDER BY k.kuupaev, w.nimi`;
    const r = await pool.query(query, params);
    const kuuNimi = aasta && kuu ? `${aasta}_${String(kuu).padStart(2,'0')}` : 'koik';
    const failiNimi = projektiNimi.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}_kulud_${kuuNimi}.csv"`);
    let csv = '﻿';
    csv += 'Kuupäev,Töötaja,Summa,Selgitus,Foto\n';
    r.rows.forEach(row => {
      const kp = String(row.kuupaev).split('T')[0];
      const foto = row.foto_url || '';
      csv += `"${kp}","${row.worker_nimi}","${parseFloat(row.summa).toFixed(2)}","${row.selgitus}","${foto}"\n`;
    });
    res.send(csv);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/admin/:projektId/lubatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi,
       EXISTS(SELECT 1 FROM projekti_lubatud pl WHERE pl.projekt_id=$1 AND pl.worker_id=w.id) as lubatud
       FROM workers w WHERE w.aktiivne=true ORDER BY w.nimi`,
      [req.params.projektId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

router.post('/admin/:projektId/lubatud/:workerId', noudaAdmin, async (req, res) => {
  const { lubatud } = req.body;
  try {
    if (lubatud) {
      await pool.query(
        'INSERT INTO projekti_lubatud (projekt_id, worker_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.projektId, req.params.workerId]
      );
    } else {
      await pool.query('DELETE FROM projekti_lubatud WHERE projekt_id=$1 AND worker_id=$2', [req.params.projektId, req.params.workerId]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
