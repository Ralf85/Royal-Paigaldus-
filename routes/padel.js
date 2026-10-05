const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { saadaTeavitus } = require('./push');
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

// Padeli maksete lisaveerg: koht_id seob makse konkreetse trenniga ("Siim kandis 30.09 trenni eest").
// Lisatakse automaatselt serveri käivitumisel (IF NOT EXISTS — ohutu korduvalt jooksutada).
const maksedVeergValmis = pool.query(
  `ALTER TABLE padel_maksed ADD COLUMN IF NOT EXISTS koht_id INTEGER REFERENCES padel_kohad(id) ON DELETE SET NULL`
).catch(err => console.error('padel_maksed.koht_id lisamine ebaõnnestus:', err.message));

// Mängija pilt: 1) selle grupi Padeli pilt, 2) mõne teise grupi Padeli pilt, 3) peaadmini töötajapilt.
function fotoSql(alias) {
  return `COALESCE(${alias}.foto_url,
    (SELECT pf.foto_url FROM padel_liikmed pf WHERE pf.worker_id = ${alias}.worker_id AND pf.foto_url IS NOT NULL ORDER BY pf.id DESC LIMIT 1),
    (SELECT af.foto_url FROM tootaja_admin_fotod af WHERE af.worker_id = ${alias}.worker_id LIMIT 1))`;
}

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}
function noudaSisslogimist(req, res, next) {
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}
// Admin pääseb alati ligi, töötaja peab olema eraldi lubatud (padel_lubatud) — sama muster,
// mida kasutavad X-seeria/Arved (raamatupidaja saab hiljem oma töötaja-PIN-i).
async function noudaPadelLigipaas(req, res, next) {
  if (!req.session) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  if (req.session.isAdmin) return next();
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  try {
    const r = await pool.query('SELECT 1 FROM padel_lubatud WHERE worker_id=$1', [req.session.workerId]);
    if (!r.rows.length) return res.status(403).json({ ok: false, veateade: 'Padel ligipääs puudub' });
    next();
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
}

// ── GRUPI LIIKMELISUSE KONTROLL ───────────────────────────────────────────
// Padeli ligipääsust üksi ei piisa: mängija tohib näha ja muuta ainult NENDE gruppide trenne,
// kuhu ta ise kuulub (uksekood, kellaaeg, paarid, tulemused, sõnumid). Oma grupi sees jääb
// kõigile liikmetele endine vabadus. Admin pääseb igale poole.
// allikas: 'ryhm' (:id on grupi id), 'nadal' (:id on trenni id) või 'koht' (:id on trennikoha id).
function noudaRyhmaLiige(allikas) {
  const paring = {
    ryhm: 'SELECT $1::int AS ryhm_id',
    nadal: 'SELECT ryhm_id FROM padel_nadalad WHERE id=$1::int',
    koht: 'SELECT pn.ryhm_id FROM padel_kohad pk JOIN padel_nadalad pn ON pn.id = pk.nadal_id WHERE pk.id=$1::int'
  }[allikas];
  return async (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, veateade: 'Vale päring' });
    try {
      const r = await pool.query(paring, [id]);
      if (!r.rows.length) return res.json({ ok: false, veateade: 'Ei leitud' });
      const liige = await pool.query('SELECT 1 FROM padel_liikmed WHERE ryhm_id=$1 AND worker_id=$2', [r.rows[0].ryhm_id, req.session.workerId]);
      if (!liige.rows.length) return res.status(403).json({ ok: false, veateade: 'Sa pole selle grupi liige' });
      next();
    } catch (err) {
      res.status(500).json({ ok: false, veateade: 'Serveri viga' });
    }
  };
}

// Kas mul on ligipääs Padel moodulile? (kasutab liides, et otsustada, kas lehte üldse näidata)
router.get('/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    if (req.session.isAdmin) return res.json({ ok: true, lubatud: true, worker_id: req.session.workerId || null, worker_nimi: req.session.workerNimi || 'Admin' });
    const r = await pool.query('SELECT 1 FROM padel_lubatud WHERE worker_id=$1', [req.session.workerId]);
    res.json({ ok: true, lubatud: r.rows.length > 0, worker_id: req.session.workerId, worker_nimi: req.session.workerNimi || '' });
  } catch (err) {
    res.json({ ok: false, lubatud: false });
  }
});

