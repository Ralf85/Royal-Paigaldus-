const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { lukusMinuteid, margiVale, margiOige, lukuTeade, valeTeade, turvalineVordlus } = require('../loginkaitse');
const { failiPais, onKuupaev } = require('../csvabi');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { laadiPuhver } = require('../zipabi');
const { aiFailid, loeDokument, arv: aiArv, puhasKuupaev } = require('../ailugeja');

// ══════════════════════════════════════════════════════════════════════════
// TELJE 10 (koduremont) — naabriga jagatud remondi arvestus
//
// Kuidas see töötab:
//  * Töötajad panevad tunnid kirja TAVALISE töökirjena ettevõtte "TELJE 10" alla (nagu Lidl või
//    Cramo). Nii jõuab nende palk (tunnitasu määrab admin töötaja ettevõtete all) tavapärasesse
//    palgaarvestusse ja töötaja vaates ei muutu midagi.
//  * "Tööosa" on selle ettevõtte OBJEKT (nt "Ühine aed"). Igal tööosal on vaikimisi jaotus —
//    mitu protsenti sellest on naabri kanda (tabel remont_osad). Töötaja valib lihtsalt objekti.
//  * Admin saab üksiku töökirje jaotust eraldi muuta (tabel remont_too_jaotus).
//  * Materjalid (tšekid) on eraldi tabelis remont_kulud — jagatakse protsendi või summaga.
//  * Naaber logib sisse oma PIN-iga lehel /remont ja näeb kõike, aga muuta ei saa. Ta näeb ainult
//    talle esitatavat tunnihinda — töötajate tunnitasu siit moodulist üldse välja ei saadeta.
//
// Tabelid luuakse siin (mitte db.js-is), et moodul oleks iseseisev — sama muster mis routes/latvia.js.
// ══════════════════════════════════════════════════════════════════════════

const NAABRI_SESSIOON_PAEVI = 90;
const ETTEVOTTE_NIMI = 'TELJE 10';

function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return cloudinary;
}

// Tšekk võib olla foto või PDF (nt e-poe arve).
const uploadDok = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Ainult pildid või PDF-id!'));
  }
});

// ── TABELID ───────────────────────────────────────────────────────────────
// Luuakse esimesel päringul (mitte faili laadimisel), sest siis on põhitabelid (ettevotted,
// objektid, tookirjed) kindlasti juba olemas — ka täiesti tühjal andmebaasil.
let valmisLubadus = null;
function valmis() {
  if (!valmisLubadus) {
    valmisLubadus = looTabelid().catch((err) => {
      valmisLubadus = null; // järgmine päring proovib uuesti
      throw err;
    });
  }
  return valmisLubadus;
}

