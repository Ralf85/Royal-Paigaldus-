const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const crypto = require('crypto');
const archiver = require('archiver');
const https = require('https');
const http = require('http');

// ══════════════════════════════════════════════════════════════════════════
// LIDL LATVIA — eraldiseisev fotomoodul
//
// Miks eraldi tabelid (ja mitte kristo.js-i kopeerimine): Eesti Lidli vaade on ehitatud
// TÖÖKIRJETE peale — pood tuleb objektid-tabelist, pilt on tookirje_pildid kirje ja iga pilt
// eeldab töökirjet. Läti töötajad töökirjeid EI tee, seega poleks seal midagi, mille külge pilt
// siduda. Siin on oma poodide/projektide/piltide tabelid ja Eesti pool jääb täiesti puutumata.
//
// Sessioonid: Läti töötaja logib sisse tavalise töötaja PIN-iga (/tootaja) — seda haldab server.js.
// Läti ADMINIL on oma PIN ja oma sessioonitabel (lv_admin_sessions), mida kontrollime siinsamas,
// nii et server.js sessiooni-vahevara pole vaja muuta.
//
// Kasutajale nähtav tekst on inglise keeles (veateated kaasa arvatud) — kommentaarid eesti keeles.
// ══════════════════════════════════════════════════════════════════════════

const LV_ADMIN_SESSION_DAYS = 30;

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
    else cb(new Error('Image files only!'));
  }
});