// ── ADMIN: LIGIPÄÄS ────────────────────────────────────────────────────
router.get('/admin/lubatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi, (pl.worker_id IS NOT NULL) AS lubatud
       FROM workers w
       LEFT JOIN padel_lubatud pl ON pl.worker_id = w.id
       WHERE w.aktiivne = true
       ORDER BY w.nimi`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.post('/admin/lubatud/:workerId', noudaAdmin, async (req, res) => {
  const { lubatud } = req.body;
  try {
    if (lubatud) await pool.query('INSERT INTO padel_lubatud (worker_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.params.workerId]);
    else await pool.query('DELETE FROM padel_lubatud WHERE worker_id=$1', [req.params.workerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: GRUPID JA LIIKMED ───────────────────────────────────────────
router.get('/admin/ryhmad', noudaAdmin, async (req, res) => {
  try {
    const ryhmadR = await pool.query('SELECT * FROM padel_ryhmad ORDER BY nimi');
    const liikmedR = await pool.query(
      `SELECT pl.id, pl.ryhm_id, pl.worker_id, pl.jrk_nr, ${fotoSql('pl')} AS foto_url, w.nimi
       FROM padel_liikmed pl JOIN workers w ON w.id = pl.worker_id
       ORDER BY pl.ryhm_id, pl.jrk_nr`
    );
    const ryhmad = ryhmadR.rows.map(r => ({ ...r, liikmed: liikmedR.rows.filter(l => l.ryhm_id === r.id) }));
    res.json({ ok: true, ryhmad });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.post('/admin/ryhmad', noudaAdmin, async (req, res) => {
  const { nimi, hind } = req.body;
  if (!nimi || !nimi.trim()) return res.json({ ok: false, veateade: 'Sisesta grupi nimi' });
  try {
    const r = await pool.query('INSERT INTO padel_ryhmad (nimi, hind) VALUES ($1,$2) RETURNING *', [nimi.trim(), parseFloat(hind) || 15.50]);
    res.json({ ok: true, ryhm: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.put('/admin/ryhmad/:id', noudaAdmin, async (req, res) => {
  const { nimi, hind, aktiivne } = req.body;
  try {
    await pool.query('UPDATE padel_ryhmad SET nimi=$1, hind=$2, aktiivne=$3 WHERE id=$4',
      [nimi, parseFloat(hind) || 15.50, aktiivne !== false, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
// Grupi vaikimisi trenni algusaeg (kohaldub uutele genereeritud/loodud trennidele)
router.put('/admin/ryhmad/:id/kellaaeg', noudaAdmin, async (req, res) => {
  const kellaaeg = (req.body.kellaaeg || '').trim();
  if (kellaaeg && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kellaaeg)) return res.json({ ok: false, veateade: 'Vale kellaaja formaat (nt 18:30)' });
  try {
    await pool.query('UPDATE padel_ryhmad SET vaikimisi_kellaaeg=$1 WHERE id=$2', [kellaaeg || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.post('/admin/ryhmad/:id/liikmed', noudaAdmin, async (req, res) => {
  const { worker_id } = req.body;
  if (!worker_id) return res.json({ ok: false, veateade: 'Vali töötaja' });
  try {
    const jrkR = await pool.query('SELECT COALESCE(MAX(jrk_nr),-1)+1 AS jrk FROM padel_liikmed WHERE ryhm_id=$1', [req.params.id]);
    await pool.query('INSERT INTO padel_liikmed (ryhm_id, worker_id, jrk_nr) VALUES ($1,$2,$3)', [req.params.id, worker_id, jrkR.rows[0].jrk]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See töötaja on juba selles grupis' });
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.delete('/admin/liikmed/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM padel_liikmed WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Liikme profiilipilt — admin või liige ise (noudaPadelLigipaas piisab, sama loogika mis mujal Padelis)
router.post('/liikmed/:id/foto', noudaPadelLigipaas, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Pilti ei leitud' });
  try {
    const vana = await pool.query('SELECT foto_public_id, worker_id FROM padel_liikmed WHERE id=$1', [req.params.id]);
    if (!vana.rows.length) return res.json({ ok: false, veateade: 'Liiget ei leitud' });
    if (!req.session.isAdmin && vana.rows[0].worker_id !== req.session.workerId) {
      return res.status(403).json({ ok: false, veateade: 'Pilti saab muuta ainult mängija ise' });
    }
    if (vana.rows[0].foto_public_id) {
      try { await getCloudinary().uploader.destroy(vana.rows[0].foto_public_id); } catch (e) {}
    }
    const result = await new Promise((resolve, reject) => {
      const stream = getCloudinary().uploader.upload_stream(
        { folder: 'royal-paigaldus/padel', resource_type: 'image', quality: 'auto', transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }] },
        (err, result) => err ? reject(err) : resolve(result)
      );
      stream.end(req.file.buffer);
    });
    await pool.query('UPDATE padel_liikmed SET foto_url=$1, foto_public_id=$2 WHERE id=$3', [result.secure_url, result.public_id, req.params.id]);
    res.json({ ok: true, foto_url: result.secure_url });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admini vaade asendajate maksete kohta (asendajatel endil pole kontot, ei näe oma saldot ise)
router.get('/admin/ryhmad/:id/asendaja-maksed', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pk.id, pn.kuupaev, pk.asendaja_nimi, pk.makstud, pk.summa, l.nimi AS asendas_keda
       FROM padel_kohad pk
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       JOIN padel_liikmed pl ON pl.id = pk.liige_id
       JOIN workers l ON l.id = pl.worker_id
       WHERE pn.ryhm_id = $1 AND pk.osaleb = false AND pk.asendaja_nimi IS NOT NULL
       ORDER BY pn.kuupaev DESC`,
      [req.params.id]
    );
    res.json({ ok: true, kirjed: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
// Kustuta üks trenn täielikult (nt kogemata loodud/testitud trenn)
router.delete('/admin/nadalad/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM padel_nadalad WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: TRENNI MÄNGIJATE HALDUS ─────────────────────────────────────
// Admin lisab mängija otse trennile (Paar 1 / Paar 2 / Ootele) — koht on KOHE kinnitatud.
router.post('/admin/nadalad/:id/lisa', noudaAdmin, async (req, res) => {
  const paar = req.body.paar === 1 || req.body.paar === 2 ? req.body.paar : null;
  const liigeId = parseInt(req.body.liige_id, 10);
  if (!liigeId) return res.json({ ok: false, veateade: 'Vali mängija' });
  try {
    const nadalR = await pool.query(
      `SELECT pn.ryhm_id, r.hind FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id WHERE pn.id=$1`,
      [req.params.id]
    );
    if (!nadalR.rows.length) return res.json({ ok: false, veateade: 'Trenni ei leitud' });
    const { ryhm_id, hind } = nadalR.rows[0];

    const liigeR = await pool.query('SELECT id FROM padel_liikmed WHERE id=$1 AND ryhm_id=$2', [liigeId, ryhm_id]);
    if (!liigeR.rows.length) return res.json({ ok: false, veateade: 'See inimene ei ole selle grupi liige' });

    if (paar) {
      const kohtiR = await pool.query(
        'SELECT COUNT(*) c FROM padel_kohad WHERE nadal_id=$1 AND paar=$2 AND liige_id<>$3',
        [req.params.id, paar, liigeId]
      );
      if (parseInt(kohtiR.rows[0].c, 10) >= 2) return res.json({ ok: false, veateade: `Paar ${paar} on juba täis` });
    }

    await pool.query(
      `INSERT INTO padel_kohad (nadal_id, liige_id, paar, osaleb, kinnitatud, summa) VALUES ($1,$2,$3,true,true,$4)
       ON CONFLICT (nadal_id, liige_id) DO UPDATE SET paar=$3, osaleb=true, kinnitatud=true`,
      [req.params.id, liigeId, paar, hind]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin kinnitab (või võtab kinnituse maha) ühe mängija koha trennil
router.put('/admin/kohad/:id/kinnitatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('UPDATE padel_kohad SET kinnitatud=$1 WHERE id=$2 RETURNING id', [req.body.kinnitatud !== false, req.params.id]);
    if (!r.rows.length) return res.json({ ok: false, veateade: 'Kohta ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Admin kinnitab korraga kõik selle trenni registreerunud mängijad
router.post('/admin/nadalad/:id/kinnita-koik', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('UPDATE padel_kohad SET kinnitatud=true WHERE nadal_id=$1 AND kinnitatud=false', [req.params.id]);
    res.json({ ok: true, kinnitati: r.rowCount });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/admin/kohad/:id/makse', noudaAdmin, async (req, res) => {
  const { makstud } = req.body;
  try {
    await pool.query('UPDATE padel_kohad SET makstud=$1 WHERE id=$2', [!!makstud, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── LIIKME ENDA VAADE ──────────────────────────────────────────────────
// Minu grupid (nendes, kus ma olen fikseeritud liige)
router.get('/minu', noudaPadelLigipaas, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pl.id AS liige_id, pl.ryhm_id, r.nimi AS ryhm_nimi, r.hind
       FROM padel_liikmed pl JOIN padel_ryhmad r ON r.id = pl.ryhm_id
       WHERE pl.worker_id = $1 AND r.aktiivne = true
       ORDER BY r.nimi`,
      [req.session.workerId]
    );
    res.json({ ok: true, ryhmad: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kogu grupi vaade: liikmed, edetabel, viimased nädalad
router.get('/ryhm/:id', noudaPadelLigipaas, noudaRyhmaLiige('ryhm'), async (req, res) => {
  try {
    const ryhmR = await pool.query('SELECT * FROM padel_ryhmad WHERE id=$1', [req.params.id]);
    if (!ryhmR.rows.length) return res.json({ ok: false, veateade: 'Gruppi ei leitud' });
    const liikmedR = await pool.query(
      `SELECT pl.id, pl.worker_id, pl.jrk_nr, ${fotoSql('pl')} AS foto_url, w.nimi
       FROM padel_liikmed pl JOIN workers w ON w.id = pl.worker_id
       WHERE pl.ryhm_id=$1 ORDER BY pl.jrk_nr`,
      [req.params.id]
    );
    // Iga nädala GEIMIDE SUMMA (kõigi setide peale) ja sellest tulenev PUNKTISKOOR:
    // 2p võidu eest, 1p+1p viigi eest, 0p kaotuse eest. Edetabelis on punktid peamine näitaja.
    const edetabelR = await pool.query(
      `WITH nadal_summa AS (
         SELECT nadal_id, SUM(paar1_geimid) AS p1g, SUM(paar2_geimid) AS p2g
         FROM padel_setid GROUP BY nadal_id
       ),
       nadal_punktid AS (
         SELECT nadal_id, p1g, p2g,
           CASE WHEN p1g > p2g THEN 2 WHEN p1g < p2g THEN 0 ELSE 1 END AS p1p,
           CASE WHEN p2g > p1g THEN 2 WHEN p2g < p1g THEN 0 ELSE 1 END AS p2p
         FROM nadal_summa
       )
       SELECT pk.liige_id,
              COALESCE(SUM(CASE WHEN pk.paar = 1 THEN np.p1p WHEN pk.paar = 2 THEN np.p2p ELSE 0 END), 0) AS punktid,
              COALESCE(SUM(CASE WHEN pk.paar = 1 THEN np.p1g WHEN pk.paar = 2 THEN np.p2g ELSE 0 END), 0) AS geimid_kokku,
              COUNT(np.nadal_id) FILTER (WHERE pk.paar IN (1,2)) AS mange
       FROM padel_kohad pk
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       LEFT JOIN nadal_punktid np ON np.nadal_id = pk.nadal_id
       WHERE pn.ryhm_id = $1
       GROUP BY pk.liige_id`,
      [req.params.id]
    );
    const edetabel = liikmedR.rows.map(l => {
      const rida = edetabelR.rows.find(e => e.liige_id === l.id);
      return {
        liige_id: l.id, nimi: l.nimi, foto_url: l.foto_url,
        punktid: rida ? parseInt(rida.punktid, 10) : 0,
        geimid: rida ? parseInt(rida.geimid_kokku, 10) : 0,
        mange: rida ? parseInt(rida.mange, 10) : 0
      };
    }).sort((a, b) => b.punktid - a.punktid || b.geimid - a.geimid);

    const nadaladR = await pool.query(
      `SELECT pn.*,
              (SELECT json_agg(json_build_object('liige_id', pk.liige_id, 'worker_id', pl2.worker_id, 'paar', pk.paar, 'osaleb', pk.osaleb, 'kinnitatud', pk.kinnitatud, 'nimi', w.nimi, 'foto_url', ${fotoSql('pl2')}, 'id', pk.id, 'makstud', pk.makstud, 'summa', pk.summa))
                FROM padel_kohad pk JOIN padel_liikmed pl2 ON pl2.id = pk.liige_id JOIN workers w ON w.id = pl2.worker_id
                WHERE pk.nadal_id = pn.id) AS kohad,
              (SELECT json_agg(json_build_object('jrk_nr', ps.jrk_nr, 'paar1_geimid', ps.paar1_geimid, 'paar2_geimid', ps.paar2_geimid) ORDER BY ps.jrk_nr)
                FROM padel_setid ps WHERE ps.nadal_id = pn.id) AS setid
       FROM padel_nadalad pn WHERE pn.ryhm_id=$1 ORDER BY pn.kuupaev DESC LIMIT 60`,
      [req.params.id]
    );
    res.json({ ok: true, ryhm: ryhmR.rows[0], liikmed: liikmedR.rows, edetabel, nadalad: nadaladR.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Loo (või tagasta olemasolev) selle nädala trenn. Paare EI looda enam automaatselt —
// mängijad registreerivad end ise ("Mina mängin") ja paarid pannakse käsitsi kokku.
async function looNadalKuiPuudub(ryhmId, kuupaev) {
  const olemasR = await pool.query('SELECT id FROM padel_nadalad WHERE ryhm_id=$1 AND kuupaev=$2', [ryhmId, kuupaev]);
  if (olemasR.rows.length) return { nadal_id: olemasR.rows[0].id, uus: false };

  const liikmedR = await pool.query('SELECT id FROM padel_liikmed WHERE ryhm_id=$1', [ryhmId]);
  if (liikmedR.rows.length < 2) return { veateade: 'Grupis peab olema vähemalt 2 liiget, et nädalat luua' };

  const ryhmR = await pool.query('SELECT vaikimisi_kellaaeg FROM padel_ryhmad WHERE id=$1', [ryhmId]);
  const kellaaeg = ryhmR.rows[0] ? ryhmR.rows[0].vaikimisi_kellaaeg : null;

  const nadalR = await pool.query('INSERT INTO padel_nadalad (ryhm_id, kuupaev, kellaaeg) VALUES ($1,$2,$3) RETURNING id', [ryhmId, kuupaev, kellaaeg]);
  return { nadal_id: nadalR.rows[0].id, uus: true };
}

// Genereeri mitu järjestikust nädalatrenni korraga (nt "järgmised 10 kolmapäeva")
router.post('/admin/ryhmad/:id/genereeri-nadalad', noudaAdmin, async (req, res) => {
  const { algus, arv } = req.body;
  const n = parseInt(arv, 10);
  if (!algus) return res.json({ ok: false, veateade: 'Vali esimese trenni kuupäev' });
  if (!Number.isInteger(n) || n < 1 || n > 52) return res.json({ ok: false, veateade: 'Nädalate arv peab olema 1–52' });
  try {
    const tulemused = [];
    const algusKp = new Date(algus + 'T12:00:00');
    for (let i = 0; i < n; i++) {
      const kp = new Date(algusKp);
      kp.setDate(kp.getDate() + i * 7);
      const kuupaevStr = kp.toISOString().split('T')[0];
      const tulemus = await looNadalKuiPuudub(req.params.id, kuupaevStr);
      tulemused.push({ kuupaev: kuupaevStr, ...tulemus });
    }
    const veaga = tulemused.find(t => t.veateade);
    if (veaga) return res.json({ ok: false, veateade: veaga.veateade, tulemused });
    res.json({ ok: true, tulemused });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.post('/ryhm/:id/nadal', noudaPadelLigipaas, noudaRyhmaLiige('ryhm'), async (req, res) => {
  const { kuupaev } = req.body;
  if (!kuupaev) return res.json({ ok: false, veateade: 'Kuupäev puudub' });
  try {
    const tulemus = await looNadalKuiPuudub(req.params.id, kuupaev);
    if (tulemus.veateade) return res.json({ ok: false, veateade: tulemus.veateade });
    res.json({ ok: true, nadal_id: tulemus.nadal_id, uus: tulemus.uus });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Märgi osalus/mitteosalus + asendaja ühe koha kohta
router.put('/kohad/:id/osalus', noudaPadelLigipaas, noudaRyhmaLiige('koht'), async (req, res) => {
  const { osaleb, asendaja_nimi } = req.body;
  try {
    const ryhmHinnaR = await pool.query(
      `SELECT r.id AS ryhm_id, r.hind FROM padel_kohad pk
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pk.id = $1`,
      [req.params.id]
    );
    if (!ryhmHinnaR.rows.length) return res.json({ ok: false, veateade: 'Kohta ei leitud' });
    const { ryhm_id, hind } = ryhmHinnaR.rows[0];
    const nimi = osaleb ? null : (asendaja_nimi || '').trim() || null;
    await pool.query(
      'UPDATE padel_kohad SET osaleb=$1, asendaja_nimi=$2, summa=$3, kinnitatud=true WHERE id=$4',
      [!!osaleb, nimi, hind, req.params.id]
    );
    if (nimi) {
      await pool.query('INSERT INTO padel_asendajad (ryhm_id, nimi) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ryhm_id, nimi]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Varem kasutatud asendajate nimed selle grupi jaoks (rippmenüü täitmiseks)
router.get('/ryhm/:id/asendajad', noudaPadelLigipaas, noudaRyhmaLiige('ryhm'), async (req, res) => {
  try {
    const r = await pool.query('SELECT nimi FROM padel_asendajad WHERE ryhm_id=$1 ORDER BY nimi', [req.params.id]);
    res.json({ ok: true, nimed: r.rows.map(x => x.nimi) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Mängija registreerib END selle trenni peale (või tühistab enda registreeringu, kui juba
// registreerunud) — asendajate asemel mängib nüüd alati päris inimene otse enda nime all.
// Esimesed 4 registreerujat saavad automaatselt paari, ülejäänud lähevad ootele ("paar" = NULL),
// aga paare saab hiljem alati vabalt ümber tõsta (vt /kohad/:id/paar).
router.post('/nadalad/:id/registreeru', noudaPadelLigipaas, noudaRyhmaLiige('nadal'), async (req, res) => {
  try {
    const nadalR = await pool.query(
      `SELECT pn.ryhm_id, r.hind FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id WHERE pn.id=$1`,
      [req.params.id]
    );
    if (!nadalR.rows.length) return res.json({ ok: false, veateade: 'Trenni ei leitud' });
    const { ryhm_id, hind } = nadalR.rows[0];

    const liigeR = await pool.query('SELECT id FROM padel_liikmed WHERE ryhm_id=$1 AND worker_id=$2', [ryhm_id, req.session.workerId]);
    if (!liigeR.rows.length) return res.json({ ok: false, veateade: 'Sa pole selle grupi liige' });
    const liigeId = liigeR.rows[0].id;

    const olemasR = await pool.query('SELECT id FROM padel_kohad WHERE nadal_id=$1 AND liige_id=$2', [req.params.id, liigeId]);
    if (olemasR.rows.length) {
      // Juba registreerunud — vajutus tühistab registreeringu.
      await pool.query('DELETE FROM padel_kohad WHERE id=$1', [olemasR.rows[0].id]);
      return res.json({ ok: true, registreeritud: false });
    }

    const arvR = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE paar=1) AS p1, COUNT(*) FILTER (WHERE paar=2) AS p2 FROM padel_kohad WHERE nadal_id=$1`,
      [req.params.id]
    );
    const p1 = parseInt(arvR.rows[0].p1, 10), p2 = parseInt(arvR.rows[0].p2, 10);
    const paar = p1 < 2 ? 1 : (p2 < 2 ? 2 : null);

    await pool.query(
      'INSERT INTO padel_kohad (nadal_id, liige_id, paar, osaleb, kinnitatud, summa) VALUES ($1,$2,$3,true,true,$4)',
      [req.params.id, liigeId, paar, hind]
    );
    res.json({ ok: true, registreeritud: true, paar });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Lisa KONKREETNE inimene KONKREETSESSE paari-kohta (Playtomicu-laadne "+ Lisa mängija").
// Kui lisad iseennast, on koht kohe kinnitatud. Kui lisad kellegi TEISE, jääb koht
// "ootab kinnitust" olekusse, kuni see inimene ise kinnitab (vt /kohad/:id/kinnita).
router.post('/nadalad/:id/lisa', noudaPadelLigipaas, noudaRyhmaLiige('nadal'), async (req, res) => {
  const paar = req.body.paar === 1 || req.body.paar === 2 ? req.body.paar : null;
  const liigeId = parseInt(req.body.liige_id, 10);
  if (!paar || !liigeId) return res.json({ ok: false, veateade: 'Vale päring' });
  try {
    const nadalR = await pool.query(
      `SELECT pn.ryhm_id, r.hind FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id WHERE pn.id=$1`,
      [req.params.id]
    );
    if (!nadalR.rows.length) return res.json({ ok: false, veateade: 'Trenni ei leitud' });
    const { ryhm_id, hind } = nadalR.rows[0];

    const liigeR = await pool.query('SELECT worker_id FROM padel_liikmed WHERE id=$1 AND ryhm_id=$2', [liigeId, ryhm_id]);
    if (!liigeR.rows.length) return res.json({ ok: false, veateade: 'See inimene ei ole selle grupi liige' });

    const kohtiR = await pool.query('SELECT COUNT(*) c FROM padel_kohad WHERE nadal_id=$1 AND paar=$2', [req.params.id, paar]);
    if (parseInt(kohtiR.rows[0].c, 10) >= 2) return res.json({ ok: false, veateade: 'See koht on juba täis' });

    const iseend = liigeR.rows[0].worker_id === req.session.workerId;
    await pool.query(
      'INSERT INTO padel_kohad (nadal_id, liige_id, paar, osaleb, kinnitatud, summa) VALUES ($1,$2,$3,true,$4,$5) ON CONFLICT (nadal_id, liige_id) DO UPDATE SET paar=$3',
      [req.params.id, liigeId, paar, iseend, hind]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kinnita ENDA koht, kui keegi teine sind trennile lisas. Ainult see inimene ise (või admin)
// saab oma kohta kinnitada — see on päris kinnitus, mitte lihtsalt kellegi teise vajutus.
router.put('/kohad/:id/kinnita', noudaPadelLigipaas, noudaRyhmaLiige('koht'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pl.worker_id FROM padel_kohad pk JOIN padel_liikmed pl ON pl.id = pk.liige_id WHERE pk.id=$1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.json({ ok: false, veateade: 'Kohta ei leitud' });
    if (!req.session.isAdmin && r.rows[0].worker_id !== req.session.workerId) {
      return res.json({ ok: false, veateade: 'Ainult see inimene ise saab oma kohta kinnitada' });
    }
    await pool.query('UPDATE padel_kohad SET kinnitatud=true WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Paari vaba muutmine — täielik vabadus panna keegi Paar 1 / Paar 2 / Ootele, ükskõik millal
// (enne trenni või kohapeal), niikaua kui tulemust pole veel sisestatud.
router.put('/kohad/:id/paar', noudaPadelLigipaas, noudaRyhmaLiige('koht'), async (req, res) => {
  const paar = req.body.paar === 1 || req.body.paar === 2 ? req.body.paar : null;
  try {
    await pool.query('UPDATE padel_kohad SET paar=$1 WHERE id=$2', [paar, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Eemalda kellegi registreering sellelt trennilt täielikult (nt kui keegi loobus ja teine peab
// tema asemel sisse kirjutama, vms erandjuhtum).
router.delete('/kohad/:id', noudaPadelLigipaas, noudaRyhmaLiige('koht'), async (req, res) => {
  try {
    await pool.query('DELETE FROM padel_kohad WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Sisesta/muuda nädala setid (kehtib kohe, ei vaja kinnitust). Asendab kõik setid korraga.
// Playtomicust saadud uksekood selle trenni jaoks (4 kohta, kõik grupi liikmed näevad/saavad muuta)
router.put('/nadalad/:id/uksekood', noudaPadelLigipaas, noudaRyhmaLiige('nadal'), async (req, res) => {
  const kood = (req.body.kood || '').trim();
  if (kood && !/^[0-9]{1,4}$/.test(kood)) return res.json({ ok: false, veateade: 'Uksekood peab olema kuni 4 numbrit' });
  try {
    // Kui koodi muudetakse, lubame automaatsel teavitusel uuesti saata (nt kui kood parandati viimasel hetkel).
    await pool.query('UPDATE padel_nadalad SET ukse_kood=$1, uksekoodi_teavitus_saadetud=false WHERE id=$2', [kood || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Selle konkreetse trenni algusaeg (kui erineb grupi vaikimisi kellaajast)
router.put('/nadalad/:id/kellaaeg', noudaPadelLigipaas, noudaRyhmaLiige('nadal'), async (req, res) => {
  const kellaaeg = (req.body.kellaaeg || '').trim();
  if (kellaaeg && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kellaaeg)) return res.json({ ok: false, veateade: 'Vale kellaaja formaat (nt 18:30)' });
  try {
    await pool.query('UPDATE padel_nadalad SET kellaaeg=$1, uksekoodi_teavitus_saadetud=false WHERE id=$2', [kellaaeg || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/nadalad/:id/setid', noudaPadelLigipaas, noudaRyhmaLiige('nadal'), async (req, res) => {
  const { setid } = req.body;
  if (!Array.isArray(setid) || !setid.length) return res.json({ ok: false, veateade: 'Lisa vähemalt üks geimi tulemus' });
  const puhtad = [];
  for (const s of setid) {
    const p1 = parseInt(s.paar1_geimid, 10), p2 = parseInt(s.paar2_geimid, 10);
    if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 < 0 || p2 < 0) continue;
    puhtad.push([p1, p2]);
  }
  if (!puhtad.length) return res.json({ ok: false, veateade: 'Sisesta korrektsed geimide arvud' });
  try {
    await pool.query('DELETE FROM padel_setid WHERE nadal_id=$1', [req.params.id]);
    for (let i = 0; i < puhtad.length; i++) {
      await pool.query('INSERT INTO padel_setid (nadal_id, jrk_nr, paar1_geimid, paar2_geimid) VALUES ($1,$2,$3,$4)',
        [req.params.id, i, puhtad[i][0], puhtad[i][1]]);
    }
    await pool.query('UPDATE padel_nadalad SET tulemus_sisestas=$1 WHERE id=$2', [req.session.workerId || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Minu enda saldo — ainult KINNITATUD trennid, kus ma ISE osalesin (asendaja-nädalad ei lähe minu arvele).
// Kinnitamata koht (keegi teine lisas mind, ma pole kinnitanud) trennitasu arvele ei too.
router.get('/minu-saldo', noudaPadelLigipaas, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.nimi AS ryhm_nimi, pn.kuupaev, pk.summa
       FROM padel_kohad pk
       JOIN padel_liikmed pl ON pl.id = pk.liige_id
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pl.worker_id = $1 AND pk.osaleb = true AND pk.kinnitatud = true AND pk.makstud = false AND pk.summa IS NOT NULL
       ORDER BY pn.kuupaev DESC`,
      [req.session.workerId]
    );
    const maksedR = await pool.query(
      `SELECT summa, kuupaev, kommentaar FROM padel_maksed WHERE worker_id=$1 ORDER BY kuupaev DESC, id DESC`,
      [req.session.workerId]
    );
    const volgSumma = r.rows.reduce((s, row) => s + parseFloat(row.summa), 0);
    const makstudSumma = maksedR.rows.reduce((s, row) => s + parseFloat(row.summa), 0);
    const kokku = volgSumma - makstudSumma;
    // Detailne ülevaade (trenn-trennilt staatus + maksed kuupäevadega) — ainult arvel olevad trennid
    const u = await mangijaUlevaade(req.session.workerId);
    const trennid = u.trennid.filter(t => t.staatus !== 'kinnitamata' && t.staatus !== 'hind_puudu');
    res.json({ ok: true, vola: r.rows, maksed: u.maksed, trennid, kokku: +kokku.toFixed(2) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: MAKSETE HALDUS (kes on mulle üle kandnud, kui palju) ───────────
// Kõik Padeli mängijad (üle kõigi gruppide, dubleerimata) koos nende koguvõla/saldoga.
// Trennitasu arvestatakse ainult kinnitatud kohtadelt (kinnitatud = osaleb = tasu arvel).
router.get('/admin/saldod', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `WITH mangijad AS (
         SELECT DISTINCT pl.worker_id, w.nimi
         FROM padel_liikmed pl JOIN workers w ON w.id = pl.worker_id
       ),
       volad AS (
         SELECT pl.worker_id, COALESCE(SUM(pk.summa), 0) AS volg
         FROM padel_kohad pk JOIN padel_liikmed pl ON pl.id = pk.liige_id
         WHERE pk.osaleb = true AND pk.kinnitatud = true AND pk.makstud = false AND pk.summa IS NOT NULL
         GROUP BY pl.worker_id
       ),
       maksed AS (
         SELECT worker_id, COALESCE(SUM(summa), 0) AS makstud
         FROM padel_maksed GROUP BY worker_id
       ),
       tasuta AS (
         -- Möödunud trennid, kus mängija OLI PAARIS (mängis), aga tasu pole arvel
         -- (kinnitamata või hind puudub — vana süsteemi automaatselt loodud kohad)
         SELECT pl.worker_id, COUNT(*) AS arv
         FROM padel_kohad pk
         JOIN padel_liikmed pl ON pl.id = pk.liige_id
         JOIN padel_nadalad pn ON pn.id = pk.nadal_id
         WHERE pn.kuupaev < CURRENT_DATE AND pk.osaleb = true AND pk.makstud = false
           AND pk.paar IN (1,2) AND (pk.kinnitatud = false OR pk.summa IS NULL)
         GROUP BY pl.worker_id
       )
       SELECT m.worker_id, m.nimi,
              COALESCE(v.volg, 0) AS volg,
              COALESCE(mk.makstud, 0) AS makstud,
              COALESCE(v.volg, 0) - COALESCE(mk.makstud, 0) AS saldo,
              COALESCE(t.arv, 0)::int AS tasuta
       FROM mangijad m
       LEFT JOIN volad v ON v.worker_id = m.worker_id
       LEFT JOIN maksed mk ON mk.worker_id = m.worker_id
       LEFT JOIN tasuta t ON t.worker_id = m.worker_id
       ORDER BY m.nimi`
    );
    res.json({ ok: true, mangijad: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Pane trennitasu arvele kõigile, kes möödunud trennides olid PAARIS (st mängisid), aga kelle
// koht on kinnitamata või ilma hinnata. Admin käivitab selle ise nupust (ühekordne korrastus).
router.post('/admin/pane-tasu-arvele', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE padel_kohad pk
       SET kinnitatud = true, summa = COALESCE(pk.summa, r.hind)
       FROM padel_nadalad pn, padel_ryhmad r
       WHERE pn.id = pk.nadal_id AND r.id = pn.ryhm_id
         AND pn.kuupaev < CURRENT_DATE AND pk.osaleb = true AND pk.makstud = false
         AND pk.paar IN (1,2) AND (pk.kinnitatud = false OR pk.summa IS NULL)
       RETURNING pk.id`
    );
    res.json({ ok: true, parandati: r.rowCount });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Ühe mängija makseajalugu (admin vaade)
router.get('/admin/maksed/:workerId', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM padel_maksed WHERE worker_id=$1 ORDER BY kuupaev DESC, id DESC', [req.params.workerId]);
    res.json({ ok: true, maksed: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Salvesta uus makse ("Siim kandis üle 31€")
router.post('/admin/maksed', noudaAdmin, async (req, res) => {
  const { worker_id, summa, kuupaev, kommentaar } = req.body;
  const summaNum = parseFloat(summa);
  if (!worker_id || !Number.isFinite(summaNum) || summaNum <= 0) return res.json({ ok: false, veateade: 'Sisesta töötaja ja positiivne summa' });
  try {
    await pool.query(
      'INSERT INTO padel_maksed (worker_id, summa, kuupaev, kommentaar) VALUES ($1,$2,$3,$4)',
      [worker_id, summaNum, kuupaev || new Date(), kommentaar || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.delete('/admin/maksed/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM padel_maksed WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: ÜHE MÄNGIJA TRENNID + MAKSED (märkimine "kandis") ────────────
// Tagastab mängija kõik trennid koos tasu staatusega:
//   - kinnitamata  -> tasu pole arvel
//   - kandis       -> sellele trennile on seotud makse (admin märkis "kandis")
//   - kaetud       -> üldmaksed (ilma trennita) katavad selle trenni (vanimad trennid enne)
//   - maksmata     -> tasu arvel, makset pole
async function mangijaUlevaade(workerId) {
    await maksedVeergValmis;
    const trennidR = await pool.query(
      `SELECT pk.id AS koht_id, to_char(pn.kuupaev,'YYYY-MM-DD') AS kuupaev, r.nimi AS ryhm_nimi,
              COALESCE(pk.summa, r.hind)::numeric AS summa, (pk.summa IS NULL) AS hind_puudu, pk.kinnitatud, pk.osaleb, pk.makstud, pk.paar
       FROM padel_kohad pk
       JOIN padel_liikmed pl ON pl.id = pk.liige_id
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pl.worker_id = $1 AND pk.osaleb = true
       ORDER BY pn.kuupaev ASC, pk.id ASC`,
      [workerId]
    );
    const maksedR = await pool.query(
      `SELECT id, summa::numeric AS summa, to_char(kuupaev,'YYYY-MM-DD') AS kuupaev, kommentaar, koht_id, loodud
       FROM padel_maksed WHERE worker_id=$1 ORDER BY kuupaev DESC, id DESC`,
      [workerId]
    );
    const maksed = maksedR.rows.map(m => ({ ...m, summa: parseFloat(m.summa) || 0 }));
    const seotud = {};
    maksed.forEach(m => { if (m.koht_id) seotud[m.koht_id] = m; });
    let yldmaksed = maksed.filter(m => !m.koht_id || !trennidR.rows.some(t => t.koht_id === m.koht_id))
      .reduce((s, m) => s + m.summa, 0);

    const trennid = trennidR.rows.map(t => {
      const summa = parseFloat(t.summa) || 0;
      const rida = { koht_id: t.koht_id, kuupaev: t.kuupaev, ryhm_nimi: t.ryhm_nimi, summa, kinnitatud: t.kinnitatud, paar: t.paar };
      if (!t.kinnitatud) rida.staatus = 'kinnitamata';
      else if (t.hind_puudu && !t.makstud && !seotud[t.koht_id]) rida.staatus = 'hind_puudu';
      else if (t.makstud) rida.staatus = 'kaetud';            // vana asendaja-süsteemi lipp
      else if (seotud[t.koht_id]) { rida.staatus = 'kandis'; rida.makse = { id: seotud[t.koht_id].id, kuupaev: seotud[t.koht_id].kuupaev, loodud: seotud[t.koht_id].loodud }; }
      else rida.staatus = 'maksmata';
      return rida;
    });
    // Üldmaksed katavad maksmata trennid vanimast alates
    trennid.forEach(t => {
      if (t.staatus === 'maksmata' && yldmaksed >= t.summa - 0.001) { t.staatus = 'kaetud'; yldmaksed -= t.summa; }
    });

    const volg = trennidR.rows.filter(t => t.kinnitatud && !t.makstud && !t.hind_puudu).reduce((s, t) => s + (parseFloat(t.summa) || 0), 0);
    const makstud = maksed.reduce((s, m) => s + m.summa, 0);
    return { trennid: trennid.reverse(), maksed, saldo: +(volg - makstud).toFixed(2), jaak_ettemaks: +yldmaksed.toFixed(2) };
}

router.get('/admin/mangija/:workerId', noudaAdmin, async (req, res) => {
  try {
    const u = await mangijaUlevaade(parseInt(req.params.workerId, 10));
    res.json({ ok: true, ...u });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Märgi, et mängija kandis konkreetse trenni eest -> tekib makse (seotud trenniga), jääb logisse.
// Kui koht polnud kinnitatud, kinnitatakse see ka (ta mängis ja maksis).
router.post('/admin/kohad/:id/kandis', noudaAdmin, async (req, res) => {
  try {
    await maksedVeergValmis;
    const kohtR = await pool.query(
      `SELECT pk.id, COALESCE(pk.summa, r.hind) AS summa, pl.worker_id, to_char(pn.kuupaev,'DD.MM.YYYY') AS kp, r.nimi AS ryhm_nimi
       FROM padel_kohad pk
       JOIN padel_liikmed pl ON pl.id = pk.liige_id
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pk.id = $1`,
      [req.params.id]
    );
    if (!kohtR.rows.length) return res.json({ ok: false, veateade: 'Trenni kohta ei leitud' });
    const k = kohtR.rows[0];
    const olemas = await pool.query('SELECT id FROM padel_maksed WHERE koht_id=$1', [k.id]);
    if (olemas.rows.length) return res.json({ ok: false, veateade: 'See trenn on juba märgitud makstuks' });
    const kuupaev = /^\d{4}-\d{2}-\d{2}$/.test(req.body.kuupaev || '') ? req.body.kuupaev : new Date().toISOString().slice(0, 10);
    await pool.query('UPDATE padel_kohad SET kinnitatud=true, summa=COALESCE(summa,$2) WHERE id=$1', [k.id, k.summa]);
    const r = await pool.query(
      'INSERT INTO padel_maksed (worker_id, summa, kuupaev, kommentaar, koht_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [k.worker_id, k.summa, kuupaev, `Trenn ${k.kp} (${k.ryhm_nimi})`, k.id]
    );
    res.json({ ok: true, makse_id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Maksete logi üle kõigi mängijate (uuemad eespool)
router.get('/admin/maksed-logi', noudaAdmin, async (req, res) => {
  try {
    await maksedVeergValmis;
    const r = await pool.query(
      `SELECT m.id, m.worker_id, w.nimi, m.summa::numeric AS summa, to_char(m.kuupaev,'YYYY-MM-DD') AS kuupaev,
              m.kommentaar, m.koht_id, m.loodud
       FROM padel_maksed m JOIN workers w ON w.id = m.worker_id
       ORDER BY m.loodud DESC NULLS LAST, m.id DESC
       LIMIT 100`
    );
    res.json({ ok: true, maksed: r.rows.map(m => ({ ...m, summa: parseFloat(m.summa) || 0 })) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── STATISTIKA ─────────────────────────────────────────────────────────
// Arvutatakse kõigist trennidest, kus on tulemus sees ja mõlemas paaris 2 mängijat.
// Võitja = paar, kellel on trenni peale kokku rohkem geime (sama loogika mis edetabelis).
// ?ryhm_id=X piirab ühe grupiga; muidu kõik grupid, kus küsija on liige (admin: kõik grupid).
router.get('/statistika', noudaPadelLigipaas, async (req, res) => {
  try {
    const minaId = req.session.workerId || null;
    let ryhmad;
    if (req.session.isAdmin) {
      ryhmad = (await pool.query('SELECT id, nimi FROM padel_ryhmad ORDER BY nimi')).rows;
    } else {
      ryhmad = (await pool.query(
        `SELECT DISTINCT r.id, r.nimi FROM padel_ryhmad r JOIN padel_liikmed pl ON pl.ryhm_id = r.id WHERE pl.worker_id = $1 ORDER BY r.nimi`,
        [minaId]
      )).rows;
    }
    const ryhmId = parseInt(req.query.ryhm_id, 10);
    const ryhmIdd = ryhmId && ryhmad.some(g => g.id === ryhmId) ? [ryhmId] : ryhmad.map(g => g.id);
    if (!ryhmIdd.length) return res.json({ ok: true, ryhmad, mange: 0 });

    const mangudR = await pool.query(
      `SELECT pn.id, to_char(pn.kuupaev,'YYYY-MM-DD') AS kuupaev, r.nimi AS ryhm_nimi,
              (SELECT json_agg(json_build_object('g1', ps.paar1_geimid, 'g2', ps.paar2_geimid) ORDER BY ps.jrk_nr) FROM padel_setid ps WHERE ps.nadal_id = pn.id) AS setid,
              (SELECT json_agg(json_build_object('worker_id', pl.worker_id, 'nimi', w.nimi, 'paar', pk.paar, 'foto_url', ${fotoSql('pl')}))
                 FROM padel_kohad pk JOIN padel_liikmed pl ON pl.id = pk.liige_id JOIN workers w ON w.id = pl.worker_id
                 WHERE pk.nadal_id = pn.id AND pk.paar IN (1,2)) AS mangijad
       FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pn.ryhm_id = ANY($1::int[]) AND EXISTS (SELECT 1 FROM padel_setid ps WHERE ps.nadal_id = pn.id)
       ORDER BY pn.kuupaev ASC, pn.id ASC`,
      [ryhmIdd]
    );

    const inimesed = {};   // worker_id -> { nimi, foto_url }
    const mangud = [];
    mangudR.rows.forEach(m => {
      const mj = m.mangijad || [];
      const p1 = mj.filter(x => x.paar === 1), p2 = mj.filter(x => x.paar === 2);
      if (p1.length !== 2 || p2.length !== 2) return;
      mj.forEach(x => { inimesed[x.worker_id] = { worker_id: x.worker_id, nimi: x.nimi, foto_url: x.foto_url }; });
      const setid = m.setid || [];
      const g1 = setid.reduce((t, x) => t + x.g1, 0), g2 = setid.reduce((t, x) => t + x.g2, 0);
      mangud.push({ id: m.id, kuupaev: m.kuupaev, ryhm: m.ryhm_nimi, p1: p1.map(x => x.worker_id), p2: p2.map(x => x.worker_id), g1, g2, setid });
    });

    // Abifunktsioon: ühe mängija vaade ühest mängust
    function vaade(m, wid) {
      const minuPaar = m.p1.includes(wid) ? 1 : m.p2.includes(wid) ? 2 : 0;
      if (!minuPaar) return null;
      const minu = minuPaar === 1 ? m.g1 : m.g2, nende = minuPaar === 1 ? m.g2 : m.g1;
      return {
        tulemus: minu > nende ? 'V' : minu < nende ? 'K' : 'Vi',
        minu, nende,
        partner: (minuPaar === 1 ? m.p1 : m.p2).find(x => x !== wid),
        vastased: minuPaar === 1 ? m.p2 : m.p1
      };
    }
    const pr = (v, k) => k ? Math.round(v / k * 100) : 0;

    // ── Kõigi mängijate koondtabel ──
    const mangijad = Object.values(inimesed).map(p => {
      let mange = 0, v = 0, vi = 0, k = 0, gPoolt = 0, gVastu = 0;
      mangud.forEach(m => {
        const x = vaade(m, p.worker_id); if (!x) return;
        mange++; gPoolt += x.minu; gVastu += x.nende;
        if (x.tulemus === 'V') v++; else if (x.tulemus === 'K') k++; else vi++;
      });
      return { ...p, mange, voidud: v, viigid: vi, kaotused: k, voidu_pr: pr(v, mange), geime_poolt: gPoolt, geime_vastu: gVastu,
               keskm_geime: mange ? +(gPoolt / mange).toFixed(1) : 0, geimivahe: gPoolt - gVastu };
    }).filter(p => p.mange > 0);

    // ── Paarid (duod) ja duo-vs-duo vastasseisud ──
    const duoVoti = arr => arr.slice().sort((a, b) => a - b).join('-');
    const duod = {}, vastasseisud = {};
    mangud.forEach(m => {
      [[m.p1, m.g1, m.g2], [m.p2, m.g2, m.g1]].forEach(([paar, minu, nende]) => {
        const kkey = duoVoti(paar);
        const d = duod[kkey] = duod[kkey] || { mangijad: paar.slice().sort((a, b) => a - b), mange: 0, voidud: 0, geimivahe: 0 };
        d.mange++; if (minu > nende) d.voidud++; d.geimivahe += minu - nende;
      });
      const a = duoVoti(m.p1), b = duoVoti(m.p2);
      const vkey = [a, b].sort().join('|');
      const vs = vastasseisud[vkey] = vastasseisud[vkey] || { duo1: a < b ? m.p1.slice().sort((x, y) => x - y) : m.p2.slice().sort((x, y) => x - y), duo2: a < b ? m.p2.slice().sort((x, y) => x - y) : m.p1.slice().sort((x, y) => x - y), mange: 0, vahe_summa: 0, geime: 0, duo1_voidud: 0, duo2_voidud: 0 };
      vs.mange++; vs.vahe_summa += Math.abs(m.g1 - m.g2); vs.geime += m.g1 + m.g2;
      const duo1G = a < b ? m.g1 : m.g2, duo2G = a < b ? m.g2 : m.g1;
      if (duo1G > duo2G) vs.duo1_voidud++; else if (duo2G > duo1G) vs.duo2_voidud++;
    });
    const duoList = Object.values(duod).map(d => ({ ...d, voidu_pr: pr(d.voidud, d.mange) }));
    const parimadPaarid = duoList.filter(d => d.mange >= 2).sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange || b.geimivahe - a.geimivahe).slice(0, 5);
    const pingelisemadVastasseisud = Object.values(vastasseisud)
      .map(v => ({ ...v, keskm_vahe: +(v.vahe_summa / v.mange).toFixed(1) }))
      .sort((a, b) => a.keskm_vahe - b.keskm_vahe || b.mange - a.mange).slice(0, 5);
    const tasavagisemadMangud = mangud.slice()
      .sort((a, b) => Math.abs(a.g1 - a.g2) - Math.abs(b.g1 - b.g2) || (b.g1 + b.g2) - (a.g1 + a.g2)).slice(0, 5)
      .map(m => ({ kuupaev: m.kuupaev, ryhm: m.ryhm, p1: m.p1, p2: m.p2, g1: m.g1, g2: m.g2, setid: m.setid }));
    const suurimVoit = mangud.slice().sort((a, b) => Math.abs(b.g1 - b.g2) - Math.abs(a.g1 - a.g2))[0] || null;
    const koigeRohkemGeime = mangud.slice().sort((a, b) => (b.g1 + b.g2) - (a.g1 + a.g2))[0] || null;

    const rekordid = {
      koige_aktiivsem: mangijad.slice().sort((a, b) => b.mange - a.mange)[0] || null,
      parim_voidu_pr: mangijad.filter(p => p.mange >= 3).sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange)[0] || null,
      enim_geime_keskm: mangijad.filter(p => p.mange >= 2).sort((a, b) => b.keskm_geime - a.keskm_geime)[0] || null,
      parim_geimivahe: mangijad.slice().sort((a, b) => b.geimivahe - a.geimivahe)[0] || null,
      suurim_voit: suurimVoit && { kuupaev: suurimVoit.kuupaev, ryhm: suurimVoit.ryhm, p1: suurimVoit.p1, p2: suurimVoit.p2, g1: suurimVoit.g1, g2: suurimVoit.g2 },
      enim_geime_trennis: koigeRohkemGeime && { kuupaev: koigeRohkemGeime.kuupaev, ryhm: koigeRohkemGeime.ryhm, p1: koigeRohkemGeime.p1, p2: koigeRohkemGeime.p2, g1: koigeRohkemGeime.g1, g2: koigeRohkemGeime.g2 }
    };

    // ── Minu statistika ──
    let mina = null;
    if (minaId && mangijad.some(p => p.worker_id === minaId)) {
      const minuMangud = mangud.map(m => ({ m, x: vaade(m, minaId) })).filter(o => o.x);
      const partnerid = {}, vastased = {};
      let seeria = 0, seeriaTyyp = null, pikimVoiduseeria = 0, jooksevVoit = 0;
      minuMangud.forEach(({ x }) => {
        const pa = partnerid[x.partner] = partnerid[x.partner] || { worker_id: x.partner, mange: 0, voidud: 0, geimivahe: 0 };
        pa.mange++; if (x.tulemus === 'V') pa.voidud++; pa.geimivahe += x.minu - x.nende;
        x.vastased.forEach(vid => {
          const va = vastased[vid] = vastased[vid] || { worker_id: vid, mange: 0, voidud: 0, kaotused: 0, geimivahe: 0 };
          va.mange++; if (x.tulemus === 'V') va.voidud++; if (x.tulemus === 'K') va.kaotused++; va.geimivahe += x.minu - x.nende;
        });
        if (x.tulemus === 'V') { jooksevVoit++; pikimVoiduseeria = Math.max(pikimVoiduseeria, jooksevVoit); } else jooksevVoit = 0;
        if (x.tulemus === seeriaTyyp) seeria++; else { seeriaTyyp = x.tulemus; seeria = 1; }
      });
      const pList = Object.values(partnerid).map(p => ({ ...p, voidu_pr: pr(p.voidud, p.mange) }))
        .sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange || b.geimivahe - a.geimivahe);
      const vList = Object.values(vastased).map(v => ({ ...v, voidu_pr: pr(v.voidud, v.mange) }));
      const minuRida = mangijad.find(p => p.worker_id === minaId);
      const voidud = minuMangud.filter(o => o.x.tulemus === 'V').map(o => o.x.minu - o.x.nende);
      const kaotused = minuMangud.filter(o => o.x.tulemus === 'K').map(o => o.x.nende - o.x.minu);
      mina = {
        ...minuRida,
        koht_edetabelis: mangijad.slice().sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange).findIndex(p => p.worker_id === minaId) + 1,
        seeria: { tyyp: seeriaTyyp, pikkus: seeria },
        pikim_voiduseeria: pikimVoiduseeria,
        suurim_voit: voidud.length ? Math.max.apply(null, voidud) : null,
        suurim_kaotus: kaotused.length ? Math.max.apply(null, kaotused) : null,
        viimased: minuMangud.slice(-8).map(o => o.x.tulemus),
        partnerid: pList,
        lemmikvastane: vList.slice().sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange)[0] || null,
        raskeim_vastane: vList.slice().sort((a, b) => a.voidu_pr - b.voidu_pr || b.mange - a.mange)[0] || null,
        vastased: vList.sort((a, b) => b.mange - a.mange)
      };
    }

    res.json({
      ok: true, ryhmad, valitud_ryhm: ryhmIdd.length === 1 ? ryhmIdd[0] : null,
      mange: mangud.length, geime_kokku: mangud.reduce((t, m) => t + m.g1 + m.g2, 0),
      inimesed, mangijad: mangijad.sort((a, b) => b.voidu_pr - a.voidu_pr || b.mange - a.mange),
      mina, rekordid, parimad_paarid: parimadPaarid, pingelisemad_vastasseisud: pingelisemadVastasseisud, tasavagisemad_mangud: tasavagisemadMangud
    });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Saada kõigile grupi liikmetele meeldetuletus (push) — admin või liige ise
router.post('/ryhm/:id/meeldetuletus', noudaPadelLigipaas, noudaRyhmaLiige('ryhm'), async (req, res) => {
  try {
    const ryhmR = await pool.query('SELECT nimi FROM padel_ryhmad WHERE id=$1', [req.params.id]);
    const liikmedR = await pool.query('SELECT worker_id FROM padel_liikmed WHERE ryhm_id=$1', [req.params.id]);
    if (!ryhmR.rows.length) return res.json({ ok: false, veateade: 'Gruppi ei leitud' });
    for (const l of liikmedR.rows) {
      saadaTeavitus(l.worker_id, '🎾 Padel', `Kas tuled täna trenni? (${ryhmR.rows[0].nimi})`, '/padel');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Vabas vormis sõnum grupikaaslas(t)ele (nt "maksa võlg ära", "palju õnne võidu puhul!") —
// iga Padel-liige tohib saata, mitte ainult admin. Saab valida kogu grupile või ühele liikmele.
router.post('/ryhm/:id/sonum', noudaPadelLigipaas, noudaRyhmaLiige('ryhm'), async (req, res) => {
  const { pealkiri, sonum, liige_id } = req.body;
  if (!pealkiri || !sonum) return res.json({ ok: false, veateade: 'Kirjuta pealkiri ja sõnum' });
  try {
    let saajad;
    if (liige_id) {
      const r = await pool.query('SELECT worker_id FROM padel_liikmed WHERE id=$1 AND ryhm_id=$2', [liige_id, req.params.id]);
      if (!r.rows.length) return res.json({ ok: false, veateade: 'Liiget ei leitud' });
      saajad = r.rows;
    } else {
      const r = await pool.query('SELECT worker_id FROM padel_liikmed WHERE ryhm_id=$1', [req.params.id]);
      saajad = r.rows;
    }
    for (const s of saajad) {
      saadaTeavitus(s.worker_id, `🎾 ${pealkiri}`, sonum, '/padel');
    }
    res.json({ ok: true, saadeti: saajad.length });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Automaatne hommikune meeldetuletus trenni päeval — kontrollitakse iga 15 min tagant.
// Saadab ainult üks kord (meeldetuletus_saadetud lipp), akna sees 08:00-08:29 serveri kellaaja järgi.
async function kontrolliAutomaatseidMeeldetuletusi() {
  try {
    const tallinnaTund = parseInt(new Intl.DateTimeFormat('et-EE', { timeZone: 'Europe/Tallinn', hour: '2-digit', hour12: false }).format(new Date()), 10);
    if (tallinnaTund !== 8) return; // ainult kell 8 paiku hommikul (Eesti aja järgi)
    const tanaR = await pool.query(
      `SELECT pn.id, pn.ryhm_id, r.nimi AS ryhm_nimi
       FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pn.kuupaev = CURRENT_DATE AND pn.meeldetuletus_saadetud = false AND r.aktiivne = true`
    );
    for (const nadal of tanaR.rows) {
      const liikmedR = await pool.query('SELECT worker_id FROM padel_liikmed WHERE ryhm_id=$1', [nadal.ryhm_id]);
      for (const l of liikmedR.rows) {
        saadaTeavitus(l.worker_id, '🎾 Padel', `Täna on trenn (${nadal.ryhm_nimi})! Kas tuled?`, '/padel');
      }
      await pool.query('UPDATE padel_nadalad SET meeldetuletus_saadetud=true WHERE id=$1', [nadal.id]);
    }
  } catch (err) {
    console.error('Automaatne Padeli meeldetuletus ebaõnnestus:', err.message);
  }
}
setInterval(kontrolliAutomaatseidMeeldetuletusi, 15 * 60 * 1000);

// Automaatne uksekoodi teavitus 30 min enne trenni algust — kontrollitakse iga 5 min tagant.
async function kontrolliUksekoodiTeavitusi() {
  try {
    const r = await pool.query(
      `SELECT pn.id, pn.ryhm_id, pn.ukse_kood, r.nimi AS ryhm_nimi
       FROM padel_nadalad pn JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pn.kuupaev = CURRENT_DATE
         AND pn.kellaaeg IS NOT NULL
         AND pn.ukse_kood IS NOT NULL AND pn.ukse_kood <> ''
         AND pn.uksekoodi_teavitus_saadetud = false
         AND (pn.kuupaev + pn.kellaaeg) - INTERVAL '30 minutes' <= (NOW() AT TIME ZONE 'Europe/Tallinn')
         AND (pn.kuupaev + pn.kellaaeg) > (NOW() AT TIME ZONE 'Europe/Tallinn')
         AND r.aktiivne = true`
    );
    for (const nadal of r.rows) {
      // Ainult neile, kes on SELLEL konkreetsel trennil päriselt kinnitatud osalejad —
      // mitte kogu grupi (potentsiaalselt 6+ inimest) peale.
      const liikmedR = await pool.query(
        `SELECT pl.worker_id
         FROM padel_kohad pk JOIN padel_liikmed pl ON pl.id = pk.liige_id
         WHERE pk.nadal_id=$1 AND pk.osaleb=true AND pk.kinnitatud=true`,
        [nadal.id]
      );
      for (const l of liikmedR.rows) {
        saadaTeavitus(l.worker_id, `🔑 ${nadal.ryhm_nimi} — uksekood`, `Trenn algab 30 minuti pärast. Uksekood: ${nadal.ukse_kood}`, '/padel');
      }
      await pool.query('UPDATE padel_nadalad SET uksekoodi_teavitus_saadetud=true WHERE id=$1', [nadal.id]);
    }
  } catch (err) {
    console.error('Automaatne uksekoodi teavitus ebaõnnestus:', err.message);
  }
}
setInterval(kontrolliUksekoodiTeavitusi, 5 * 60 * 1000);

module.exports = router;
