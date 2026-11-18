const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { onKuupaev } = require('../csvabi');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { aiFailid, loeDokument } = require('../ailugeja');

// ══════════════════════════════════════════════════════════════════════════
// KAUBIK — sõidupäevik (Royal Paigalduse kaubik, mis sõidab enamasti Lidli sõite)
//
// Kuidas see töötab:
//  * Töötaja paneb päeva alguses kirja odomeetri näidu (või pildistab spidomeetri — AI loeb näidu ise)
//    ja päeva lõpus lõpunäidu. Läbitud km = lõpunäit − algnäit.
//  * Tulu = päevatasu (vaikimisi 80 €, iga päev kui kaubik sõitis — tundidest sõltumata)
//          + km × kilomeetrihind (vaikimisi 0,50 €/km). Hinnad on käibemaksuta ja muudetavad adminis.
//  * Ligipääs: ainult töötajad tabelis kaubik_lubatud. Algul ainult Ralf (testiks), teisi saab lisada
//    lehel /kaubik-admin.
//  * Lidli arvele: arve autotäitmine (routes/arved.js /autotaita) lisab kaubiku read AINULT siis, kui
//    adminis on "Lisa Lidli arvele" sisse lülitatud (vaikimisi VÄLJAS — testiandmed ei satu päris arvele).
//
// Tabelid luuakse siin (mitte db.js-is), et moodul oleks iseseisev — sama muster mis routes/remont.js.
// ══════════════════════════════════════════════════════════════════════════

const MAX_KM_PAEVAS = 1500; // suurem päevane läbisõit on peaaegu kindlasti valesti loetud/sisestatud näit

function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return cloudinary;
}

const uploadPilt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Ainult pildid!'));
  }
});

// ── TABELID ───────────────────────────────────────────────────────────────
let valmisLubadus = null;
function valmis() {
  if (!valmisLubadus) {
    valmisLubadus = looTabelid().catch((err) => { valmisLubadus = null; throw err; });
  }
  return valmisLubadus;
}