async function looTabelid() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remont_seaded (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ettevote_id INTEGER REFERENCES ettevotted(id),
      projekti_nimi VARCHAR(100) NOT NULL DEFAULT 'TELJE 10',
      minu_nimi VARCHAR(60) NOT NULL DEFAULT 'Ralf',
      naabri_nimi VARCHAR(60) NOT NULL DEFAULT 'Kerttu',
      tunnihind DECIMAL(10,2) NOT NULL DEFAULT 27,
      naabri_pin VARCHAR(20)
    );
    CREATE TABLE IF NOT EXISTS remont_osad (
      objekt_id INTEGER PRIMARY KEY REFERENCES objektid(id) ON DELETE CASCADE,
      naabri_protsent DECIMAL(5,2) NOT NULL DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS remont_too_jaotus (
      tookirje_id INTEGER PRIMARY KEY REFERENCES tookirjed(id) ON DELETE CASCADE,
      naabri_protsent DECIMAL(5,2) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remont_kulud (
      id SERIAL PRIMARY KEY,
      kuupaev DATE NOT NULL,
      kirjeldus TEXT NOT NULL,
      summa DECIMAL(10,2) NOT NULL,
      maksja VARCHAR(10) NOT NULL DEFAULT 'mina',
      jaotus VARCHAR(10) NOT NULL DEFAULT 'protsent',
      naabri_protsent DECIMAL(5,2),
      naabri_summa DECIMAL(10,2) NOT NULL DEFAULT 0,
      objekt_id INTEGER REFERENCES objektid(id) ON DELETE SET NULL,
      foto_url TEXT,
      foto_public_id TEXT,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS remont_maksed (
      id SERIAL PRIMARY KEY,
      kuupaev DATE NOT NULL,
      summa DECIMAL(10,2) NOT NULL,
      suund VARCHAR(10) NOT NULL DEFAULT 'naabrilt',
      kommentaar TEXT,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS remont_sessions (
      id SERIAL PRIMARY KEY,
      token VARCHAR(100) NOT NULL UNIQUE,
      loodud TIMESTAMP DEFAULT NOW()
    );
  `);
  // Tšeki read (tooted) ja seos Royal Paigalduse arvetega (arve_sisse).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remont_kulu_read (
      id SERIAL PRIMARY KEY,
      kulu_id INTEGER NOT NULL REFERENCES remont_kulud(id) ON DELETE CASCADE,
      jrk INTEGER NOT NULL DEFAULT 0,
      nimetus TEXT NOT NULL,
      summa DECIMAL(10,2) NOT NULL,
      naabri_protsent DECIMAL(5,2) NOT NULL DEFAULT 0,
      naabri_summa DECIMAL(10,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS remont_kulu_read_kulu_idx ON remont_kulu_read(kulu_id);
    ALTER TABLE remont_kulud ADD COLUMN IF NOT EXISTS kaibemaks DECIMAL(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE remont_kulud ADD COLUMN IF NOT EXISTS foto_tyyp VARCHAR(10);
    ALTER TABLE remont_kulud ADD COLUMN IF NOT EXISTS foto_arvest BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE remont_kulud ADD COLUMN IF NOT EXISTS arve_sisse_id INTEGER REFERENCES arve_sisse(id) ON DELETE SET NULL;
  `);
  await pool.query(`INSERT INTO remont_seaded (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  // Ettevõte "TELJE 10" — selle alla teevad töötajad töökirjeid. Tüüp on 'muu', et ükski
  // olemasolev tüübipõhine erireegel (Lidl, Cramo lõunapaus jne) sellele ei rakenduks.
  const s = await pool.query(`SELECT ettevote_id FROM remont_seaded WHERE id=1`);
  if (!s.rows[0].ettevote_id) {
    const e = await pool.query(
      `INSERT INTO ettevotted (nimi, tyyp) VALUES ($1, 'muu')
       ON CONFLICT (nimi) DO UPDATE SET nimi = EXCLUDED.nimi RETURNING id`,
      [ETTEVOTTE_NIMI]
    );
    await pool.query(`UPDATE remont_seaded SET ettevote_id=$1 WHERE id=1`, [e.rows[0].id]);
  }
  // Ühekordne muudatus (08.10.2026): projekt ja ettevõte said nimeks "TELJE 10", teine osapool on
  // Kerttu ja tunnihind 27 €. Tehakse üks kord — hilisemad muudatused "Seaded" lehel jäävad kehtima.
  await pool.query(`ALTER TABLE remont_seaded ADD COLUMN IF NOT EXISTS versioon INTEGER NOT NULL DEFAULT 1`);
  const v = await pool.query(`SELECT versioon, ettevote_id FROM remont_seaded WHERE id=1`);
  if (v.rows[0].versioon < 2) {
    await pool.query(
      `UPDATE remont_seaded SET projekti_nimi='TELJE 10', minu_nimi='Ralf', naabri_nimi='Kerttu', tunnihind=27, versioon=2 WHERE id=1`
    );
    await pool.query(
      `UPDATE ettevotted SET nimi=$1 WHERE id=$2 AND NOT EXISTS (SELECT 1 FROM ettevotted WHERE nimi=$1)`,
      [ETTEVOTTE_NIMI, v.rows[0].ettevote_id]
    );
  }
  await pool.query(`DELETE FROM remont_sessions WHERE loodud < NOW() - INTERVAL '${NAABRI_SESSIOON_PAEVI} days'`);
}

router.use(async (req, res, next) => {
  try { await valmis(); next(); } catch (err) { next(err); }
});

// ── ÕIGUSED ───────────────────────────────────────────────────────────────
// Peaadmin tuvastatakse server.js-is (req.session.isAdmin). Naabri sessioon on oma tabelis.
async function leiaRoll(req) {
  if (req.session && req.session.isAdmin) return 'admin';
  const token = req.sessionToken;
  if (!token) return null;
  const r = await pool.query(
    `SELECT 1 FROM remont_sessions WHERE token=$1 AND loodud > NOW() - INTERVAL '${NAABRI_SESSIOON_PAEVI} days'`,
    [token]
  );
  return r.rows.length ? 'naaber' : null;
}

async function noudaVaatajat(req, res, next) {
  req.remontRoll = await leiaRoll(req);
  if (!req.remontRoll) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// ── ABIFUNKTSIOONID ───────────────────────────────────────────────────────
function r2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
// "12,5" -> 12.5 ; tühi või vigane -> NaN
function loeArv(v) {
  if (v === null || v === undefined || String(v).trim() === '') return NaN;
  return parseFloat(String(v).replace(',', '.'));
}
function loeProtsent(v) {
  const p = loeArv(v);
  return Number.isFinite(p) && p >= 0 && p <= 100 ? r2(p) : null;
}
function kpEt(kp) {
  const o = String(kp || '').split('-');
  return o.length === 3 ? `${o[2]}.${o[1]}.${o[0]}` : String(kp || '');
}


// Kõik andmed ühe korraga — projekt on väike (üks remont), seega pole lehekülgedeks jagamist vaja.
// Siit EI väljastata töötajate tunnitasu ega muud palgainfot.
async function koguAndmed() {
  const sRes = await pool.query(`SELECT * FROM remont_seaded WHERE id=1`);
  const seaded = sRes.rows[0];
  const hind = parseFloat(seaded.tunnihind) || 0;
  const eRes = await pool.query(`SELECT nimi FROM ettevotted WHERE id=$1`, [seaded.ettevote_id]);
  const ettevoteNimi = eRes.rows.length ? eRes.rows[0].nimi : ETTEVOTTE_NIMI;

  const osadRes = await pool.query(
    `SELECT o.id, o.nimi, o.aktiivne, ro.naabri_protsent
     FROM objektid o
     LEFT JOIN remont_osad ro ON ro.objekt_id = o.id
     WHERE o.ettevote_id = $1
     ORDER BY o.aktiivne DESC, o.nimi`,
    [seaded.ettevote_id]
  );
  const osad = osadRes.rows.map(o => ({
    id: o.id, nimi: o.nimi, aktiivne: o.aktiivne,
    naabri_protsent: o.naabri_protsent === null ? null : parseFloat(o.naabri_protsent)
  }));

  const toodRes = await pool.query(
    `SELECT t.id, to_char(t.kuupaev, 'YYYY-MM-DD') AS kuupaev,
            to_char(t.algus, 'HH24:MI') AS algus, to_char(t.lopp, 'HH24:MI') AS lopp,
            t.tunnid, t.kommentaar, t.objekt_id, COALESCE(t.lisakulu_summa, 0) AS lisakulu_summa,
            COALESCE(t.lisakulu_selgitus, '') AS lisakulu_selgitus,
            o.nimi AS osa_nimi, w.nimi AS tootaja,
            j.naabri_protsent AS oma_protsent, ro.naabri_protsent AS osa_protsent
     FROM tookirjed t
     JOIN workers w ON w.id = t.worker_id
     LEFT JOIN objektid o ON o.id = t.objekt_id
     LEFT JOIN remont_osad ro ON ro.objekt_id = t.objekt_id
     LEFT JOIN remont_too_jaotus j ON j.tookirje_id = t.id
     WHERE t.ettevote_id = $1
     ORDER BY t.kuupaev DESC, t.algus DESC, t.id DESC`,
    [seaded.ettevote_id]
  );
  const pildidRes = toodRes.rows.length ? await pool.query(
    `SELECT tookirje_id, url FROM tookirje_pildid WHERE tookirje_id = ANY($1) ORDER BY loodud ASC`,
    [toodRes.rows.map(t => t.id)]
  ) : { rows: [] };
  const pildid = {};
  pildidRes.rows.forEach(p => { (pildid[p.tookirje_id] = pildid[p.tookirje_id] || []).push(p.url); });

  let tunnidKokku = 0, naabriTunnid = 0, naabriToo = 0, maaramata = 0;
  const tood = toodRes.rows.map(t => {
    const tunnid = parseFloat(t.tunnid) || 0;
    const onOma = t.oma_protsent !== null;
    const p = onOma ? parseFloat(t.oma_protsent) : (t.osa_protsent !== null ? parseFloat(t.osa_protsent) : null);
    const nTunnid = p === null ? 0 : r2(tunnid * p / 100);
    const nSumma = p === null ? 0 : r2(tunnid * p / 100 * hind);
    tunnidKokku += tunnid; naabriTunnid += nTunnid; naabriToo += nSumma;
    if (p === null) maaramata++;
    return {
      id: t.id, kuupaev: t.kuupaev, algus: t.algus, lopp: t.lopp, tunnid,
      kommentaar: t.kommentaar || '', objekt_id: t.objekt_id, osa_nimi: t.osa_nimi || '',
      tootaja: t.tootaja, naabri_protsent: p, oma_jaotus: onOma,
      naabri_tunnid: nTunnid, naabri_summa: nSumma,
      lisakulu_summa: parseFloat(t.lisakulu_summa) || 0, lisakulu_selgitus: t.lisakulu_selgitus,
      pildid: pildid[t.id] || []
    };
  });

  const kuludRes = await pool.query(
    `SELECT k.id, to_char(k.kuupaev, 'YYYY-MM-DD') AS kuupaev, k.kirjeldus, k.summa, k.maksja, k.jaotus,
            k.naabri_protsent, k.naabri_summa, k.objekt_id, k.foto_url, o.nimi AS osa_nimi,
            k.kaibemaks, k.foto_tyyp, k.foto_arvest, k.arve_sisse_id
     FROM remont_kulud k
     LEFT JOIN objektid o ON o.id = k.objekt_id
     ORDER BY k.kuupaev DESC, k.id DESC`
  );
  const readRes = await pool.query(
    `SELECT kulu_id, nimetus, summa, naabri_protsent, naabri_summa FROM remont_kulu_read ORDER BY kulu_id, jrk, id`
  );
  const kuluRead = {};
  readRes.rows.forEach(x => {
    (kuluRead[x.kulu_id] = kuluRead[x.kulu_id] || []).push({
      nimetus: x.nimetus, summa: parseFloat(x.summa) || 0,
      naabri_protsent: parseFloat(x.naabri_protsent) || 0, naabri_summa: parseFloat(x.naabri_summa) || 0
    });
  });
  let materjalKokku = 0, naabriMaterjal = 0, minuMaksisNaabriOsa = 0, naaberMaksisMinuOsa = 0;
  const kulud = kuludRes.rows.map(k => {
    const summa = parseFloat(k.summa) || 0;
    const nSumma = parseFloat(k.naabri_summa) || 0;
    materjalKokku += summa; naabriMaterjal += nSumma;
    if (k.maksja === 'naaber') naaberMaksisMinuOsa += summa - nSumma;
    else minuMaksisNaabriOsa += nSumma;
    return {
      id: k.id, kuupaev: k.kuupaev, kirjeldus: k.kirjeldus, summa, maksja: k.maksja, jaotus: k.jaotus,
      naabri_protsent: k.naabri_protsent === null ? null : parseFloat(k.naabri_protsent),
      naabri_summa: nSumma, minu_summa: r2(summa - nSumma),
      objekt_id: k.objekt_id, osa_nimi: k.osa_nimi || '',
      // Kui tšekk oli arvetes ja sealt kustutati, kustus ka fail — siis fotot enam pole.
      foto_url: (k.foto_arvest && !k.arve_sisse_id) ? '' : (k.foto_url || ''),
      foto_pdf: k.foto_tyyp === 'raw',
      kaibemaks: parseFloat(k.kaibemaks) || 0, arvetes: !!k.arve_sisse_id,
      read: kuluRead[k.id] || []
    };
  });

  const maksedRes = await pool.query(
    `SELECT id, to_char(kuupaev, 'YYYY-MM-DD') AS kuupaev, summa, suund, kommentaar
     FROM remont_maksed ORDER BY kuupaev DESC, id DESC`
  );
  let makstudNaabrilt = 0, makstudNaabrile = 0;
  const maksed = maksedRes.rows.map(m => {
    const summa = parseFloat(m.summa) || 0;
    if (m.suund === 'naabrile') makstudNaabrile += summa; else makstudNaabrilt += summa;
    return { id: m.id, kuupaev: m.kuupaev, summa, suund: m.suund, kommentaar: m.kommentaar || '' };
  });

  // Saldo > 0: naaber võlgneb mulle. Saldo < 0: mina võlgnen naabrile.
  const saldo = r2(naabriToo + minuMaksisNaabriOsa - naaberMaksisMinuOsa - makstudNaabrilt + makstudNaabrile);

  return {
    seaded: {
      projekti_nimi: seaded.projekti_nimi, minu_nimi: seaded.minu_nimi, naabri_nimi: seaded.naabri_nimi,
      tunnihind: hind
    },
    naabri_pin: seaded.naabri_pin || '',
    ettevote_id: seaded.ettevote_id,
    ettevote_nimi: ettevoteNimi,
    osad, tood, kulud, maksed,
    kokku: {
      tunnid: r2(tunnidKokku), naabri_tunnid: r2(naabriTunnid), naabri_too: r2(naabriToo),
      maaramata_toid: maaramata,
      materjal: r2(materjalKokku), naabri_materjal: r2(naabriMaterjal), minu_materjal: r2(materjalKokku - naabriMaterjal),
      minu_ostudest_naabri_osa: r2(minuMaksisNaabriOsa), naabri_ostudest_minu_osa: r2(naaberMaksisMinuOsa),
      makstud_naabrilt: r2(makstudNaabrilt), makstud_naabrile: r2(makstudNaabrile),
      saldo
    }
  };
}

// ── SISSELOGIMINE (naaber) ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const pin = req.body && typeof req.body.pin === 'string' ? req.body.pin.trim() : '';
  const lukus = await lukusMinuteid(req, 'remont');
  if (lukus) return res.json({ ok: false, veateade: lukuTeade(lukus), lukus: true });
  if (!pin) return res.json({ ok: false, veateade: 'Sisesta PIN-kood' });
  const s = await pool.query(`SELECT naabri_pin FROM remont_seaded WHERE id=1`);
  // Kui PIN-i pole veel määratud, ei saa keegi sisse (turvalineVordlus tagastab tühja väärtuse puhul false).
  if (!turvalineVordlus(pin, s.rows[0].naabri_pin || '')) {
    const alles = await margiVale(req, 'remont');
    return res.json({ ok: false, veateade: valeTeade('Vale PIN-kood', alles) });
  }
  await margiOige(req, 'remont');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO remont_sessions (token) VALUES ($1)`, [token]);
  res.json({ ok: true, token });
});

router.post('/logout', async (req, res) => {
  if (req.sessionToken) await pool.query(`DELETE FROM remont_sessions WHERE token=$1`, [req.sessionToken]);
  res.json({ ok: true });
});

router.get('/sessioon', async (req, res) => {
  res.json({ ok: true, roll: await leiaRoll(req) });
});

// ── VAATAMINE (admin + naaber) ────────────────────────────────────────────
router.get('/andmed', noudaVaatajat, async (req, res) => {
  const d = await koguAndmed();
  const onAdmin = req.remontRoll === 'admin';
  if (!onAdmin) {
    delete d.naabri_pin;
    delete d.ettevote_id;
    delete d.ettevote_nimi;
    // Töötaja lisakulu on palgaarvestuse info — naabrile seda ei näidata.
    d.tood.forEach(t => { delete t.lisakulu_summa; delete t.lisakulu_selgitus; });
    // Käibemaks ja seos Royal Paigalduse arvetega on raamatupidamise info.
    d.kulud.forEach(x => { delete x.kaibemaks; delete x.arvetes; });
  }
  res.json({ ok: true, roll: req.remontRoll, ...d });
});

// ── ADMIN: SEADED ─────────────────────────────────────────────────────────
router.post('/seaded', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const projekt = String(b.projekti_nimi || '').trim().slice(0, 100);
  const mina = String(b.minu_nimi || '').trim().slice(0, 60);
  const naaber = String(b.naabri_nimi || '').trim().slice(0, 60);
  const hind = loeArv(b.tunnihind);
  const pin = String(b.naabri_pin || '').trim();
  if (!projekt || !mina || !naaber) return res.json({ ok: false, veateade: 'Täida nimed' });
  if (!Number.isFinite(hind) || hind < 0 || hind > 1000) return res.json({ ok: false, veateade: 'Kontrolli tunnihinda' });
  if (pin && (pin.length < 4 || pin.length > 20)) return res.json({ ok: false, veateade: 'PIN peab olema 4–20 märki' });
  const vana = await pool.query(`SELECT naabri_pin FROM remont_seaded WHERE id=1`);
  await pool.query(
    `UPDATE remont_seaded SET projekti_nimi=$1, minu_nimi=$2, naabri_nimi=$3, tunnihind=$4, naabri_pin=$5 WHERE id=1`,
    [projekt, mina, naaber, r2(hind), pin || null]
  );
  // PIN-i vahetus logib naabri kõigist seadmetest välja.
  if ((vana.rows[0].naabri_pin || '') !== pin) await pool.query(`DELETE FROM remont_sessions`);
  res.json({ ok: true });
});

