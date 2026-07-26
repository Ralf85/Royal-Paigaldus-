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
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// Admin pääseb alati ligi; töötaja peab olema eraldi lubatud (xseeria_lubatud)
async function noudaLubatud(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  try {
    const r = await pool.query('SELECT 1 FROM xseeria_lubatud WHERE worker_id=$1', [req.session.workerId]);
    if (!r.rows.length) return res.status(403).json({ ok: false, veateade: 'Sul pole X-seeria ligipääsu' });
    next();
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
}

function kirjutajaNimi(req) {
  return req.session.isAdmin ? 'Admin' : req.session.workerNimi;
}

// Töötaja: kas mul on X-seeria ligipääs?
router.get('/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 FROM xseeria_lubatud WHERE worker_id=$1', [req.session.workerId]);
    res.json({ ok: true, lubatud: r.rows.length > 0 });
  } catch (err) {
    res.json({ ok: false, lubatud: false });
  }
});

// ---------- WORKER + ADMIN: drill-down Võistlus → Park → Korv ----------

// Kõik võistlused (töötaja valib ise, mitte automaatne "aktiivne")
router.get('/events', noudaLubatud, async (req, res) => {
  const r = await pool.query('SELECT * FROM xseeria_events ORDER BY aktiivne DESC, kuupaev DESC');
  res.json({ ok: true, events: r.rows });
});

router.get('/event/:eventId/asukohad', noudaLubatud, async (req, res) => {
  const ev = await pool.query('SELECT * FROM xseeria_events WHERE id=$1', [req.params.eventId]);
  if (!ev.rows.length) return res.json({ ok: false, veateade: 'Võistlust ei leitud' });
  const asukohad = await pool.query(
    `SELECT a.id, a.event_id, a.nimi, a.korvide_arv, a.viskekohtade_arv, a.jrk_nr,
       a.markused, a.foto_url, a.foto_public_id, a.loodud,
       COUNT(k.id)::int AS korvide_koguarv,
       COUNT(CASE WHEN k.paigaldus_staatus='tehtud' THEN 1 END)::int AS paigaldatud_arv,
       COUNT(CASE WHEN k.puhastus_staatus='tehtud' THEN 1 END)::int AS puhastatud_arv,
       MIN(k.number::int) AS min_nr,
       MAX(k.number::int) AS max_nr
     FROM xseeria_asukohad a
     LEFT JOIN xseeria_korvid k ON k.asukoht_id = a.id
     WHERE a.event_id = $1
     GROUP BY a.id, a.event_id, a.nimi, a.korvide_arv, a.viskekohtade_arv, a.jrk_nr,
       a.markused, a.foto_url, a.foto_public_id, a.loodud
     ORDER BY a.jrk_nr, a.nimi`,
    [req.params.eventId]
  );
  res.json({ ok: true, event: ev.rows[0], asukohad: asukohad.rows });
});

router.get('/asukoht/:asukohtId/korvid', noudaLubatud, async (req, res) => {
  const asukoht = await pool.query('SELECT * FROM xseeria_asukohad WHERE id=$1', [req.params.asukohtId]);
  if (!asukoht.rows.length) return res.json({ ok: false, veateade: 'Punkti ei leitud' });
  const korvid = await pool.query(
    'SELECT * FROM xseeria_korvid WHERE asukoht_id=$1 ORDER BY jrk_nr, number::int',
    [req.params.asukohtId]
  );
  res.json({ ok: true, asukoht: asukoht.rows[0], korvid: korvid.rows });
});

router.post('/korvid/:id/paigaldatud', noudaLubatud, async (req, res) => {
  await pool.query(
    `UPDATE xseeria_korvid SET paigaldus_staatus='tehtud', paigaldas_id=$1, paigaldas_nimi=$2, paigaldatud_kell=NOW() WHERE id=$3`,
    [req.session.workerId || null, kirjutajaNimi(req), req.params.id]
  );
  res.json({ ok: true });
});

