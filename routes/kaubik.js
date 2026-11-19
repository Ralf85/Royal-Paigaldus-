const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { onKuupaev } = require('../csvabi');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { aiFailid, loeDokument } = require('../ailugeja');

// ══════════════════════════════════════════════════════════════════════════
// KAUBIK — sõidupäevik (Royal Paigalduse kaubik)
//
// Kuidas see töötab:
//  * Töötaja valib sõidu alguses PROJEKTI (Lidl / Cramo / X-seeria / Isiklik) ja paneb kirja odomeetri
//    näidu (või pildistab spidomeetri — AI loeb näidu ise). Päeva lõpus lõpunäit. Km = lõpp − algus.
//  * Igal projektil on oma hinnad (tabel kaubik_hinnad): päevatasu + km × km-hind, käibemaksuta.
//    Lidl: 80 € + 0,50 €/km. Cramo, X-seeria, Isiklik: esialgu 0 € (näitu jälgitakse ikka).
//    Päevatasu läheb üks kord projekti ja kuupäeva kohta (sama päeva mitu sõitu = üks päevatasu).
//  * "Isiklik" sõidul kirjutatakse juhi nimi. Varem kasutatud nimed pakutakse ise ette (võetakse
//    varasematest sõitudest — eraldi nimekirja pole vaja).
//  * Admin saab sõite ka käsitsi lisada (/kaubik-admin): kuupäev või vahemik (iga päev = päevatasu),
//    km otse või odomeetri näidud, oma kaubik või RENDIKAUBIK (rendikaubiku näidud ei mõjuta oma kaubiku
//    näidu kontrolli). Läbisõit = lõpunäit − algnäit, kui näidud on olemas, muidu km_kasitsi.
//  * Ligipääs: ainult töötajad tabelis kaubik_lubatud. Algul ainult Ralf (testiks), teisi saab lisada
//    lehel /kaubik-admin.
//  * Lidli arvele: arve autotäitmine (routes/arved.js /autotaita) lisab AINULT Lidli projekti soidud ja
//    ainult siis, kui adminis on "Lisa Lidli arvele" sisse lülitatud (vaikimisi VÄLJAS).
//
// Tabelid luuakse siin (mitte db.js-is), et moodul oleks iseseisev — sama muster mis routes/remont.js.
// ══════════════════════════════════════════════════════════════════════════

const MAX_KM_PAEVAS = 1500; // suurem päevane läbisõit on peaaegu kindlasti valesti loetud/sisestatud näit