// ── ADMIN: TÖÖOSAD (= ettevõtte TELJE 10 objektid + jaotus) ─────────────
router.post('/osad', noudaAdmin, async (req, res) => {
  const nimi = String((req.body || {}).nimi || '').trim().slice(0, 200);
  const p = loeProtsent((req.body || {}).naabri_protsent);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta tööosa nimi' });
  if (p === null) return res.json({ ok: false, veateade: 'Osa peab olema 0–100%' });
  const s = await pool.query(`SELECT ettevote_id FROM remont_seaded WHERE id=1`);
  const o = await pool.query(
    `INSERT INTO objektid (nimi, ettevote_id) VALUES ($1, $2) RETURNING id`, [nimi, s.rows[0].ettevote_id]
  );
  await pool.query(`INSERT INTO remont_osad (objekt_id, naabri_protsent) VALUES ($1, $2)`, [o.rows[0].id, p]);
  res.json({ ok: true, id: o.rows[0].id });
});

router.put('/osad/:id', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = String(b.nimi || '').trim().slice(0, 200);
  const p = loeProtsent(b.naabri_protsent);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta tööosa nimi' });
  if (p === null) return res.json({ ok: false, veateade: 'Osa peab olema 0–100%' });
  const s = await pool.query(`SELECT ettevote_id FROM remont_seaded WHERE id=1`);
  const o = await pool.query(
    `UPDATE objektid SET nimi=$1, aktiivne=$2 WHERE id=$3 AND ettevote_id=$4 RETURNING id`,
    [nimi, b.aktiivne !== false, req.params.id, s.rows[0].ettevote_id]
  );
  if (!o.rowCount) return res.json({ ok: false, veateade: 'Tööosa ei leitud' });
  await pool.query(
    `INSERT INTO remont_osad (objekt_id, naabri_protsent) VALUES ($1, $2)
     ON CONFLICT (objekt_id) DO UPDATE SET naabri_protsent = EXCLUDED.naabri_protsent`,
    [req.params.id, p]
  );
  res.json({ ok: true });
});