async function looTabelid() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kaubik_seaded (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      paevahind DECIMAL(10,2) NOT NULL DEFAULT 80,
      km_hind DECIMAL(10,3) NOT NULL DEFAULT 0.5,
      arvele BOOLEAN NOT NULL DEFAULT false,
      kaubiku_nimi VARCHAR(100) NOT NULL DEFAULT 'Kaubik',
      versioon INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kaubik_lubatud (
      worker_id INTEGER PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS kaubik_paevik (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
      kuupaev DATE NOT NULL,
      algus_km INTEGER NOT NULL,
      lopp_km INTEGER,
      algus_foto_url TEXT,
      algus_foto_id TEXT,
      lopp_foto_url TEXT,
      lopp_foto_id TEXT,
      markus VARCHAR(300),
      loodud TIMESTAMP DEFAULT NOW(),
      lopetatud TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS kaubik_paevik_kuupaev_idx ON kaubik_paevik (kuupaev);
  `);
  await pool.query(`INSERT INTO kaubik_seaded (id) VALUES (1) ON CONFLICT DO NOTHING`);
  const v = await pool.query(`SELECT versioon FROM kaubik_seaded WHERE id=1`);
  // Ühekordne (18.11.2026): moodul algul ainult Ralfile testimiseks.
  if (v.rows[0].versioon < 1) {
    await pool.query(
      `INSERT INTO kaubik_lubatud (worker_id)
       SELECT id FROM workers WHERE aktiivne=true AND nimi ILIKE 'Ralf%'
       ON CONFLICT DO NOTHING`
    );
    await pool.query(`UPDATE kaubik_seaded SET versioon=1 WHERE id=1`);
  }
}

router.use(async (req, res, next) => {
  try { await valmis(); next(); } catch (err) { next(err); }
});

// ── ABIFUNKTSIOONID ───────────────────────────────────────────────────────
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const puhas = (t, max) => String(t == null ? '' : t).replace(/[<>]/g, '').trim().slice(0, max);
function taisarv(v) {
  const s = String(v == null ? '' : v).replace(/[\s.,]/g, '');
  if (!/^\d{1,7}$/.test(s)) return NaN;
  return parseInt(s, 10);
}
async function seaded() {
  const r = await pool.query(`SELECT * FROM kaubik_seaded WHERE id=1`);
  const s = r.rows[0];
  return {
    paevahind: parseFloat(s.paevahind) || 0,
    km_hind: parseFloat(s.km_hind) || 0,
    arvele: !!s.arvele,
    kaubiku_nimi: s.kaubiku_nimi
  };
}

async function laePilt(fail) {
  const tulemus = await new Promise((resolve, reject) => {
    const stream = getCloudinary().uploader.upload_stream(
      { folder: 'royal-paigaldus/kaubik', resource_type: 'image', quality: 'auto' },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(fail.buffer);
  });
  return { url: tulemus.secure_url, id: tulemus.public_id };
}
async function kustutaPilt(id) {
  if (!id) return;
  try { await getCloudinary().uploader.destroy(id, { resource_type: 'image' }); } catch (e) {}
}

// Viimane teadaolev odomeetri näit (suurim sisestatud näit) — uus algnäit ei tohi olla sellest väiksem.
async function viimaneNait(valjaArvatudId) {
  const r = await pool.query(
    `SELECT MAX(GREATEST(algus_km, COALESCE(lopp_km, 0))) AS nait FROM kaubik_paevik WHERE ($1::int IS NULL OR id <> $1)`,
    [valjaArvatudId || null]
  );
  return r.rows[0].nait === null ? null : parseInt(r.rows[0].nait, 10);
}

function reaVorm(x) {
  const km = x.lopp_km === null ? null : x.lopp_km - x.algus_km;
  return {
    id: x.id, kuupaev: x.kuupaev, worker_id: x.worker_id, tootaja: x.tootaja || null,
    algus_km: x.algus_km, lopp_km: x.lopp_km, km,
    algus_foto: x.algus_foto_url, lopp_foto: x.lopp_foto_url, markus: x.markus || '',
    lahti: x.lopp_km === null
  };
}

// Kokkuvõte perioodi kohta: päevatasu läheb iga erineva kuupäeva kohta, kus kaubik sõitis (lõpetatud sõit).
function kokkuvote(read, s) {
  const lopetatud = read.filter(x => x.lopp_km !== null);
  const paevad = new Set(lopetatud.map(x => x.kuupaev)).size;
  const km = lopetatud.reduce((sum, x) => sum + (x.lopp_km - x.algus_km), 0);
  const paevaTulu = r2(paevad * s.paevahind);
  const kmTulu = r2(km * s.km_hind);
  return { paevad, km, paeva_tulu: paevaTulu, km_tulu: kmTulu, kokku: r2(paevaTulu + kmTulu) };
}

// ── LIGIPÄÄS ──────────────────────────────────────────────────────────────
async function onLubatud(workerId) {
  if (!workerId) return false;
  const r = await pool.query(
    `SELECT 1 FROM kaubik_lubatud l JOIN workers w ON w.id = l.worker_id WHERE l.worker_id=$1 AND w.aktiivne=true`,
    [workerId]
  );
  return r.rows.length > 0;
}
async function noudaTootajat(req, res, next) {
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  if (!(await onLubatud(req.session.workerId))) return res.status(403).json({ ok: false, veateade: 'Sul pole kaubiku sõidupäeviku ligipääsu.' });
  next();
}
function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// AI lugemine maksab — piir 30 pilti töötaja kohta päevas.
const aiLugemised = new Map();
function aiLimiitTais(workerId) {
  const paev = new Date().toISOString().slice(0, 10);
  const v = aiLugemised.get(workerId);
  if (!v || v.paev !== paev) { aiLugemised.set(workerId, { paev, arv: 1 }); return false; }
  v.arv++;
  return v.arv > 30;
}

const ODOMEETRI_JUHIS = `Pildil on sõiduki (kaubiku) armatuurlaud / spidomeeter.
Leia ODOMEETRI ehk KOGULÄBISÕIDU näit kilomeetrites (sõiduki kogu läbisõit, tavaliselt 5–7 numbrit, nt 184532 km).
ÄRA loe päevaläbisõitu ehk trip-meetrit (TRIP, TRIP A, TRIP B — tavaliselt komakohaga, nt 123.4), kiirust, pöördeid, temperatuuri ega kütusetaset.
Loe iga number märk-märgilt. Kui näit pole selgelt loetav, pane "nait": null.
Vasta AINULT JSON-objektiga, ilma muu tekstita:
{"nait": <täisarv või null>, "kindel": <true kui number on selgelt loetav, muidu false>, "markus": "<lühike selgitus eesti keeles, kui midagi on ebaselge>"}`;

// ── TÖÖTAJA ───────────────────────────────────────────────────────────────
router.get('/kontroll', async (req, res) => {
  res.json({ ok: true, lubatud: await onLubatud(req.session && req.session.workerId) });
});

// Töötaja vaade: lahtine sõit (kui on), viimane näit ja viimased sõidud.
router.get('/minu', noudaTootajat, async (req, res) => {
  const s = await seaded();
  const lahtine = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 AND p.lopp_km IS NULL ORDER BY p.loodud DESC LIMIT 1`,
    [req.session.workerId]
  );
  const viimased = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 ORDER BY p.kuupaev DESC, p.id DESC LIMIT 40`,
    [req.session.workerId]
  );
  // Selle kuu kokkuvõte (töötaja enda sõidud)
  const kuu = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 AND date_trunc('month', p.kuupaev) = date_trunc('month', CURRENT_DATE)`,
    [req.session.workerId]
  );
  res.json({
    ok: true,
    seaded: { paevahind: s.paevahind, km_hind: s.km_hind, kaubiku_nimi: s.kaubiku_nimi },
    lahtine: lahtine.rows.length ? reaVorm(lahtine.rows[0]) : null,
    viimane_nait: await viimaneNait(),
    soidud: viimased.rows.map(reaVorm),
    kuu: kokkuvote(kuu.rows, s)
  });
});