// ── TABELID ───────────────────────────────────────────────────────────────
// Luuakse siin (mitte db.js-is), et moodul oleks iseseisev ja db.js puutumata.
// CREATE TABLE IF NOT EXISTS — turvaline igal käivitusel uuesti jooksutada.
async function initLatvia() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_stores (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20),
      name VARCHAR(200) NOT NULL,
      active BOOLEAN DEFAULT true,
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL UNIQUE,
      sort_nr INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_access (
      worker_id INTEGER PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_admins (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      pin VARCHAR(10) NOT NULL UNIQUE,
      active BOOLEAN DEFAULT true,
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_admin_sessions (
      id SERIAL PRIMARY KEY,
      token VARCHAR(100) NOT NULL UNIQUE,
      admin_id INTEGER REFERENCES lv_admins(id) ON DELETE CASCADE,
      name VARCHAR(100),
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lv_photos (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
      worker_name VARCHAR(100),
      store_id INTEGER REFERENCES lv_stores(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES lv_projects(id) ON DELETE SET NULL,
      work_date DATE NOT NULL DEFAULT CURRENT_DATE,
      url TEXT NOT NULL,
      public_id TEXT NOT NULL,
      file_name TEXT,
      created TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS lv_photos_store_idx ON lv_photos(store_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lv_photos_created_idx ON lv_photos(created);`);
  // Aegunud Läti admini sessioonide koristus, et tabel ei kasvaks lõputult
  await pool.query(`DELETE FROM lv_admin_sessions WHERE created < NOW() - INTERVAL '${LV_ADMIN_SESSION_DAYS} days'`);
}
initLatvia().catch(e => console.error('Latvia module init failed:', e.message));

// ── ÕIGUSED ───────────────────────────────────────────────────────────────

// Läti admini sessioon tuvastatakse sama x-session-token päise järgi, mille server.js
// juba req.sessionToken külge paneb — aga otsime selle OMA tabelist.
async function leiaLvAdmin(req) {
  const token = req.sessionToken || req.headers['x-session-token'] || req.query._token;
  if (!token) return null;
  try {
    const r = await pool.query(
      `SELECT s.admin_id, s.name FROM lv_admin_sessions s
       JOIN lv_admins a ON a.id = s.admin_id
       WHERE s.token = $1 AND a.active = true
         AND s.created > NOW() - INTERVAL '${LV_ADMIN_SESSION_DAYS} days'`,
      [token]
    );
    return r.rows.length ? { id: r.rows[0].admin_id, name: r.rows[0].name } : null;
  } catch (err) {
    return null;
  }
}

// Peaadmin (Royal Paigalduse admin) pääseb kõikjale ligi.
function onPeaadmin(req) {
  return !!(req.session && req.session.isAdmin);
}

// Läti admin VÕI peaadmin — haldusotspunktid
async function noudaLvAdmin(req, res, next) {
  if (onPeaadmin(req)) { req.lvAdmin = { id: null, name: 'Admin' }; return next(); }
  const lvAdmin = await leiaLvAdmin(req);
  if (!lvAdmin) return res.status(403).json({ ok: false, error: 'Latvia admin access required' });
  req.lvAdmin = lvAdmin;
  next();
}

// Läti töötaja (lv_access) VÕI Läti admin VÕI peaadmin — vaatamine ja galerii
async function noudaLvLigipaas(req, res, next) {
  if (onPeaadmin(req)) { req.lvAdmin = { id: null, name: 'Admin' }; return next(); }
  const lvAdmin = await leiaLvAdmin(req);
  if (lvAdmin) { req.lvAdmin = lvAdmin; return next(); }
  if (!req.session || !req.session.workerId) {
    return res.status(401).json({ ok: false, error: 'Please log in' });
  }
  try {
    const r = await pool.query('SELECT 1 FROM lv_access WHERE worker_id=$1', [req.session.workerId]);
    if (!r.rows.length) return res.status(403).json({ ok: false, error: 'No access to the Latvia module' });
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
}

// Ainult töötaja (piltide üleslaadimine — admin ei laadi pilte enda nimel üles)
async function noudaLvTootaja(req, res, next) {
  if (!req.session || !req.session.workerId) {
    return res.status(401).json({ ok: false, error: 'Please log in' });
  }
  try {
    const r = await pool.query('SELECT 1 FROM lv_access WHERE worker_id=$1', [req.session.workerId]);
    if (!r.rows.length && !onPeaadmin(req)) {
      return res.status(403).json({ ok: false, error: 'No access to the Latvia module' });
    }
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
}

// ── LÄTI ADMINI SISSELOGIMINE (oma PIN, oma sessioon) ─────────────────────

router.post('/admin-login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.json({ ok: false, error: 'Enter your PIN' });
  try {
    const r = await pool.query('SELECT * FROM lv_admins WHERE pin=$1 AND active=true', [pin]);
    if (!r.rows.length) return res.json({ ok: false, error: 'Wrong PIN' });
    const admin = r.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO lv_admin_sessions (token, admin_id, name) VALUES ($1,$2,$3)',
      [token, admin.id, admin.name]
    );
    res.json({ ok: true, token, name: admin.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/admin-logout', async (req, res) => {
  const token = req.sessionToken || req.headers['x-session-token'];
  try {
    if (token) await pool.query('DELETE FROM lv_admin_sessions WHERE token=$1', [token]);
  } catch (err) {}
  res.json({ ok: true });
});

// Kes ma olen? Kasutab nii töötaja kui admini leht, et otsustada, mida kuvada.
router.get('/session', async (req, res) => {
  if (onPeaadmin(req)) {
    return res.json({ ok: true, loggedIn: true, role: 'admin', name: 'Admin' });
  }
  const lvAdmin = await leiaLvAdmin(req);
  if (lvAdmin) {
    return res.json({ ok: true, loggedIn: true, role: 'lv_admin', name: lvAdmin.name });
  }
  if (req.session && req.session.workerId) {
    try {
      const r = await pool.query('SELECT 1 FROM lv_access WHERE worker_id=$1', [req.session.workerId]);
      return res.json({
        ok: true,
        loggedIn: true,
        role: r.rows.length ? 'worker' : 'none',
        name: req.session.workerNimi || '',
        allowed: r.rows.length > 0
      });
    } catch (err) {
      return res.json({ ok: true, loggedIn: true, role: 'none', allowed: false });
    }
  }
  res.json({ ok: true, loggedIn: false, role: 'none', allowed: false });
});

// Kas sisselogitud töötajal on Läti moodul lubatud? (tootaja.html kasutab plaadi kuvamiseks)
router.get('/check', async (req, res) => {
  if (!req.session || !req.session.workerId) return res.json({ ok: true, allowed: false });
  try {
    const r = await pool.query('SELECT 1 FROM lv_access WHERE worker_id=$1', [req.session.workerId]);
    res.json({ ok: true, allowed: r.rows.length > 0 });
  } catch (err) {
    res.json({ ok: true, allowed: false });
  }
});

// ── TÖÖTAJA: poed, projektid, üleslaadimine ───────────────────────────────

// Poodide sorteerimine numbri järgi (nagu Eesti vaates "600 - Raadiku"), tekstilised lõppu.
const STORE_ORDER = `ORDER BY NULLIF(regexp_replace(COALESCE(number,''), '^(\\d+).*$', '\\1'), COALESCE(number,''))::int NULLS LAST, number, name`;

router.get('/stores', noudaLvLigipaas, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, number, name FROM lv_stores WHERE active=true ${STORE_ORDER}`);
    res.json({ ok: true, stores: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/projects', noudaLvLigipaas, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM lv_projects WHERE active=true ORDER BY sort_nr, name');
    res.json({ ok: true, projects: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Piltide üleslaadimine — kuni 12 korraga, kohustuslik pood + projekt.
router.post('/photos', noudaLvTootaja, upload.array('photos', 12), async (req, res) => {
  const { store_id, project_id, work_date } = req.body;
  if (!store_id) return res.json({ ok: false, error: 'Please select a store' });
  if (!project_id) return res.json({ ok: false, error: 'Please select a project' });
  const files = req.files || [];
  if (!files.length) return res.json({ ok: false, error: 'No photos selected' });
  try {
    const store = await pool.query('SELECT number, name FROM lv_stores WHERE id=$1', [store_id]);
    if (!store.rows.length) return res.json({ ok: false, error: 'Store not found' });
    const project = await pool.query('SELECT name FROM lv_projects WHERE id=$1', [project_id]);
    if (!project.rows.length) return res.json({ ok: false, error: 'Project not found' });

    const kuupaev = (work_date && /^\d{4}-\d{2}-\d{2}$/.test(work_date))
      ? work_date
      : new Date().toISOString().slice(0, 10);

    // Cloudinary kaust: eraldi Eesti omast, et kogu Läti materjali saaks hiljem lihtsalt eraldada.
    const storeSlug = `${store.rows[0].number || ''}_${store.rows[0].name}`.replace(/[^a-zA-Z0-9]/g, '_');
    const folder = `royal-paigaldus/lidl-latvia/${storeSlug}/${kuupaev}`;

    const uploaded = [];
    for (const file of files) {
      const result = await new Promise((resolve, reject) => {
        const stream = getCloudinary().uploader.upload_stream(
          { folder, resource_type: 'image', quality: 'auto', fetch_format: 'auto' },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(file.buffer);
      });
      const r = await pool.query(
        `INSERT INTO lv_photos (worker_id, worker_name, store_id, project_id, work_date, url, public_id, file_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, url`,
        [
          req.session.workerId || null,
          req.session.workerNimi || null,
          store_id,
          project_id,
          kuupaev,
          result.secure_url,
          result.public_id,
          file.originalname || null
        ]
      );
      uploaded.push(r.rows[0]);
    }
    res.json({ ok: true, uploaded: uploaded.length, photos: uploaded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Upload failed: ' + err.message });
  }
});

// Töötaja enda viimased üleslaadimised (et ta näeks, mis läks korda)
router.get('/my-photos', noudaLvTootaja, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.url, p.work_date, s.number AS store_number, s.name AS store_name, pr.name AS project_name
       FROM lv_photos p
       LEFT JOIN lv_stores s ON s.id = p.store_id
       LEFT JOIN lv_projects pr ON pr.id = p.project_id
       WHERE p.worker_id = $1
       ORDER BY p.created DESC
       LIMIT 60`,
      [req.session.workerId]
    );
    res.json({ ok: true, photos: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Töötaja saab kustutada ainult OMA pildi (nt kogemata vale pilt) — teiste omi mitte.
router.delete('/my-photos/:id', noudaLvTootaja, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT public_id FROM lv_photos WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!r.rows.length) return res.json({ ok: false, error: 'Photo not found' });
    if (r.rows[0].public_id) {
      try { await getCloudinary().uploader.destroy(r.rows[0].public_id); } catch (e) {}
    }
    await pool.query('DELETE FROM lv_photos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── GALERII: Stores → Projects → Photos (+ Timeline) ──────────────────────
// Sama ülesehitus mis Eesti Lidli vaates, ainult oma tabelite peal.

router.get('/gallery/stores', noudaLvLigipaas, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.id AS store_id, s.number, s.name,
              COUNT(DISTINCT p.project_id) AS project_count,
              COUNT(p.id) AS photo_count,
              MAX(p.work_date) AS last_date
       FROM lv_stores s
       JOIN lv_photos p ON p.store_id = s.id
       GROUP BY s.id, s.number, s.name
       HAVING COUNT(p.id) > 0
       ${STORE_ORDER.replace('number, name', 's.number, s.name').replace(/COALESCE\(number,''\)/g, "COALESCE(s.number,'')")}`
    );
    res.json({ ok: true, stores: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/gallery/store/:storeId/projects', noudaLvLigipaas, async (req, res) => {
  try {
    const store = await pool.query('SELECT id, number, name FROM lv_stores WHERE id=$1', [req.params.storeId]);
    if (!store.rows.length) return res.json({ ok: false, error: 'Store not found' });
    const r = await pool.query(
      `SELECT COALESCE(pr.id, 0) AS project_id, COALESCE(pr.name, 'Unassigned') AS project_name,
              COUNT(p.id) AS photo_count, MAX(p.work_date) AS last_date
       FROM lv_photos p
       LEFT JOIN lv_projects pr ON pr.id = p.project_id
       WHERE p.store_id = $1
       GROUP BY COALESCE(pr.id, 0), COALESCE(pr.name, 'Unassigned')
       ORDER BY MAX(p.work_date) DESC`,
      [req.params.storeId]
    );
    res.json({ ok: true, store: store.rows[0], projects: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/gallery/store/:storeId/photos', noudaLvLigipaas, async (req, res) => {
  const { project_id } = req.query;
  try {
    let sql = `SELECT p.id, p.url, p.work_date, p.worker_name, pr.name AS project_name
               FROM lv_photos p
               LEFT JOIN lv_projects pr ON pr.id = p.project_id
               WHERE p.store_id = $1`;
    const params = [req.params.storeId];
    if (project_id) {
      if (String(project_id) === '0') {
        sql += ' AND p.project_id IS NULL';
      } else {
        params.push(project_id);
        sql += ` AND p.project_id = $${params.length}`;
      }
    }
    sql += ' ORDER BY p.work_date DESC, p.created DESC';
    const r = await pool.query(sql, params);
    res.json({ ok: true, photos: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Timeline — kõik viimased üleslaadimised ühes voos, grupeeritud pood+projekt+kuupäev kaupa.
// Sama mõte mis Eesti kronoloogial: "mis eile tehti ja kus käidi", ilma poodide kaupa kaevamata.
router.get('/gallery/timeline', noudaLvLigipaas, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.store_id, s.number AS store_number, s.name AS store_name,
              COALESCE(pr.name, 'Unassigned') AS project_name,
              COALESCE(pr.id, 0) AS project_id,
              p.work_date, p.worker_name,
              COUNT(p.id) AS photo_count,
              MAX(p.created) AS last_upload,
              json_agg(json_build_object('id', p.id, 'url', p.url) ORDER BY p.created) AS photos
       FROM lv_photos p
       LEFT JOIN lv_stores s ON s.id = p.store_id
       LEFT JOIN lv_projects pr ON pr.id = p.project_id
       GROUP BY p.store_id, s.number, s.name, COALESCE(pr.name, 'Unassigned'), COALESCE(pr.id, 0), p.work_date, p.worker_name
       ORDER BY MAX(p.created) DESC
       LIMIT 80`
    );
    res.json({ ok: true, entries: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ZIP allalaadimine — kogu poe pildid või ühe projekti omad
router.get('/gallery/zip/:storeId', noudaLvLigipaas, async (req, res) => {
  const { project_id } = req.query;
  try {
    let sql = `SELECT p.url, p.file_name, p.work_date, p.worker_name
               FROM lv_photos p
               WHERE p.store_id = $1`;
    const params = [req.params.storeId];
    if (project_id && String(project_id) !== '0') {
      params.push(project_id);
      sql += ` AND p.project_id = $${params.length}`;
    }
    sql += ' ORDER BY p.work_date, p.created';
    const photos = await pool.query(sql, params);
    if (!photos.rows.length) return res.status(404).json({ ok: false, error: 'No photos found' });

    const store = await pool.query('SELECT number, name FROM lv_stores WHERE id=$1', [req.params.storeId]);
    const storeName = `${store.rows[0]?.number || ''}_${store.rows[0]?.name || 'store'}`.replace(/[^a-zA-Z0-9]/g, '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${storeName}_photos.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    let nr = 0;
    for (const photo of photos.rows) {
      nr++;
      const date = String(photo.work_date).split('T')[0];
      const fileName = `${date}_${nr}_${photo.file_name || 'photo.jpg'}`.replace(/[^a-zA-Z0-9-_.]/g, '_');
      await new Promise((resolve, reject) => {
        const u = new URL(photo.url);
        const proto = u.protocol === 'https:' ? https : http;
        proto.get(photo.url, (imgRes) => {
          archive.append(imgRes, { name: fileName });
          imgRes.on('end', resolve);
          imgRes.on('error', reject);
        }).on('error', reject);
      });
    }
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── LÄTI ADMIN: töötajate ligipääs ────────────────────────────────────────
// TÄHTIS: Läti admin EI näe Royal Paigalduse Eesti töötajate nimekirja — ta näeb ainult
// neid töötajaid, kes on juba Läti moodulisse lisatud, ja saab ise uusi juurde luua.
// Peaadmin näeb kõiki ja saab soovi korral ka mõne olemasoleva Eesti töötaja siia lubada.

router.get('/admin/workers', noudaLvAdmin, async (req, res) => {
  const koikNahtavad = onPeaadmin(req);
  try {
    const sql = koikNahtavad
      ? `SELECT w.id, w.nimi AS name, w.pin, (a.worker_id IS NOT NULL) AS allowed
         FROM workers w
         LEFT JOIN lv_access a ON a.worker_id = w.id
         WHERE w.aktiivne = true AND COALESCE(w.arhiveeritud, false) = false
         ORDER BY w.nimi`
      : `SELECT w.id, w.nimi AS name, w.pin, true AS allowed
         FROM workers w
         JOIN lv_access a ON a.worker_id = w.id
         WHERE COALESCE(w.arhiveeritud, false) = false
         ORDER BY w.nimi`;
    const r = await pool.query(sql);
    res.json({ ok: true, workers: r.rows, canSeeAll: koikNahtavad });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Uue Läti töötaja loomine — nimi + PIN. Töötaja tekib workers tabelisse (sama PIN-iga logib
// ta /tootaja lehele sisse) ja saab kohe Läti mooduli ligipääsu. Ühtegi Eesti ettevõtet talle
// ei määrata, seega näeb ta ingliskeelset vaadet ainult fotode üleslaadimisega.
router.post('/admin/workers-new', noudaLvAdmin, async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Enter a name' });
  if (!pin || !String(pin).trim()) return res.json({ ok: false, error: 'Enter a PIN' });
  try {
    const r = await pool.query(
      'INSERT INTO workers (nimi, pin, aktiivne) VALUES ($1,$2,true) RETURNING id',
      [name.trim(), String(pin).trim()]
    );
    await pool.query('INSERT INTO lv_access (worker_id) VALUES ($1) ON CONFLICT DO NOTHING', [r.rows[0].id]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This PIN is already in use' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Nime/PIN-i muutmine — Läti admin saab muuta ainult neid, kes on Läti moodulis.
router.put('/admin/workers-new/:id', noudaLvAdmin, async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Enter a name' });
  if (!pin || !String(pin).trim()) return res.json({ ok: false, error: 'Enter a PIN' });
  try {
    if (!onPeaadmin(req)) {
      const lubatud = await pool.query('SELECT 1 FROM lv_access WHERE worker_id=$1', [req.params.id]);
      if (!lubatud.rows.length) return res.status(403).json({ ok: false, error: 'This worker is not in the Latvia module' });
    }
    await pool.query('UPDATE workers SET nimi=$1, pin=$2 WHERE id=$3', [name.trim(), String(pin).trim(), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This PIN is already in use' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/admin/workers/:workerId', noudaLvAdmin, async (req, res) => {
  const { allowed } = req.body;
  try {
    // Läti admin tohib ligipääsu ainult ÄRA võtta (oma nimekirjast eemaldada) — uue töötaja
    // lisamine käib tal läbi workers-new, mitte Eesti töötajate nimekirjast valides.
    if (allowed && !onPeaadmin(req)) {
      return res.status(403).json({ ok: false, error: 'Use "Add worker" to add someone to the module' });
    }
    if (allowed) {
      await pool.query('INSERT INTO lv_access (worker_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.params.workerId]);
    } else {
      await pool.query('DELETE FROM lv_access WHERE worker_id=$1', [req.params.workerId]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── LÄTI ADMIN: projektid ─────────────────────────────────────────────────

router.get('/admin/projects', noudaLvAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pr.*, (SELECT COUNT(*) FROM lv_photos p WHERE p.project_id = pr.id) AS photo_count
       FROM lv_projects pr ORDER BY pr.sort_nr, pr.name`
    );
    res.json({ ok: true, projects: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/admin/projects', noudaLvAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Enter a project name' });
  try {
    const jrk = await pool.query('SELECT COALESCE(MAX(sort_nr),0)+1 AS nr FROM lv_projects');
    const r = await pool.query(
      'INSERT INTO lv_projects (name, sort_nr) VALUES ($1,$2) RETURNING id',
      [name.trim(), jrk.rows[0].nr]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This project already exists' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.put('/admin/projects/:id', noudaLvAdmin, async (req, res) => {
  const { name, active } = req.body;
  try {
    await pool.query(
      'UPDATE lv_projects SET name=COALESCE($1,name), active=COALESCE($2,active) WHERE id=$3',
      [name ? name.trim() : null, typeof active === 'boolean' ? active : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This project already exists' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Projekti saab kustutada ainult siis, kui selle all pole pilte — muidu kaoks ajalugu.
router.delete('/admin/projects/:id', noudaLvAdmin, async (req, res) => {
  try {
    const kasutusel = await pool.query('SELECT 1 FROM lv_photos WHERE project_id=$1 LIMIT 1', [req.params.id]);
    if (kasutusel.rows.length) {
      return res.json({ ok: false, error: 'This project has photos — deactivate it instead of deleting' });
    }
    await pool.query('DELETE FROM lv_projects WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── LÄTI ADMIN: poed ──────────────────────────────────────────────────────

router.get('/admin/stores', noudaLvAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM lv_photos p WHERE p.store_id = s.id) AS photo_count
       FROM lv_stores s ${STORE_ORDER.replace('number, name', 's.number, s.name').replace(/COALESCE\(number,''\)/g, "COALESCE(s.number,'')")}`
    );
    res.json({ ok: true, stores: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/admin/stores', noudaLvAdmin, async (req, res) => {
  const { number, name } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Enter a store name' });
  try {
    const r = await pool.query(
      'INSERT INTO lv_stores (number, name) VALUES ($1,$2) RETURNING id',
      [(number || '').trim() || null, name.trim()]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Mitme poe lisamine korraga: üks rida = "number, name" (nt "1201, Rīga Purvciems")
router.post('/admin/stores/bulk', noudaLvAdmin, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.json({ ok: false, error: 'Nothing to add' });
  try {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      let number = null, name = null;
      if (parts.length >= 2) { number = parts[0]; name = parts.slice(1).join(', '); }
      else {
        // Kui koma puudub, proovime kujust "1201 Rīga Purvciems" numbri ise eraldada
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (m) { number = m[1]; name = m[2]; } else { name = line; }
      }
      if (!name) continue;
      await pool.query('INSERT INTO lv_stores (number, name) VALUES ($1,$2)', [number, name]);
      added++;
    }
    res.json({ ok: true, added });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.put('/admin/stores/:id', noudaLvAdmin, async (req, res) => {
  const { number, name, active } = req.body;
  try {
    await pool.query(
      'UPDATE lv_stores SET number=COALESCE($1,number), name=COALESCE($2,name), active=COALESCE($3,active) WHERE id=$4',
      [number !== undefined ? (number || null) : null, name ? name.trim() : null, typeof active === 'boolean' ? active : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.delete('/admin/stores/:id', noudaLvAdmin, async (req, res) => {
  try {
    const kasutusel = await pool.query('SELECT 1 FROM lv_photos WHERE store_id=$1 LIMIT 1', [req.params.id]);
    if (kasutusel.rows.length) {
      return res.json({ ok: false, error: 'This store has photos — deactivate it instead of deleting' });
    }
    await pool.query('DELETE FROM lv_stores WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── LÄTI ADMIN: piltide kustutamine galeriist ─────────────────────────────

router.delete('/admin/photos/:id', noudaLvAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT public_id FROM lv_photos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.json({ ok: false, error: 'Photo not found' });
    if (r.rows[0].public_id) {
      try { await getCloudinary().uploader.destroy(r.rows[0].public_id); } catch (e) {}
    }
    await pool.query('DELETE FROM lv_photos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── PEAADMIN: Läti adminide (PIN-ide) haldus ──────────────────────────────
// Ainult Royal Paigalduse peaadmin — Läti admin ise oma kolleege juurde luua ei saa.

function noudaPeaadmin(req, res, next) {
  if (!onPeaadmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
  next();
}

router.get('/admin/lv-admins', noudaPeaadmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, pin, active FROM lv_admins ORDER BY name');
    res.json({ ok: true, admins: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/admin/lv-admins', noudaPeaadmin, async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Enter a name' });
  if (!pin || !String(pin).trim()) return res.json({ ok: false, error: 'Enter a PIN' });
  try {
    const r = await pool.query(
      'INSERT INTO lv_admins (name, pin) VALUES ($1,$2) RETURNING id',
      [name.trim(), String(pin).trim()]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This PIN is already in use' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.put('/admin/lv-admins/:id', noudaPeaadmin, async (req, res) => {
  const { name, pin, active } = req.body;
  try {
    await pool.query(
      'UPDATE lv_admins SET name=COALESCE($1,name), pin=COALESCE($2,pin), active=COALESCE($3,active) WHERE id=$4',
      [name ? name.trim() : null, pin ? String(pin).trim() : null, typeof active === 'boolean' ? active : null, req.params.id]
    );
    // Deaktiveerimisel lõpetame ka kehtivad sessioonid
    if (active === false) await pool.query('DELETE FROM lv_admin_sessions WHERE admin_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, error: 'This PIN is already in use' });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.delete('/admin/lv-admins/:id', noudaPeaadmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM lv_admins WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