// ── ADMIN: TÖÖKIRJE JAOTUS ────────────────────────────────────────────────
// objekt_id — millise tööosa alla kirje kuulub; naabri_protsent tühi = võetakse tööosa jaotus.
router.put('/tood/:id/jaotus', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const s = await pool.query(`SELECT ettevote_id FROM remont_seaded WHERE id=1`);
  const ettevoteId = s.rows[0].ettevote_id;
  const kirje = await pool.query(`SELECT id FROM tookirjed WHERE id=$1 AND ettevote_id=$2`, [req.params.id, ettevoteId]);
  if (!kirje.rowCount) return res.json({ ok: false, veateade: 'Töökirjet ei leitud' });

  let objektId = null;
  if (b.objekt_id) {
    const o = await pool.query(`SELECT id FROM objektid WHERE id=$1 AND ettevote_id=$2`, [b.objekt_id, ettevoteId]);
    if (!o.rowCount) return res.json({ ok: false, veateade: 'Tööosa ei leitud' });
    objektId = o.rows[0].id;
  }
  const tyhi = b.naabri_protsent === null || b.naabri_protsent === undefined || String(b.naabri_protsent).trim() === '';
  const p = tyhi ? null : loeProtsent(b.naabri_protsent);
  if (!tyhi && p === null) return res.json({ ok: false, veateade: 'Osa peab olema 0–100%' });

  await pool.query(`UPDATE tookirjed SET objekt_id=$1 WHERE id=$2`, [objektId, req.params.id]);
  if (p === null) {
    await pool.query(`DELETE FROM remont_too_jaotus WHERE tookirje_id=$1`, [req.params.id]);
  } else {
    await pool.query(
      `INSERT INTO remont_too_jaotus (tookirje_id, naabri_protsent) VALUES ($1, $2)
       ON CONFLICT (tookirje_id) DO UPDATE SET naabri_protsent = EXCLUDED.naabri_protsent`,
      [req.params.id, p]
    );
  }
  res.json({ ok: true });
});

// ── ADMIN: MATERJALID (TŠEKID) ────────────────────────────────────────────
// Tšekk sisestatakse TOODETE KAUPA: igal real on oma summa ja oma jaotus (mitu % on teise osapoole
// kanda). Tšeki foto/PDF loeb AI (sama lugeja mis Arvete lehel, vt ailugeja.js) ja pakub read ette.
// Soovi korral läheb sama tšekk ka Royal Paigalduse raamatupidamisse (Arved → sissetulevad, tabel
// arve_sisse) — siis on fail arve_sisse kirje oma ja remont_kulud viitab sellele (arve_sisse_id).