// AI loeb spidomeetri pildilt odomeetri näidu. Ei salvesta midagi — töötaja kinnitab numbri ise.
router.post('/loe', noudaTootajat, aiFailid(uploadPilt), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Pilti ei leitud' });
  if (aiLimiitTais(req.session.workerId)) return res.json({ ok: false, veateade: 'Tänane AI lugemiste piir on täis — sisesta näit käsitsi.' });
  const t = await loeDokument(req, ODOMEETRI_JUHIS, { maxTokens: 300 });
  if (!t.ok) return res.json(t);
  const nait = taisarv(t.valjad.nait);
  if (!Number.isFinite(nait)) {
    return res.json({ ok: false, veateade: 'Näitu ei õnnestunud pildilt lugeda' + (t.valjad.markus ? ' (' + puhas(t.valjad.markus, 150) + ')' : '') + ' — sisesta käsitsi.' });
  }
  res.json({ ok: true, nait, kindel: t.valjad.kindel !== false, markus: puhas(t.valjad.markus, 200) });
});

// Päeva algus: algnäit (+ valikuline spidomeetri foto).
router.post('/algus', noudaTootajat, uploadPilt.single('foto'), async (req, res) => {
  const b = req.body || {};
  const kuupaev = onKuupaev(b.kuupaev) ? b.kuupaev : null;
  if (!kuupaev) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  const nait = taisarv(b.nait);
  if (!Number.isFinite(nait) || nait <= 0) return res.json({ ok: false, veateade: 'Sisesta odomeetri näit (täisarv, km)' });
  const lahtine = await pool.query(`SELECT id FROM kaubik_paevik WHERE worker_id=$1 AND lopp_km IS NULL`, [req.session.workerId]);
  if (lahtine.rows.length) return res.json({ ok: false, veateade: 'Sul on eelmine sõit veel lõpetamata — sisesta enne selle lõpunäit.' });
  const eelmine = await viimaneNait();
  if (eelmine !== null && nait < eelmine) {
    return res.json({ ok: false, veateade: `Näit ${nait} km on väiksem kui viimane sisestatud näit (${eelmine} km). Kontrolli numbrit.` });
  }
  let foto = null;
  if (req.file) {
    try { foto = await laePilt(req.file); } catch (e) { return res.json({ ok: false, veateade: 'Pildi üleslaadimine ebaõnnestus — proovi uuesti või salvesta ilma pildita.' }); }
  }
  const r = await pool.query(
    `INSERT INTO kaubik_paevik (worker_id, kuupaev, algus_km, algus_foto_url, algus_foto_id, markus)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.session.workerId, kuupaev, nait, foto && foto.url, foto && foto.id, puhas(b.markus, 300) || null]
  );
  // Vahe eelmise lõpunäiduga (nt keegi sõitis kirja panemata) — hoiatus, mitte viga.
  const vahe = eelmine !== null ? nait - eelmine : 0;
  res.json({ ok: true, id: r.rows[0].id, hoiatus: vahe > 0 ? `NB: eelmise sõidu lõpust on ${vahe} km kirja panemata.` : null });
});

// Päeva lõpp: lõpunäit (+ valikuline foto).
router.post('/lopp/:id', noudaTootajat, uploadPilt.single('foto'), async (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10) || 0;
  const v = await pool.query(`SELECT * FROM kaubik_paevik WHERE id=$1 AND worker_id=$2`, [id, req.session.workerId]);
  if (!v.rows.length) return res.json({ ok: false, veateade: 'Sõitu ei leitud' });
  const k = v.rows[0];
  if (k.lopp_km !== null) return res.json({ ok: false, veateade: 'See sõit on juba lõpetatud' });
  const nait = taisarv(b.nait);
  if (!Number.isFinite(nait)) return res.json({ ok: false, veateade: 'Sisesta lõpunäit (täisarv, km)' });
  if (nait < k.algus_km) return res.json({ ok: false, veateade: `Lõpunäit ei saa olla väiksem kui algnäit (${k.algus_km} km)` });
  if (nait - k.algus_km > MAX_KM_PAEVAS && b.kinnitan !== '1') {
    return res.json({ ok: false, kinnita: true, veateade: `Läbisõit tuleks ${nait - k.algus_km} km — see on väga palju. Kontrolli näit üle.` });
  }
  let foto = null;
  if (req.file) {
    try { foto = await laePilt(req.file); } catch (e) { return res.json({ ok: false, veateade: 'Pildi üleslaadimine ebaõnnestus — proovi uuesti või salvesta ilma pildita.' }); }
  }
  const markus = puhas(b.markus, 300);
  await pool.query(
    `UPDATE kaubik_paevik SET lopp_km=$1, lopp_foto_url=$2, lopp_foto_id=$3, lopetatud=NOW(),
       markus = CASE WHEN $4::text <> '' THEN $4 ELSE markus END
     WHERE id=$5`,
    [nait, foto && foto.url, foto && foto.id, markus, id]
  );
  const s = await seaded();
  const km = nait - k.algus_km;
  res.json({ ok: true, km, tulu: r2(s.paevahind + km * s.km_hind) });
});

// Töötaja saab oma sõidu kustutada 24 h jooksul (nt vale näit).
router.delete('/soit/:id', noudaTootajat, async (req, res) => {
  const v = await pool.query(`SELECT * FROM kaubik_paevik WHERE id=$1 AND worker_id=$2`, [parseInt(req.params.id, 10) || 0, req.session.workerId]);
  if (!v.rows.length) return res.json({ ok: false, veateade: 'Sõitu ei leitud' });
  const k = v.rows[0];
  if (Date.now() - new Date(k.loodud).getTime() > 24 * 3600 * 1000) {
    return res.json({ ok: false, veateade: 'Seda sõitu ei saa enam kustutada — palun ütle Ralfile.' });
  }
  await kustutaPilt(k.algus_foto_id);
  await kustutaPilt(k.lopp_foto_id);
  await pool.query(`DELETE FROM kaubik_paevik WHERE id=$1`, [k.id]);
  res.json({ ok: true });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────
router.get('/admin/seaded', noudaAdmin, async (req, res) => {
  res.json({ ok: true, seaded: await seaded() });
});
router.post('/admin/seaded', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const paevahind = parseFloat(String(b.paevahind).replace(',', '.'));
  const kmHind = parseFloat(String(b.km_hind).replace(',', '.'));
  if (!Number.isFinite(paevahind) || paevahind < 0) return res.json({ ok: false, veateade: 'Vigane päevahind' });
  if (!Number.isFinite(kmHind) || kmHind < 0) return res.json({ ok: false, veateade: 'Vigane kilomeetrihind' });
  await pool.query(
    `UPDATE kaubik_seaded SET paevahind=$1, km_hind=$2, arvele=$3, kaubiku_nimi=$4 WHERE id=1`,
    [r2(paevahind), Math.round(kmHind * 1000) / 1000, !!b.arvele, puhas(b.kaubiku_nimi, 100) || 'Kaubik']
  );
  res.json({ ok: true, seaded: await seaded() });
});

router.get('/admin/lubatud', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT w.id, w.nimi, EXISTS(SELECT 1 FROM kaubik_lubatud l WHERE l.worker_id=w.id) AS lubatud
     FROM workers w WHERE w.aktiivne=true ORDER BY w.nimi`
  );
  res.json({ ok: true, tootajad: r.rows });
});
router.post('/admin/lubatud/:workerId', noudaAdmin, async (req, res) => {
  const id = parseInt(req.params.workerId, 10);
  if (!Number.isInteger(id)) return res.json({ ok: false, veateade: 'Töötajat ei leitud' });
  if ((req.body || {}).lubatud) await pool.query(`INSERT INTO kaubik_lubatud (worker_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
  else await pool.query(`DELETE FROM kaubik_lubatud WHERE worker_id=$1`, [id]);
  res.json({ ok: true });
});

async function perioodiRead(algus, lopp) {
  const r = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev, w.nimi AS tootaja
     FROM kaubik_paevik p LEFT JOIN workers w ON w.id = p.worker_id
     WHERE p.kuupaev BETWEEN $1 AND $2 ORDER BY p.kuupaev, p.id`,
    [algus, lopp]
  );
  return r.rows;
}

router.get('/admin/paevik', noudaAdmin, async (req, res) => {
  const { algus, lopp } = req.query;
  if (!onKuupaev(algus) || !onKuupaev(lopp)) return res.json({ ok: false, veateade: 'Vali periood' });
  const s = await seaded();
  const read = await perioodiRead(algus, lopp);
  res.json({ ok: true, seaded: s, read: read.map(reaVorm), kokku: kokkuvote(read, s), viimane_nait: await viimaneNait() });
});

// Admin saab näitu parandada (nt AI luges valesti).
router.put('/admin/soit/:id', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10) || 0;
  const algus = taisarv(b.algus_km);
  const lopp = (b.lopp_km === '' || b.lopp_km === null || b.lopp_km === undefined) ? null : taisarv(b.lopp_km);
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vigane kuupäev' });
  if (!Number.isFinite(algus)) return res.json({ ok: false, veateade: 'Vigane algnäit' });
  if (lopp !== null && (!Number.isFinite(lopp) || lopp < algus)) return res.json({ ok: false, veateade: 'Lõpunäit peab olema algnäidust suurem' });
  const r = await pool.query(
    `UPDATE kaubik_paevik SET kuupaev=$1, algus_km=$2, lopp_km=$3, markus=$4,
       lopetatud = CASE WHEN $3::int IS NULL THEN NULL ELSE COALESCE(lopetatud, NOW()) END
     WHERE id=$5`,
    [b.kuupaev, algus, lopp, puhas(b.markus, 300) || null, id]
  );
  if (!r.rowCount) return res.json({ ok: false, veateade: 'Sõitu ei leitud' });
  res.json({ ok: true });
});
router.delete('/admin/soit/:id', noudaAdmin, async (req, res) => {
  const v = await pool.query(`SELECT * FROM kaubik_paevik WHERE id=$1`, [parseInt(req.params.id, 10) || 0]);
  if (!v.rows.length) return res.json({ ok: false, veateade: 'Sõitu ei leitud' });
  await kustutaPilt(v.rows[0].algus_foto_id);
  await kustutaPilt(v.rows[0].lopp_foto_id);
  await pool.query(`DELETE FROM kaubik_paevik WHERE id=$1`, [v.rows[0].id]);
  res.json({ ok: true });
});