router.post('/korvid/:id/paigaldus-tagasi', noudaLubatud, async (req, res) => {
  await pool.query(
    `UPDATE xseeria_korvid SET paigaldus_staatus='ootel', paigaldas_id=NULL, paigaldas_nimi=NULL, paigaldatud_kell=NULL WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

router.post('/korvid/:id/puhas', noudaLubatud, async (req, res) => {
  await pool.query(
    `UPDATE xseeria_korvid SET puhastus_staatus='tehtud', puhastas_id=$1, puhastas_nimi=$2, puhastatud_kell=NOW() WHERE id=$3`,
    [req.session.workerId || null, kirjutajaNimi(req), req.params.id]
  );
  res.json({ ok: true });
});

router.post('/korvid/:id/puhastus-tagasi', noudaLubatud, async (req, res) => {
  await pool.query(
    `UPDATE xseeria_korvid SET puhastus_staatus='ootel', puhastas_id=NULL, puhastas_nimi=NULL, puhastatud_kell=NULL WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

// Rajakaart — üks foto ÜKSIKU raja (korvi) kohta — üleslaadimine/asendamine
router.post('/korvid/:id/rajakaart', noudaLubatud, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Pilti ei leitud' });
  try {
    const vana = await pool.query('SELECT foto_public_id FROM xseeria_korvid WHERE id=$1', [req.params.id]);
    if (!vana.rows.length) return res.json({ ok: false, veateade: 'Rada ei leitud' });
    if (vana.rows[0].foto_public_id) {
      try { await getCloudinary().uploader.destroy(vana.rows[0].foto_public_id); } catch (e) {}
    }
    const result = await new Promise((resolve, reject) => {
      const stream = getCloudinary().uploader.upload_stream(
        { folder: 'royal-paigaldus/xseeria', resource_type: 'image', quality: 'auto' },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });
    await pool.query('UPDATE xseeria_korvid SET foto_url=$1, foto_public_id=$2 WHERE id=$3', [result.secure_url, result.public_id, req.params.id]);
    res.json({ ok: true, foto_url: result.secure_url });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ---------- ADMIN: võistlused ----------

router.get('/admin/events', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT * FROM xseeria_events ORDER BY kuupaev DESC');
  res.json({ ok: true, events: r.rows });
});

router.post('/admin/events', noudaAdmin, async (req, res) => {
  const { nimi, kuupaev, hooaeg } = req.body;
  if (!nimi || !kuupaev) return res.json({ ok: false, veateade: 'Nimi ja kuupäev on kohustuslikud' });
  await pool.query('UPDATE xseeria_events SET aktiivne = false');
  const r = await pool.query(
    'INSERT INTO xseeria_events (nimi, kuupaev, hooaeg, aktiivne) VALUES ($1,$2,$3,true) RETURNING *',
    [nimi, kuupaev, hooaeg || 'suvi']
  );
  res.json({ ok: true, event: r.rows[0] });
});

router.post('/admin/events/:id/aktiveeri', noudaAdmin, async (req, res) => {
  await pool.query('UPDATE xseeria_events SET aktiivne = false');
  await pool.query('UPDATE xseeria_events SET aktiivne = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.put('/admin/events/:id', noudaAdmin, async (req, res) => {
  const { nimi, kuupaev, hooaeg } = req.body;
  if (!nimi || !kuupaev) return res.json({ ok: false, veateade: 'Nimi ja kuupäev on kohustuslikud' });
  await pool.query('UPDATE xseeria_events SET nimi=$1, kuupaev=$2, hooaeg=$3 WHERE id=$4', [nimi, kuupaev, hooaeg || 'suvi', req.params.id]);
  res.json({ ok: true });
});

router.delete('/admin/events/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM xseeria_events WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- ADMIN: pargid (asukohad) — otse võistluse alla, ilma vahetasemeta ----------

// Kiirlisamine: "Nimi, korvide arv, viskekohtade arv" — korvide numbrid jätkuvad
// automaatselt terve võistluse peale (nt kui Annakanalil oli 1-13, siis järgmine park saab 14st edasi)
router.post('/admin/asukohad/bulk', noudaAdmin, async (req, res) => {
  const { event_id, tekst } = req.body;
  if (!event_id || !tekst) return res.json({ ok: false, veateade: 'event_id ja tekst on kohustuslikud' });
  const ev = await pool.query('SELECT * FROM xseeria_events WHERE id=$1', [event_id]);
  if (!ev.rows.length) return res.json({ ok: false, veateade: 'Võistlust ei leitud' });

  const read = tekst.split('\n').map((l) => l.trim()).filter(Boolean);
  const maxRow = await pool.query('SELECT COALESCE(MAX(jrk_nr),0) AS m FROM xseeria_asukohad WHERE event_id=$1', [event_id]);
  let jrk = maxRow.rows[0].m;

  const maxKorv = await pool.query(
    `SELECT COALESCE(MAX(k.number::int), 0) AS m
     FROM xseeria_korvid k
     JOIN xseeria_asukohad a ON a.id = k.asukoht_id
     WHERE a.event_id = $1`,
    [event_id]
  );
  let jooksevNr = maxKorv.rows[0].m;

  const lisatud = [];
  for (const line of read) {
    const parts = line.split(',').map((p) => p.trim());
    const nimi = parts[0];
    if (!nimi) continue;
    const korvid = parseInt(parts[1], 10) || 0;
    const viske = parseInt(parts[2], 10) || 0;
    jrk++;
    const r = await pool.query(
      'INSERT INTO xseeria_asukohad (event_id, nimi, korvide_arv, viskekohtade_arv, jrk_nr) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [event_id, nimi, korvid, viske, jrk]
    );
    const asukohtId = r.rows[0].id;
    for (let i = 1; i <= korvid; i++) {
      jooksevNr++;
      await pool.query('INSERT INTO xseeria_korvid (asukoht_id, number, jrk_nr) VALUES ($1,$2,$3)', [asukohtId, String(jooksevNr), i]);
    }
    lisatud.push(r.rows[0]);
  }
  res.json({ ok: true, lisatud });
});

// Kattuvuse kontroll: kas mõni neist numbritest on selles võistluses juba kasutusel (valikuliselt välja arvatud üks asukoht - muutmise puhul)
async function leiaKattuvusedEventis(eventId, algus, lopp, valjaArvatudAsukohtId) {
  const params = [eventId, algus, lopp];
  let query = `
    SELECT k.number, a.nimi
    FROM xseeria_korvid k
    JOIN xseeria_asukohad a ON a.id = k.asukoht_id
    WHERE a.event_id = $1 AND k.number::int BETWEEN $2 AND $3
  `;
  if (valjaArvatudAsukohtId) {
    query += ' AND a.id != $4';
    params.push(valjaArvatudAsukohtId);
  }
  const r = await pool.query(query, params);
  return r.rows;
}

// Lisa üks park käsitsi valitud rajanumbrite vahemikuga (dropdown 1-150)
router.post('/admin/asukohad', noudaAdmin, async (req, res) => {
  const { event_id, nimi, algus_nr, lopp_nr, viskekohtade_arv } = req.body;
  const algus = parseInt(algus_nr, 10);
  const lopp = parseInt(lopp_nr, 10);
  if (!event_id || !nimi || !algus || !lopp) return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  if (lopp < algus) return res.json({ ok: false, veateade: 'Lõppnumber peab olema ≥ algusnumber' });

  const kattuvused = await leiaKattuvusedEventis(event_id, algus, lopp, null);
  if (kattuvused.length) {
    const nimed = [...new Set(kattuvused.map(k => k.nimi))].join(', ');
    return res.json({ ok: false, veateade: `Rajanumbrid on juba kasutusel (${nimed}): ${kattuvused.map(k=>k.number).join(', ')}` });
  }

  const maxRow = await pool.query('SELECT COALESCE(MAX(jrk_nr),0) AS m FROM xseeria_asukohad WHERE event_id=$1', [event_id]);
  const jrk = maxRow.rows[0].m + 1;
  const korvideArv = lopp - algus + 1;
  const r = await pool.query(
    'INSERT INTO xseeria_asukohad (event_id, nimi, korvide_arv, viskekohtade_arv, jrk_nr) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [event_id, nimi, korvideArv, parseInt(viskekohtade_arv, 10) || 0, jrk]
  );
  const asukohtId = r.rows[0].id;
  let i = 1;
  for (let n = algus; n <= lopp; n++) {
    await pool.query('INSERT INTO xseeria_korvid (asukoht_id, number, jrk_nr) VALUES ($1,$2,$3)', [asukohtId, String(n), i]);
    i++;
  }
  res.json({ ok: true, asukoht: r.rows[0] });
});

router.put('/admin/asukohad/:id', noudaAdmin, async (req, res) => {
  const { nimi, markused } = req.body;
  await pool.query('UPDATE xseeria_asukohad SET nimi=$1, markused=$2 WHERE id=$3', [nimi, markused || null, req.params.id]);
  res.json({ ok: true });
});

// Muuda pargi nime ja/või rajanumbrite vahemikku (kirjutab üle olemasolevad korvid selle pargi all)
router.put('/admin/asukohad/:id/tapsed', noudaAdmin, async (req, res) => {
  const { nimi, algus_nr, lopp_nr, viskekohtade_arv } = req.body;
  const algus = parseInt(algus_nr, 10);
  const lopp = parseInt(lopp_nr, 10);
  if (!nimi || !algus || !lopp) return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  if (lopp < algus) return res.json({ ok: false, veateade: 'Lõppnumber peab olema ≥ algusnumber' });

  const asukoht = await pool.query('SELECT * FROM xseeria_asukohad WHERE id=$1', [req.params.id]);
  if (!asukoht.rows.length) return res.json({ ok: false, veateade: 'Parki ei leitud' });

  const kattuvused = await leiaKattuvusedEventis(asukoht.rows[0].event_id, algus, lopp, req.params.id);
  if (kattuvused.length) {
    const nimed = [...new Set(kattuvused.map(k => k.nimi))].join(', ');
    return res.json({ ok: false, veateade: `Rajanumbrid on juba kasutusel (${nimed}): ${kattuvused.map(k=>k.number).join(', ')}` });
  }

  const korvideArv = lopp - algus + 1;
  await pool.query('UPDATE xseeria_asukohad SET nimi=$1, korvide_arv=$2, viskekohtade_arv=$3 WHERE id=$4', [nimi, korvideArv, parseInt(viskekohtade_arv, 10) || 0, req.params.id]);
  await pool.query('DELETE FROM xseeria_korvid WHERE asukoht_id=$1', [req.params.id]);
  let i = 1;
  for (let n = algus; n <= lopp; n++) {
    await pool.query('INSERT INTO xseeria_korvid (asukoht_id, number, jrk_nr) VALUES ($1,$2,$3)', [req.params.id, String(n), i]);
    i++;
  }
  res.json({ ok: true });
});

router.delete('/admin/asukohad/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM xseeria_asukohad WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- ADMIN: töötajate ligipääs (nagu EDGF/Rally Estonia) ----------

router.get('/admin/lubatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi, (xl.worker_id IS NOT NULL) AS lubatud
       FROM workers w
       LEFT JOIN xseeria_lubatud xl ON xl.worker_id = w.id
       WHERE w.aktiivne = true
       ORDER BY w.nimi`
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
      await pool.query('INSERT INTO xseeria_lubatud (worker_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.params.workerId]);
    } else {
      await pool.query('DELETE FROM xseeria_lubatud WHERE worker_id=$1', [req.params.workerId]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