async function laeDokument(fail) {
  const tyyp = fail.mimetype === 'application/pdf' ? 'raw' : 'image';
  const seaded = { folder: 'royal-paigaldus/telje10', resource_type: tyyp };
  if (tyyp === 'raw') {
    // PDF vajab laiendiga nime, muidu ei ava brauser seda õigesti (sama lahendus mis routes/arved.js-is).
    seaded.public_id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  } else {
    seaded.quality = 'auto';
  }
  const tulemus = await new Promise((resolve, reject) => {
    const stream = getCloudinary().uploader.upload_stream(seaded, (err, result) => err ? reject(err) : resolve(result));
    stream.end(fail.buffer);
  });
  return { url: tulemus.secure_url, public_id: tulemus.public_id, tyyp };
}
async function kustutaFail(fail) {
  if (!fail || !fail.public_id) return;
  try { await getCloudinary().uploader.destroy(fail.public_id, { resource_type: fail.tyyp || 'image' }); } catch (e) {}
}

// AI loeb tšekilt müüja, kuupäeva, summad ja tooteread. Midagi ei salvestata — admin vaatab üle.
// req — päring, millel on req.file (ja soovi korral req.aiPildid); tagastab vastuse objekti.
async function loeTsekk(req) {
  const juhis = `Sa vaatad ühte ehitusmaterjalide OSTUTŠEKKI või ostuarvet. Loe sellelt välja müüja, kuupäev ja KÕIK ostetud tooted.
Vasta AINULT ühe JSON-objektiga, ilma muu tekstita, koodiplokkideta. Väljad:
"ettevote": "müüja (poe) nimi, nt Bauhof, Espak, K-Rauta; mitte ostja nimi",
"kuupaev": "YYYY-MM-DD (tšeki/arve kuupäev)",
"read": [{"nimetus": "toote nimetus nii nagu tšekil, lühidalt ja loetavalt", "kogus": "kogus koos ühikuga, nt 12 tk või 3,5 m (tühi, kui pole kirjas)", "summa": <selle rea LÕPPSUMMA numbrina — kogus korda hind, pärast allahindlust>}]
ning allpool kirjeldatud summaväljad.
Ridade reeglid:
- Iga ostetud toode on eraldi rida. Ära jäta ühtegi toodet vahele ja ära liida tooteid kokku.
- "summa" on rea kogusumma (mitte ühiku hind). Loe number tšekilt, ära arvuta.
- Kui allahindlus, pandipakend, transport või muu tasu on tšekil eraldi real, pane see ka eraldi reana (allahindlus negatiivse summaga).
- Ära pane ridade hulka vahesummat, käibemaksu, lõppsummat, makseviisi ega tagasiraha.
Kui mõnda tekstivälja ei leia, kasuta tühja stringi; kui summat ei leia, kasuta 0.`;
  const t = await loeDokument(req, juhis, { summad: true, maxTokens: 4000 });
  if (!t.ok) return { ok: false, veateade: t.veateade };
  const kokku = t.summad.kokku, kmTa = t.summad.summa_km_ta;
  let read = (Array.isArray(t.valjad.read) ? t.valjad.read : [])
    .map(x => {
      const nimetus = String((x && x.nimetus) || '').trim();
      const kogus = String((x && x.kogus) || '').trim();
      return { nimetus: (nimetus + (kogus ? ` (${kogus})` : '')).slice(0, 200), summa: r2(aiArv(x && x.summa)) };
    })
    .filter(x => x.nimetus && x.summa !== 0)
    .slice(0, 80);
  // Arvetel on read sageli ILMA käibemaksuta, tšekkidel koos käibemaksuga. Jagamiseks on vaja summat,
  // mis tegelikult maksti — kui read annavad kokku käibemaksuta summa, lisame igale reale käibemaksu.
  const ridadeSumma = r2(read.reduce((s, x) => s + x.summa, 0));
  let ridadeMarkus = '';
  if (read.length && kokku > 0 && Math.abs(ridadeSumma - kokku) > 0.02 && kmTa > 0 && Math.abs(ridadeSumma - kmTa) <= 0.05) {
    const kordaja = kokku / ridadeSumma;
    let jaak = kokku;
    read = read.map((x, i) => {
      const s = i === read.length - 1 ? r2(jaak) : r2(x.summa * kordaja);
      jaak = r2(jaak - s);
      return { nimetus: x.nimetus, summa: s };
    });
    ridadeMarkus = 'Arvel olid read käibemaksuta — lisasin igale reale käibemaksu, et summa klapiks makstuga.';
  }
  return {
    ok: true,
    ettevote: String(t.valjad.ettevote || '').trim().slice(0, 200),
    kuupaev: puhasKuupaev(t.valjad.kuupaev),
    summa: kokku, kaibemaks: t.summad.kaibemaks, km_kontroll: t.summad.km_kontroll,
    read, ridade_markus: ridadeMarkus
  };
}

router.post('/kulud/loe', noudaAdmin, aiFailid(uploadDok), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Faili ei leitud' });
  res.json(await loeTsekk(req));
});