// Projektid, mille raames kaubik sõidab. Järjekord = järjekord liideses.
const PROJEKTID = [
  { kood: 'lidl', nimi: 'Lidl', paevahind: 80, km_hind: 0.5 },
  { kood: 'cramo', nimi: 'Cramo', paevahind: 0, km_hind: 0 },
  { kood: 'xseeria', nimi: 'X-seeria', paevahind: 0, km_hind: 0 },
  { kood: 'isiklik', nimi: 'Isiklik', paevahind: 0, km_hind: 0 }
];
const PROJEKTI_KOODID = PROJEKTID.map(p => p.kood);
const projektiNimi = (kood) => (PROJEKTID.find(p => p.kood === kood) || { nimi: kood }).nimi;

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
    -- Projekt (lidl/cramo/xseeria/isiklik) ja isikliku sõidu juhi nimi. Vanad read = Lidl.
    ALTER TABLE kaubik_paevik ADD COLUMN IF NOT EXISTS projekt VARCHAR(20) NOT NULL DEFAULT 'lidl';
    ALTER TABLE kaubik_paevik ADD COLUMN IF NOT EXISTS juht VARCHAR(100);
    -- Admini käsitsi lisatud soidud: võib olla ainult km (ilma näitudeta) ja rendikaubikuga (oma näidud,
    -- mis ei mõjuta oma kaubiku "viimase näidu" kontrolli).
    ALTER TABLE kaubik_paevik ALTER COLUMN algus_km DROP NOT NULL;
    ALTER TABLE kaubik_paevik ADD COLUMN IF NOT EXISTS km_kasitsi INTEGER;
    ALTER TABLE kaubik_paevik ADD COLUMN IF NOT EXISTS soiduk VARCHAR(10) NOT NULL DEFAULT 'oma';
    ALTER TABLE kaubik_paevik ADD COLUMN IF NOT EXISTS lisas_admin BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS kaubik_hinnad (
      projekt VARCHAR(20) PRIMARY KEY,
      paevahind DECIMAL(10,2) NOT NULL DEFAULT 0,
      km_hind DECIMAL(10,3) NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`INSERT INTO kaubik_seaded (id) VALUES (1) ON CONFLICT DO NOTHING`);
  for (const p of PROJEKTID) {
    await pool.query(`INSERT INTO kaubik_hinnad (projekt, paevahind, km_hind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [p.kood, p.paevahind, p.km_hind]);
  }
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
  // Ühekordne (19.11.2026): kaubik läheb päriselt Lidli arvetele — "Lisa Lidli arvele" sisse.
  if (v.rows[0].versioon < 3) {
    await pool.query(`UPDATE kaubik_seaded SET arvele=true, versioon=GREATEST(versioon, 3) WHERE id=1`);
  }
  // Ühekordne (18.11.2026): hinnad liikusid projektipõhiseks — Lidli hinnaks jääb seni seadetes olnud hind.
  if (v.rows[0].versioon < 2) {
    await pool.query(`UPDATE kaubik_hinnad h SET paevahind=s.paevahind, km_hind=s.km_hind FROM kaubik_seaded s WHERE s.id=1 AND h.projekt='lidl'`);
    await pool.query(`UPDATE kaubik_seaded SET versioon=GREATEST(versioon, 2) WHERE id=1`);
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
function hind(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// Seaded + projektide hinnad: { arvele, kaubiku_nimi, projektid: [{kood, nimi, paevahind, km_hind}] }
async function seaded() {
  const s = (await pool.query(`SELECT * FROM kaubik_seaded WHERE id=1`)).rows[0];
  const h = await pool.query(`SELECT * FROM kaubik_hinnad`);
  const hinnad = {};
  h.rows.forEach(x => { hinnad[x.projekt] = { paevahind: parseFloat(x.paevahind) || 0, km_hind: parseFloat(x.km_hind) || 0 }; });
  return {
    arvele: !!s.arvele,
    kaubiku_nimi: s.kaubiku_nimi,
    projektid: PROJEKTID.map(p => ({ kood: p.kood, nimi: p.nimi, ...(hinnad[p.kood] || { paevahind: 0, km_hind: 0 }) }))
  };
}
const hinnadKoodiga = (s) => { const m = {}; s.projektid.forEach(p => { m[p.kood] = p; }); return m; };

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
async function viimaneNait() {
  const r = await pool.query(
    `SELECT MAX(GREATEST(algus_km, COALESCE(lopp_km, 0))) AS nait FROM kaubik_paevik WHERE soiduk='oma' AND algus_km IS NOT NULL`
  );
  return r.rows[0].nait === null ? null : parseInt(r.rows[0].nait, 10);
}

// Isiklike sõitude juhid — viimati kasutatud ees (ajalugu, et nime ei peaks iga kord trükkima).
async function juhid() {
  const r = await pool.query(
    `SELECT juht FROM kaubik_paevik WHERE projekt='isiklik' AND juht IS NOT NULL AND juht <> ''
     GROUP BY juht ORDER BY MAX(loodud) DESC LIMIT 20`
  );
  return r.rows.map(x => x.juht);
}

// Sõidu km: näitude vahe, kui mõlemad näidud on olemas, muidu käsitsi sisestatud km. null = sõit veel käib.
function soiduKm(x) {
  if (x.algus_km !== null && x.algus_km !== undefined && x.lopp_km !== null && x.lopp_km !== undefined) return x.lopp_km - x.algus_km;
  if (x.km_kasitsi !== null && x.km_kasitsi !== undefined) return x.km_kasitsi;
  return null;
}

function reaVorm(x) {
  const km = soiduKm(x);
  return {
    id: x.id, kuupaev: x.kuupaev, worker_id: x.worker_id, tootaja: x.tootaja || null,
    projekt: x.projekt, projekti_nimi: projektiNimi(x.projekt), juht: x.juht || '',
    algus_km: x.algus_km, lopp_km: x.lopp_km, km,
    km_kasitsi: x.km_kasitsi === undefined ? null : x.km_kasitsi,
    soiduk: x.soiduk || 'oma', lisas_admin: !!x.lisas_admin,
    algus_foto: x.algus_foto_url, lopp_foto: x.lopp_foto_url, markus: x.markus || '',
    lahti: km === null
  };
}

// Kokkuvõte perioodi kohta projektide kaupa. Päevatasu üks kord projekti + kuupäeva kohta (lõpetatud sõit).
function kokkuvote(read, s) {
  const h = hinnadKoodiga(s);
  const lopetatud = read.filter(x => soiduKm(x) !== null);
  const projektid = s.projektid.map(p => {
    const omad = lopetatud.filter(x => x.projekt === p.kood);
    const paevad = new Set(omad.map(x => x.kuupaev)).size;
    const km = omad.reduce((sum, x) => sum + soiduKm(x), 0);
    const paevaTulu = r2(paevad * h[p.kood].paevahind);
    const kmTulu = r2(km * h[p.kood].km_hind);
    return { kood: p.kood, nimi: p.nimi, soite: omad.length, paevad, km, paeva_tulu: paevaTulu, km_tulu: kmTulu, kokku: r2(paevaTulu + kmTulu) };
  });
  return {
    projektid,
    paevad: new Set(lopetatud.map(x => x.kuupaev)).size, // erinevad päevad, mil kaubik üldse sõitis
    km: lopetatud.reduce((sum, x) => sum + soiduKm(x), 0),
    paeva_tulu: r2(projektid.reduce((sum, p) => sum + p.paeva_tulu, 0)),
    km_tulu: r2(projektid.reduce((sum, p) => sum + p.km_tulu, 0)),
    kokku: r2(projektid.reduce((sum, p) => sum + p.kokku, 0))
  };
}

// Kontrollib projekti ja juhi. Tagastab { projekt, juht } või { viga }.
function loeProjekt(b) {
  const projekt = String(b.projekt || '');
  if (!PROJEKTI_KOODID.includes(projekt)) return { viga: 'Vali, mis projekti raames sõidad' };
  const juht = puhas(b.juht, 100);
  if (projekt === 'isiklik' && !juht) return { viga: 'Isikliku sõidu puhul kirjuta, kes sõidab' };
  return { projekt, juht: projekt === 'isiklik' ? juht : null };
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

// Töötaja vaade: lahtine sõit (kui on), viimane näit, projektid, juhtide ajalugu ja viimased soidud.
router.get('/minu', noudaTootajat, async (req, res) => {
  const s = await seaded();
  const lahtine = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 AND p.lopp_km IS NULL AND p.km_kasitsi IS NULL AND p.algus_km IS NOT NULL ORDER BY p.loodud DESC LIMIT 1`,
    [req.session.workerId]
  );
  const viimased = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 ORDER BY p.kuupaev DESC, p.id DESC LIMIT 40`,
    [req.session.workerId]
  );
  const kuu = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev FROM kaubik_paevik p
     WHERE p.worker_id=$1 AND date_trunc('month', p.kuupaev) = date_trunc('month', CURRENT_DATE)`,
    [req.session.workerId]
  );
  // Viimati valitud projekt pakutakse uue sõidu alguses ette.
  const eelmine = viimased.rows.length ? viimased.rows[0].projekt : 'lidl';
  res.json({
    ok: true,
    seaded: { kaubiku_nimi: s.kaubiku_nimi, projektid: s.projektid },
    lahtine: lahtine.rows.length ? reaVorm(lahtine.rows[0]) : null,
    viimane_nait: await viimaneNait(),
    viimane_projekt: eelmine,
    juhid: await juhid(),
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

// Sõidu algus: projekt (+ juht, kui isiklik), algnäit (+ valikuline spidomeetri foto).
router.post('/algus', noudaTootajat, uploadPilt.single('foto'), async (req, res) => {
  const b = req.body || {};
  const kuupaev = onKuupaev(b.kuupaev) ? b.kuupaev : null;
  if (!kuupaev) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  const pr = loeProjekt(b);
  if (pr.viga) return res.json({ ok: false, veateade: pr.viga });
  const nait = taisarv(b.nait);
  if (!Number.isFinite(nait) || nait <= 0) return res.json({ ok: false, veateade: 'Sisesta odomeetri näit (täisarv, km)' });
  const lahtine = await pool.query(
    `SELECT id FROM kaubik_paevik WHERE worker_id=$1 AND lopp_km IS NULL AND km_kasitsi IS NULL AND algus_km IS NOT NULL`, [req.session.workerId]);
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
    `INSERT INTO kaubik_paevik (worker_id, kuupaev, projekt, juht, algus_km, algus_foto_url, algus_foto_id, markus)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.session.workerId, kuupaev, pr.projekt, pr.juht, nait, foto && foto.url, foto && foto.id, puhas(b.markus, 300) || null]
  );
  // Vahe eelmise lõpunäiduga (nt keegi sõitis kirja panemata) — hoiatus, mitte viga.
  const vahe = eelmine !== null ? nait - eelmine : 0;
  res.json({ ok: true, id: r.rows[0].id, hoiatus: vahe > 0 ? `NB: eelmise sõidu lõpust on ${vahe} km kirja panemata.` : null });
});

// Sõidu lõpp: lõpunäit (+ valikuline foto).
router.post('/lopp/:id', noudaTootajat, uploadPilt.single('foto'), async (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10) || 0;
  const v = await pool.query(`SELECT * FROM kaubik_paevik WHERE id=$1 AND worker_id=$2`, [id, req.session.workerId]);
  if (!v.rows.length) return res.json({ ok: false, veateade: 'Sõitu ei leitud' });
  const k = v.rows[0];
  if (soiduKm(k) !== null || k.algus_km === null) return res.json({ ok: false, veateade: 'See sõit on juba lõpetatud' });
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
  const h = hinnadKoodiga(await seaded())[k.projekt] || { paevahind: 0, km_hind: 0 };
  const km = nait - k.algus_km;
  res.json({ ok: true, km, tulu: r2(h.paevahind + km * h.km_hind) });
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
// Keha: { kaubiku_nimi, arvele, hinnad: { lidl: {paevahind, km_hind}, cramo: {...}, ... } }
router.post('/admin/seaded', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const hinnad = b.hinnad || {};
  for (const kood of PROJEKTI_KOODID) {
    const x = hinnad[kood];
    if (!x) continue;
    const ph = hind(x.paevahind), kh = hind(x.km_hind);
    if (!Number.isFinite(ph) || !Number.isFinite(kh)) return res.json({ ok: false, veateade: `Vigane hind: ${projektiNimi(kood)}` });
    await pool.query(
      `INSERT INTO kaubik_hinnad (projekt, paevahind, km_hind) VALUES ($1,$2,$3)
       ON CONFLICT (projekt) DO UPDATE SET paevahind=EXCLUDED.paevahind, km_hind=EXCLUDED.km_hind`,
      [kood, r2(ph), Math.round(kh * 1000) / 1000]
    );
  }
  await pool.query(`UPDATE kaubik_seaded SET arvele=$1, kaubiku_nimi=$2 WHERE id=1`, [!!b.arvele, puhas(b.kaubiku_nimi, 100) || 'Kaubik']);
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

async function perioodiRead(algus, lopp, projekt) {
  const r = await pool.query(
    `SELECT p.*, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev, w.nimi AS tootaja
     FROM kaubik_paevik p LEFT JOIN workers w ON w.id = p.worker_id
     WHERE p.kuupaev BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.projekt = $3)
     ORDER BY p.kuupaev, p.id`,
    [algus, lopp, PROJEKTI_KOODID.includes(projekt) ? projekt : null]
  );
  return r.rows;
}

router.get('/admin/paevik', noudaAdmin, async (req, res) => {
  const { algus, lopp, projekt } = req.query;
  if (!onKuupaev(algus) || !onKuupaev(lopp)) return res.json({ ok: false, veateade: 'Vali periood' });
  const s = await seaded();
  const read = await perioodiRead(algus, lopp, projekt);
  res.json({ ok: true, seaded: s, read: read.map(reaVorm), kokku: kokkuvote(read, s), viimane_nait: await viimaneNait(), juhid: await juhid() });
});

// Loeb admini vormist läbisõidu: näidud (algus+lopp), ainult algus (sõit käib) või ainult km.
// Tagastab { algus, lopp, km } (puuduvad = null) või { viga }.
function loeLabisoit(b) {
  const tyhi = (v) => v === '' || v === null || v === undefined;
  const algus = tyhi(b.algus_km) ? null : taisarv(b.algus_km);
  const lopp = tyhi(b.lopp_km) ? null : taisarv(b.lopp_km);
  const km = tyhi(b.km) ? null : taisarv(b.km);
  if (algus !== null && !Number.isFinite(algus)) return { viga: 'Vigane algnäit' };
  if (lopp !== null && !Number.isFinite(lopp)) return { viga: 'Vigane lõpunäit' };
  if (km !== null && !Number.isFinite(km)) return { viga: 'Vigane km (täisarv)' };
  if (algus !== null && lopp !== null) {
    if (lopp < algus) return { viga: 'Lõpunäit peab olema algnäidust suurem' };
    return { algus, lopp, km: null };
  }
  if (lopp !== null) return { viga: 'Sisesta ka algnäit' };
  if (km !== null) return { algus: null, lopp: null, km };
  if (algus !== null) return { algus, lopp: null, km: null }; // sõit veel käib
  return { viga: 'Sisesta km või odomeetri näidud' };
}

// ── ADMIN: SÕIDU KÄSITSI LISAMINE ──
// Keha: { kuupaev, kuupaev_kuni?, projekt, juht?, soiduk: 'oma'|'rent', worker_id?, km? | algus_km+lopp_km, markus? }
// Vahemiku puhul tehakse rida iga päeva kohta (iga päev = päevatasu). Km/näidud lähevad ESIMESE päeva reale,
// ülejäänud päevadel 0 km (märkusega) — nii tuleb kogusumma õige ja päevatasu iga päeva eest.
router.post('/admin/soit', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  const kuni = onKuupaev(b.kuupaev_kuni) ? b.kuupaev_kuni : b.kuupaev;
  if (kuni < b.kuupaev) return res.json({ ok: false, veateade: '"Kuni" kuupäev on enne algust' });
  const paevad = [];
  for (let d = new Date(b.kuupaev + 'T12:00:00Z'); d <= new Date(kuni + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    paevad.push(d.toISOString().slice(0, 10));
    if (paevad.length > 31) return res.json({ ok: false, veateade: 'Vahemik võib olla kuni 31 päeva' });
  }
  const pr = loeProjekt(b);
  if (pr.viga) return res.json({ ok: false, veateade: pr.viga });
  const ls = loeLabisoit(b);
  if (ls.viga) return res.json({ ok: false, veateade: ls.viga });
  const soiduk = b.soiduk === 'rent' ? 'rent' : 'oma';
  const workerId = parseInt(b.worker_id, 10) || null;
  const markus = puhas(b.markus, 250);
  const vahemik = paevad.length > 1 ? `${paevad[0].slice(8, 10)}.${paevad[0].slice(5, 7)}–${kuni.slice(8, 10)}.${kuni.slice(5, 7)}` : '';
  const ids = [];
  for (let i = 0; i < paevad.length; i++) {
    const esimene = i === 0;
    const reaMarkus = esimene
      ? [markus, vahemik ? `km kogu perioodi ${vahemik} kohta` : ''].filter(Boolean).join(' · ')
      : [markus, `sama sõit ${vahemik}, km esimesel päeval`].filter(Boolean).join(' · ');
    const r = await pool.query(
      `INSERT INTO kaubik_paevik (worker_id, kuupaev, projekt, juht, algus_km, lopp_km, km_kasitsi, soiduk, markus, lisas_admin, lopetatud)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true, CASE WHEN $6::int IS NULL AND $7::int IS NULL THEN NULL ELSE NOW() END) RETURNING id`,
      [workerId, paevad[i], pr.projekt, pr.juht,
        esimene ? ls.algus : null, esimene ? ls.lopp : null, esimene ? ls.km : 0,
        soiduk, reaMarkus || null]
    );
    ids.push(r.rows[0].id);
  }
  res.json({ ok: true, ids, paevi: paevad.length });
});

// Admin saab sõitu parandada (nt AI luges valesti, vale projekt, rendikaubik).
router.put('/admin/soit/:id', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const id = parseInt(req.params.id, 10) || 0;
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vigane kuupäev' });
  const pr = loeProjekt(b);
  if (pr.viga) return res.json({ ok: false, veateade: pr.viga });
  const ls = loeLabisoit(b);
  if (ls.viga) return res.json({ ok: false, veateade: ls.viga });
  const r = await pool.query(
    `UPDATE kaubik_paevik SET kuupaev=$1, algus_km=$2, lopp_km=$3, km_kasitsi=$4, markus=$5, projekt=$6, juht=$7, soiduk=$8,
       lopetatud = CASE WHEN $3::int IS NULL AND $4::int IS NULL THEN NULL ELSE COALESCE(lopetatud, NOW()) END
     WHERE id=$9`,
    [b.kuupaev, ls.algus, ls.lopp, ls.km, puhas(b.markus, 300) || null, pr.projekt, pr.juht, b.soiduk === 'rent' ? 'rent' : 'oma', id]
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
  const { algus, lopp, projekt } = req.query;
  if (!onKuupaev(algus) || !onKuupaev(lopp)) return res.status(400).send('Vali periood');
  const s = await seaded();
  const h = hinnadKoodiga(s);
  const read = await perioodiRead(algus, lopp, projekt);
  const kv = kokkuvote(read, s);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sõidupäevik');
  const kp = (x) => { const o = String(x).split('-'); return o.length === 3 ? `${o[2]}.${o[1]}.${o[0]}` : x; };
  const VEERGE = 11;
  ws.columns = [
    { width: 12 }, { width: 11 }, { width: 18 }, { width: 18 }, { width: 13 }, { width: 13 }, { width: 9 },
    { width: 12 }, { width: 12 }, { width: 12 }, { width: 30 }
  ];
  ws.mergeCells(1, 1, 1, VEERGE);
  ws.getCell('A1').value = `${s.kaubiku_nimi} — sõidupäevik ${kp(algus)} – ${kp(lopp)}` + (PROJEKTI_KOODID.includes(projekt) ? ` (${projektiNimi(projekt)})` : '');
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  ws.getRow(1).height = 26;
  const pais = ws.getRow(3);
  pais.values = ['Kuupäev', 'Projekt', 'Töötaja', 'Juht (isiklik)', 'Algnäit (km)', 'Lõpunäit (km)', 'Km', 'Päevatasu €', 'Km tasu €', 'Kokku €', 'Märkus'];
  pais.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  // Päevatasu näidatakse projekti+kuupäeva esimesel lõpetatud real (sama päeva mitu sõitu = üks päevatasu).
  const tasutud = new Set();
  let rida = 4;
  read.forEach((x, i) => {
    const hp = h[x.projekt] || { paevahind: 0, km_hind: 0 };
    const km = soiduKm(x);
    let paevaTasu = 0;
    const voti = x.projekt + '|' + x.kuupaev;
    if (km !== null && !tasutud.has(voti)) { tasutud.add(voti); paevaTasu = hp.paevahind; }
    const kmTasu = km === null ? 0 : r2(km * hp.km_hind);
    const r = ws.getRow(rida++);
    r.values = [kp(x.kuupaev), projektiNimi(x.projekt) + (x.soiduk === 'rent' ? ' (rendikaubik)' : ''), x.tootaja || '', x.juht || '',
      x.algus_km === null ? '' : x.algus_km, km === null ? 'lõpetamata' : (x.lopp_km === null ? '' : x.lopp_km),
      km === null ? '' : km, km === null ? '' : paevaTasu, km === null ? '' : kmTasu, km === null ? '' : r2(paevaTasu + kmTasu), x.markus || ''];
    if (i % 2 === 1) r.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; });
    [8, 9, 10].forEach(n => { r.getCell(n).numFmt = '#,##0.00'; });
  });
  const kok = ws.getRow(rida);
  kok.values = ['KOKKU', '', `${kv.paevad} sõidupäeva`, '', '', '', kv.km, kv.paeva_tulu, kv.km_tulu, kv.kokku, ''];
  kok.eachCell({ includeEmpty: true }, c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  });
  [8, 9, 10].forEach(n => { kok.getCell(n).numFmt = '#,##0.00'; });
  ws.autoFilter = { from: 'A3', to: { row: Math.max(3, rida - 1), column: VEERGE } };

  // Projektide koond allpool
  let k = rida + 2;
  const kp2 = ws.getRow(k++);
  kp2.values = ['Projekt', '', 'Sõite', 'Sõidupäevi', 'Km', 'Hind', '', 'Päevatasu €', 'Km tasu €', 'Kokku €'];
  kp2.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }; });
  kv.projektid.filter(p => p.soite > 0).forEach(p => {
    const hp = h[p.kood];
    const r = ws.getRow(k++);
    r.values = [p.nimi, '', p.soite, p.paevad, p.km, `${hp.paevahind} €/päev + ${hp.km_hind} €/km`, '', p.paeva_tulu, p.km_tulu, p.kokku];
    [8, 9, 10].forEach(n => { r.getCell(n).numFmt = '#,##0.00'; });
  });
  ws.getRow(k + 1).getCell(1).value = 'Hinnad käibemaksuta.';
  ws.getRow(k + 1).getCell(1).font = { italic: true, color: { argb: 'FF7F7F7F' } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="kaubik_${algus}_${lopp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── LIDLI ARVE: read arve autotäitmisele (kasutab routes/arved.js) ────────
// Ainult Lidli projekti soidud. Tagastab { read, teade } — teade näidatakse arve vormis, et oleks näha,
// miks kaubiku read tulid või ei tulnud.
async function arveInfo(algus, lopp) {
  await valmis();
  const s = await seaded();
  const h = hinnadKoodiga(s).lidl;
  const soidud = await perioodiRead(algus, lopp, 'lidl');
  const kv = kokkuvote(soidud, s).projektid.find(p => p.kood === 'lidl');
  const lahtised = soidud.filter(x => soiduKm(x) === null).length;
  const lahtiseTeade = lahtised ? ` NB: ${lahtised} sõit on lõpetamata (lõpunäit puudu) — see ei ole arvel.` : '';
  if (!kv.paevad) return { read: [], teade: '🚐 Kaubiku Lidli sõite sellel perioodil pole.' + lahtiseTeade };
  if (!s.arvele) return { read: [], teade: `🚐 Kaubiku read jäid välja (${kv.paevad} päeva, ${kv.km} km): lehel /kaubik-admin on "Lisa Lidli arvele" välja lülitatud.` };
  const read = [];
  if (h.paevahind > 0) read.push({ kirjeldus: `${s.kaubiku_nimi} rent`, kogus: kv.paevad, uhik: 'päev', hind: h.paevahind, summa: kv.paeva_tulu });
  if (kv.km > 0 && h.km_hind > 0) read.push({ kirjeldus: `${s.kaubiku_nimi} läbisõit`, kogus: kv.km, uhik: 'km', hind: h.km_hind, summa: kv.km_tulu });
  return { read, teade: `🚐 Lisatud kaubik: ${kv.paevad} päeva + ${kv.km} km = ${kv.kokku.toFixed(2).replace('.', ',')} € (km-ta).` + lahtiseTeade };
}
async function arveRead(algus, lopp) { return (await arveInfo(algus, lopp)).read; }

module.exports = router;
module.exports.arveRead = arveRead;
module.exports.arveInfo = arveInfo;