// Exceli eksport (sama stiil mis admini raportil: tumesinine pealkiri, punane päis, vahelduvad read, sinine KOKKU).
router.get('/admin/excel', noudaAdmin, async (req, res) => {
  const { algus, lopp } = req.query;
  if (!onKuupaev(algus) || !onKuupaev(lopp)) return res.status(400).send('Vali periood');
  const s = await seaded();
  const read = await perioodiRead(algus, lopp);
  const kv = kokkuvote(read, s);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sõidupäevik');
  const kp = (x) => { const o = String(x).split('-'); return o.length === 3 ? `${o[2]}.${o[1]}.${o[0]}` : x; };
  ws.columns = [
    { width: 13 }, { width: 18 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 30 }
  ];
  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = `${s.kaubiku_nimi} — sõidupäevik ${kp(algus)} – ${kp(lopp)}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  ws.getRow(1).height = 26;
  const pais = ws.getRow(3);
  pais.values = ['Kuupäev', 'Töötaja', 'Algnäit (km)', 'Lõpunäit (km)', 'Km', 'Päevatasu €', 'Km tasu €', 'Kokku €', 'Märkus'];
  pais.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  // Päevatasu näidatakse iga kuupäeva esimesel lõpetatud real (sama päeva mitu sõitu = üks päevatasu).
  const tasutudPaevad = new Set();
  let rida = 4;
  read.forEach((x, i) => {
    const km = x.lopp_km === null ? null : x.lopp_km - x.algus_km;
    let paevaTasu = 0;
    if (km !== null && !tasutudPaevad.has(x.kuupaev)) { tasutudPaevad.add(x.kuupaev); paevaTasu = s.paevahind; }
    const kmTasu = km === null ? 0 : r2(km * s.km_hind);
    const r = ws.getRow(rida++);
    r.values = [kp(x.kuupaev), x.tootaja || '', x.algus_km, x.lopp_km === null ? 'lõpetamata' : x.lopp_km, km === null ? '' : km,
      paevaTasu || '', km === null ? '' : kmTasu, km === null ? '' : r2(paevaTasu + kmTasu), x.markus || ''];
    if (i % 2 === 1) r.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; });
    [6, 7, 8].forEach(n => { r.getCell(n).numFmt = '#,##0.00'; });
  });
  const kok = ws.getRow(rida);
  kok.values = ['KOKKU', `${kv.paevad} päeva`, '', '', kv.km, kv.paeva_tulu, kv.km_tulu, kv.kokku, `Hinnad: ${s.paevahind} €/päev + ${s.km_hind} €/km (km-ta)`];
  kok.eachCell({ includeEmpty: true }, c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  });
  [6, 7, 8].forEach(n => { kok.getCell(n).numFmt = '#,##0.00'; });
  ws.autoFilter = { from: 'A3', to: `I${Math.max(3, rida - 1)}` };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="kaubik_${algus}_${lopp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── LIDLI ARVE: read arve autotäitmisele (kasutab routes/arved.js) ────────
// Tagastab tühja massiivi, kui "Lisa Lidli arvele" on adminis väljas või perioodil sõite pole.
async function arveRead(algus, lopp) {
  await valmis();
  const s = await seaded();
  if (!s.arvele) return [];
  const read = await perioodiRead(algus, lopp);
  const kv = kokkuvote(read, s);
  const tulem = [];
  if (kv.paevad > 0) tulem.push({ kirjeldus: `${s.kaubiku_nimi} rent`, kogus: kv.paevad, uhik: 'päev', hind: s.paevahind, summa: kv.paeva_tulu });
  if (kv.km > 0) tulem.push({ kirjeldus: `${s.kaubiku_nimi} läbisõit`, kogus: kv.km, uhik: 'km', hind: s.km_hind, summa: kv.km_tulu });
  return tulem;
}

module.exports = router;
module.exports.arveRead = arveRead;