// "Detailne jagamine" juba salvestatud tšekile: loeb tooted varem üles laetud failist.
function failiTyyp(puhver) {
  const algus = puhver.slice(0, 12);
  if (algus.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (algus[0] === 0xFF && algus[1] === 0xD8) return 'image/jpeg';
  if (algus.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (algus.slice(0, 4).toString('latin1') === 'RIFF' && algus.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (algus.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return null;
}
router.post('/kulud/:id/loe', noudaAdmin, async (req, res) => {
  const v = await pool.query(`SELECT foto_url, foto_arvest, arve_sisse_id FROM remont_kulud WHERE id=$1`, [req.params.id]);
  if (!v.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
  const k = v.rows[0];
  if (!k.foto_url || (k.foto_arvest && !k.arve_sisse_id)) return res.json({ ok: false, veateade: 'Sellel tšekil pole faili — lisa foto või PDF' });
  let puhver;
  try { puhver = await laadiPuhver(k.foto_url, 20000); } catch (e) {
    return res.json({ ok: false, veateade: 'Tšeki faili ei saanud avada' });
  }
  const tyyp = failiTyyp(puhver);
  if (!tyyp) return res.json({ ok: false, veateade: 'Tšeki faili vormingut ei tuntud ära' });
  res.json(await loeTsekk({ file: { buffer: puhver, mimetype: tyyp }, aiPildid: [] }));
});

// Kontrollib vormi ja arvutab jaotuse. Tagastab { viga } või valmis väljad.
function loeKulu(b) {
  const kirjeldus = String(b.kirjeldus || '').trim().slice(0, 500);
  const summa = loeArv(b.summa);
  const kaibemaks = loeArv(b.kaibemaks);
  const maksja = b.maksja === 'naaber' ? 'naaber' : 'mina';
  if (!onKuupaev(b.kuupaev)) return { viga: 'Vali kuupäev' };
  if (!kirjeldus) return { viga: 'Kirjuta, kust osteti' };
  if (!Number.isFinite(summa) || summa <= 0) return { viga: 'Tšeki summa peab olema positiivne arv' };
  let sisend;
  try { sisend = typeof b.read === 'string' ? JSON.parse(b.read) : b.read; } catch (e) { sisend = null; }
  if (!Array.isArray(sisend) || !sisend.length) return { viga: 'Lisa vähemalt üks toode' };
  if (sisend.length > 200) return { viga: 'Liiga palju ridu' };
  const read = [];
  for (const x of sisend) {
    const nimetus = String((x && x.nimetus) || '').trim().slice(0, 200);
    const rs = loeArv(x && x.summa);
    const p = loeProtsent(x && x.naabri_protsent);
    if (!nimetus) return { viga: 'Igal real peab olema nimetus' };
    if (!Number.isFinite(rs) || rs === 0) return { viga: `Kontrolli rea „${nimetus}" summat` };
    if (p === null) return { viga: `Rea „${nimetus}" jaotus peab olema 0–100%` };
    read.push({ nimetus, summa: r2(rs), protsent: p, naabriSumma: r2(rs * p / 100) });
  }
  const ridadeSumma = r2(read.reduce((s, x) => s + x.summa, 0));
  if (Math.abs(ridadeSumma - r2(summa)) > 0.02) {
    return { viga: `Read annavad kokku ${ridadeSumma.toFixed(2)} €, aga tšeki summa on ${r2(summa).toFixed(2)} € — paranda read või summa` };
  }
  const naabriSumma = Math.max(0, Math.min(r2(summa), r2(read.reduce((s, x) => s + x.naabriSumma, 0))));
  return {
    kuupaev: b.kuupaev, kirjeldus, summa: r2(summa), maksja, read, naabriSumma,
    kaibemaks: Number.isFinite(kaibemaks) && kaibemaks >= 0 && kaibemaks < summa ? r2(kaibemaks) : 0,
    arvetesse: b.arvetesse === '1' || b.arvetesse === true || b.arvetesse === 'true'
  };
}

// Salvestab tšeki (uue või olemasoleva), selle read ja vajadusel kirje Royal Paigalduse arvetes.
async function salvestaKulu(k, uusFail, id) {
  // Praegune seis: kulu ise ja sellega seotud arve (kui on). Fail kuulub kas arvele või kulule.
  let vana = null, arve = null, fail = null;
  if (id) {
    const v = await pool.query(`SELECT * FROM remont_kulud WHERE id=$1`, [id]);
    if (!v.rowCount) return { viga: 'Kirjet ei leitud' };
    vana = v.rows[0];
    if (vana.arve_sisse_id) {
      const a = await pool.query(`SELECT id, fail_url, fail_public_id, fail_resource_type FROM arve_sisse WHERE id=$1`, [vana.arve_sisse_id]);
      arve = a.rows[0] || null;
    }
    if (arve) {
      if (arve.fail_url) fail = { url: arve.fail_url, public_id: arve.fail_public_id, tyyp: arve.fail_resource_type || 'image' };
    } else if (vana.foto_url && !vana.foto_arvest) {
      fail = { url: vana.foto_url, public_id: vana.foto_public_id, tyyp: vana.foto_tyyp || 'image' };
    }
  }
  if (uusFail) {
    const laetud = await laeDokument(uusFail);
    await kustutaFail(fail);
    fail = laetud;
  }

  const klient = await pool.connect();
  try {
    await klient.query('BEGIN');
    let arveId = arve ? arve.id : null;
    if (k.arvetesse) {
      const s = await klient.query(`SELECT ettevote_id FROM remont_seaded WHERE id=1`);
      const vaartused = [k.kuupaev, s.rows[0].ettevote_id, k.kirjeldus, k.summa, k.kaibemaks,
        fail ? fail.url : null, fail ? fail.public_id : null, fail ? fail.tyyp : null];
      if (arveId) {
        await klient.query(
          `UPDATE arve_sisse SET kuupaev=$1, ettevote_id=$2, kirjeldus=$3, summa=$4, kaibemaks=$5,
             fail_url=$6, fail_public_id=$7, fail_resource_type=$8 WHERE id=$9`, vaartused.concat([arveId]));
      } else {
        // Sama mis kiirtšekil Arvete lehel: kulu läheb vaikimisi müüja (Royal Paigaldus) alla, staatus makstud.
        const m = await klient.query(`SELECT id FROM arve_muujad WHERE vaikimisi=true LIMIT 1`);
        const a = await klient.query(
          `INSERT INTO arve_sisse (kuupaev, ettevote_id, kirjeldus, summa, kaibemaks, fail_url, fail_public_id, fail_resource_type, staatus, muuja_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'makstud',$9) RETURNING id`, vaartused.concat([m.rows.length ? m.rows[0].id : null]));
        arveId = a.rows[0].id;
      }
    } else if (arveId) {
      // Võeti arvetest välja — arve kirje kustub, fail jääb alles ja kuulub edasi tšekile.
      await klient.query(`DELETE FROM arve_sisse WHERE id=$1`, [arveId]);
      arveId = null;
    }
    const valjad = [k.kuupaev, k.kirjeldus, k.summa, k.maksja, k.naabriSumma, k.kaibemaks,
      fail ? fail.url : null, arveId ? null : (fail ? fail.public_id : null), fail ? fail.tyyp : null, !!arveId, arveId];
    let kuluId = id;
    if (id) {
      await klient.query(
        `UPDATE remont_kulud SET kuupaev=$1, kirjeldus=$2, summa=$3, maksja=$4, jaotus='read', naabri_protsent=NULL,
           naabri_summa=$5, kaibemaks=$6, foto_url=$7, foto_public_id=$8, foto_tyyp=$9, foto_arvest=$10, arve_sisse_id=$11,
           objekt_id=NULL WHERE id=$12`, valjad.concat([id]));
      await klient.query(`DELETE FROM remont_kulu_read WHERE kulu_id=$1`, [id]);
    } else {
      const r = await klient.query(
        `INSERT INTO remont_kulud (kuupaev, kirjeldus, summa, maksja, jaotus, naabri_summa, kaibemaks,
           foto_url, foto_public_id, foto_tyyp, foto_arvest, arve_sisse_id)
         VALUES ($1,$2,$3,$4,'read',$5,$6,$7,$8,$9,$10,$11) RETURNING id`, valjad);
      kuluId = r.rows[0].id;
    }
    for (let i = 0; i < k.read.length; i++) {
      const x = k.read[i];
      await klient.query(
        `INSERT INTO remont_kulu_read (kulu_id, jrk, nimetus, summa, naabri_protsent, naabri_summa) VALUES ($1,$2,$3,$4,$5,$6)`,
        [kuluId, i + 1, x.nimetus, x.summa, x.protsent, x.naabriSumma]
      );
    }
    await klient.query('COMMIT');
    return { id: kuluId, arvetes: !!arveId };
  } catch (err) {
    await klient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    klient.release();
  }
}

router.post('/kulud', noudaAdmin, uploadDok.single('fail'), async (req, res) => {
  const k = loeKulu(req.body || {});
  if (k.viga) return res.json({ ok: false, veateade: k.viga });
  const t = await salvestaKulu(k, req.file, null);
  if (t.viga) return res.json({ ok: false, veateade: t.viga });
  res.json({ ok: true, id: t.id, arvetes: t.arvetes });
});

router.post('/kulud/:id/uuenda', noudaAdmin, uploadDok.single('fail'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
  const k = loeKulu(req.body || {});
  if (k.viga) return res.json({ ok: false, veateade: k.viga });
  const t = await salvestaKulu(k, req.file, id);
  if (t.viga) return res.json({ ok: false, veateade: t.viga });
  res.json({ ok: true, id: t.id, arvetes: t.arvetes });
});

// Kustutab tšeki. Kui see oli ka Royal Paigalduse arvetes, kustub ka sealne kirje koos failiga.
router.delete('/kulud/:id', noudaAdmin, async (req, res) => {
  const v = await pool.query(`SELECT * FROM remont_kulud WHERE id=$1`, [req.params.id]);
  if (!v.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
  const k = v.rows[0];
  if (k.arve_sisse_id) {
    const a = await pool.query(`DELETE FROM arve_sisse WHERE id=$1 RETURNING fail_public_id, fail_resource_type`, [k.arve_sisse_id]);
    if (a.rowCount) await kustutaFail({ public_id: a.rows[0].fail_public_id, tyyp: a.rows[0].fail_resource_type });
  } else if (!k.foto_arvest) {
    await kustutaFail({ public_id: k.foto_public_id, tyyp: k.foto_tyyp });
  }
  await pool.query(`DELETE FROM remont_kulud WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── ADMIN: MAKSED ─────────────────────────────────────────────────────────
router.post('/maksed', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const summa = loeArv(b.summa);
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  if (!Number.isFinite(summa) || summa <= 0) return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  await pool.query(
    `INSERT INTO remont_maksed (kuupaev, summa, suund, kommentaar) VALUES ($1,$2,$3,$4)`,
    [b.kuupaev, r2(summa), b.suund === 'naabrile' ? 'naabrile' : 'naabrilt', String(b.kommentaar || '').trim().slice(0, 300)]
  );
  res.json({ ok: true });
});

router.delete('/maksed/:id', noudaAdmin, async (req, res) => {
  const r = await pool.query(`DELETE FROM remont_maksed WHERE id=$1`, [req.params.id]);
  if (!r.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
  res.json({ ok: true });
});

// ── EXCEL (admin + naaber) ────────────────────────────────────────────────
// Sama kujundus mis admini raportil: tumesinine pealkiri, punane päis, vahelduvad read, sinine KOKKU-rida.
router.get('/excel', noudaVaatajat, async (req, res) => {
  const ExcelJS = require('exceljs');
  const d = await koguAndmed();
  const s = d.seaded, k = d.kokku;
  const wb = new ExcelJS.Workbook();
  const RAHA = '#,##0.00 "€"';
  const piir = { style: 'thin', color: { argb: 'FFB8CCE4' } };
  const raam = { top: piir, bottom: piir, left: piir, right: piir };

  // Üks tabelileht. veerud: [{ pealkiri, laius, fmt }], read: massiivid, kokku: massiiv (või null).
  function leht(nimi, pealkiri, veerud, read, kokku) {
    const ws = wb.addWorksheet(nimi);
    const n = veerud.length;
    ws.mergeCells(1, 1, 1, n);
    const t = ws.getCell(1, 1);
    t.value = pealkiri;
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    t.font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 34;
    const hdr = ws.getRow(2);
    hdr.height = 32;
    veerud.forEach((v, i) => {
      const c = hdr.getCell(i + 1);
      c.value = v.pealkiri;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } };
      c.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = raam;
      ws.getColumn(i + 1).width = v.laius;
    });
    function kirjuta(rida, vaartused, taust, paks, fondiVarv) {
      vaartused.forEach((val, i) => {
        const c = rida.getCell(i + 1);
        c.value = val === undefined ? null : val;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: taust } };
        c.font = { name: 'Arial', size: 10, bold: paks, color: { argb: fondiVarv } };
        c.border = raam;
        c.alignment = { vertical: 'middle', wrapText: !veerud[i].fmt, horizontal: typeof val === 'number' ? 'right' : 'left' };
        if (veerud[i].fmt && typeof val === 'number') c.numFmt = veerud[i].fmt;
      });
    }
    read.forEach((r, i) => kirjuta(ws.getRow(3 + i), r, i % 2 === 0 ? 'FFFFFFFF' : 'FFDCE6F1', false, 'FF000000'));
    if (kokku) kirjuta(ws.getRow(3 + read.length), kokku, 'FF1F3864', true, 'FFFFFFFF');
    if (read.length) ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: n } };
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    return ws;
  }

  // Leht 1: kokkuvõte
  const wsK = wb.addWorksheet('Kokkuvõte');
  wsK.getColumn(1).width = 52; wsK.getColumn(2).width = 18;
  wsK.mergeCells('A1:B1');
  wsK.getCell('A1').value = `${s.projekti_nimi} — ${s.minu_nimi} ja ${s.naabri_nimi}`;
  wsK.getCell('A1').font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  wsK.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  wsK.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  wsK.getRow(1).height = 32;
  wsK.mergeCells('A2:B2');
  const tana = new Date().toISOString().slice(0, 10);
  wsK.getCell('A2').value = `Seis ${kpEt(tana)} · tunnihind ${s.tunnihind.toFixed(2)} €/h (käibemaksuta)`;
  wsK.getCell('A2').font = { name: 'Arial', italic: true, color: { argb: 'FF666666' } };
  let rida = 4;
  function kv(silt, vaartus, fmt, paks) {
    wsK.getCell('A' + rida).value = silt;
    wsK.getCell('A' + rida).font = { name: 'Arial', bold: !!paks };
    const c = wsK.getCell('B' + rida);
    c.value = vaartus;
    c.font = { name: 'Arial', bold: !!paks };
    if (fmt) c.numFmt = fmt;
    rida++;
  }
  kv('TÖÖ', null, null, true);
  kv('Töötunde kokku', k.tunnid, '0.00 "h"');
  kv(`${s.naabri_nimi} osa tundidest`, k.naabri_tunnid, '0.00 "h"');
  kv(`${s.naabri_nimi} töö eest (${s.tunnihind.toFixed(2)} €/h)`, k.naabri_too, RAHA, true);
  rida++;
  kv('MATERJALID', null, null, true);
  kv('Materjale ostetud kokku', k.materjal, RAHA);
  kv(`${s.naabri_nimi} osa materjalidest`, k.naabri_materjal, RAHA);
  kv(`${s.minu_nimi} osa materjalidest`, k.minu_materjal, RAHA);
  rida++;
  kv('ARVELDUS', null, null, true);
  kv(`${s.naabri_nimi} töö eest`, k.naabri_too, RAHA);
  kv(`+ ${s.naabri_nimi} osa ${s.minu_nimi} ostudest`, k.minu_ostudest_naabri_osa, RAHA);
  kv(`− ${s.minu_nimi} osa ${s.naabri_nimi} ostudest`, -k.naabri_ostudest_minu_osa, RAHA);
  kv(`− ${s.naabri_nimi} on tasunud`, -k.makstud_naabrilt, RAHA);
  if (k.makstud_naabrile) kv(`+ ${s.minu_nimi} on tagasi maksnud`, k.makstud_naabrile, RAHA);
  kv(k.saldo >= 0 ? `${s.naabri_nimi} tasuda jäänud` : `${s.minu_nimi} tasuda jäänud`, Math.abs(k.saldo), RAHA, true);
  if (k.maaramata_toid) {
    rida++;
    kv(`NB! ${k.maaramata_toid} töökirjel on jaotus veel määramata — need pole summades sees.`, null, null, true);
  }

  // Leht 2: tööd
  const vanimEes = (a, b) => a.kuupaev.localeCompare(b.kuupaev) || a.id - b.id;
  const tood = d.tood.slice().sort(vanimEes);
  leht('Tööd', `Tehtud tööd — ${s.tunnihind.toFixed(2)} €/h`, [
    { pealkiri: 'Kuupäev', laius: 12 }, { pealkiri: 'Tööosa', laius: 26 }, { pealkiri: 'Töötaja', laius: 20 },
    { pealkiri: 'Kirjeldus', laius: 44 }, { pealkiri: 'Tunnid', laius: 10, fmt: '0.00' },
    { pealkiri: `${s.naabri_nimi} osa %`, laius: 12, fmt: '0.##"%"' },
    { pealkiri: `${s.naabri_nimi} tunnid`, laius: 12, fmt: '0.00' },
    { pealkiri: `${s.naabri_nimi} summa`, laius: 14, fmt: RAHA }
  ], tood.map(t => [
    kpEt(t.kuupaev), t.osa_nimi || '—', t.tootaja, t.kommentaar, t.tunnid,
    t.naabri_protsent === null ? 'määramata' : t.naabri_protsent, t.naabri_tunnid, t.naabri_summa
  ]), ['KOKKU', '', '', '', k.tunnid, '', k.naabri_tunnid, k.naabri_too]);

  // Leht 3: materjalid
  const kulud = d.kulud.slice().sort(vanimEes);
  leht('Materjalid', 'Materjalid ja tšekid', [
    { pealkiri: 'Kuupäev', laius: 12 }, { pealkiri: 'Mis osteti', laius: 40 }, { pealkiri: 'Tööosa', laius: 24 },
    { pealkiri: 'Kes maksis', laius: 14 }, { pealkiri: 'Summa', laius: 14, fmt: RAHA },
    { pealkiri: `${s.minu_nimi} osa`, laius: 14, fmt: RAHA }, { pealkiri: `${s.naabri_nimi} osa`, laius: 14, fmt: RAHA },
    { pealkiri: 'Tšeki foto', laius: 50 }
  ], kulud.map(x => [
    kpEt(x.kuupaev), x.kirjeldus, x.osa_nimi || '—', x.maksja === 'naaber' ? s.naabri_nimi : s.minu_nimi,
    x.summa, x.minu_summa, x.naabri_summa, x.foto_url || 'puudub'
  ]), ['KOKKU', '', '', '', k.materjal, k.minu_materjal, k.naabri_materjal, '']);

  // Leht: tooted (tšekkide read)
  const tooteRead = [];
  kulud.forEach(x => (x.read || []).forEach(rd => tooteRead.push([
    kpEt(x.kuupaev), x.kirjeldus, rd.nimetus, rd.summa, rd.naabri_protsent, r2(rd.summa - rd.naabri_summa), rd.naabri_summa
  ])));
  if (tooteRead.length) {
    leht('Tooted', 'Tooted tšekkide kaupa', [
      { pealkiri: 'Kuupäev', laius: 12 }, { pealkiri: 'Tšekk', laius: 30 }, { pealkiri: 'Toode', laius: 46 },
      { pealkiri: 'Summa', laius: 13, fmt: RAHA }, { pealkiri: `${s.naabri_nimi} osa %`, laius: 12, fmt: '0.##"%"' },
      { pealkiri: `${s.minu_nimi} osa`, laius: 13, fmt: RAHA }, { pealkiri: `${s.naabri_nimi} osa`, laius: 13, fmt: RAHA }
    ], tooteRead, null);
  }

  // Leht 4: maksed
  const maksed = d.maksed.slice().sort(vanimEes);
  leht('Maksed', 'Omavahelised maksed', [
    { pealkiri: 'Kuupäev', laius: 12 }, { pealkiri: 'Kes kellele', laius: 30 },
    { pealkiri: 'Summa', laius: 14, fmt: RAHA }, { pealkiri: 'Selgitus', laius: 44 }
  ], maksed.map(m => [
    kpEt(m.kuupaev),
    m.suund === 'naabrile' ? `${s.minu_nimi} → ${s.naabri_nimi}` : `${s.naabri_nimi} → ${s.minu_nimi}`,
    m.summa, m.kommentaar
  ]), null);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', failiPais(`${s.projekti_nimi}_${tana}.xlsx`));
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
