const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { saadaTeavitus } = require('./push');

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

// Paaride rotatsioon 4 fikseeritud liikmega (Americano-stiil): 3 nädala tsükkel,
// nii et kõik mängivad kõigiga nii paarilise kui vastasena.
function paaridRotatsioon(liikmed, indeks) {
  const [A, B, C, D] = liikmed;
  const combos = [
    [[A, B], [C, D]],
    [[A, C], [B, D]],
    [[A, D], [B, C]],
  ];
  return combos[((indeks % 3) + 3) % 3];
}

// Kas mul on ligipääs Padel moodulile? (kasutab liides, et otsustada, kas lehte üldse näidata)
router.get('/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    if (req.session.isAdmin) return res.json({ ok: true, lubatud: true });
    const r = await pool.query('SELECT 1 FROM padel_lubatud WHERE worker_id=$1', [req.session.workerId]);
    res.json({ ok: true, lubatud: r.rows.length > 0 });
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
      `SELECT pl.id, pl.ryhm_id, pl.worker_id, pl.jrk_nr, w.nimi
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
router.post('/admin/ryhmad/:id/liikmed', noudaAdmin, async (req, res) => {
  const { worker_id } = req.body;
  if (!worker_id) return res.json({ ok: false, veateade: 'Vali töötaja' });
  try {
    const olemasR = await pool.query('SELECT COUNT(*) c FROM padel_liikmed WHERE ryhm_id=$1', [req.params.id]);
    if (parseInt(olemasR.rows[0].c, 10) >= 4) return res.json({ ok: false, veateade: 'Grupis on juba 4 liiget (padel mängitakse 2 vs 2)' });
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
router.get('/ryhm/:id', noudaPadelLigipaas, async (req, res) => {
  try {
    const ryhmR = await pool.query('SELECT * FROM padel_ryhmad WHERE id=$1', [req.params.id]);
    if (!ryhmR.rows.length) return res.json({ ok: false, veateade: 'Gruppi ei leitud' });
    const liikmedR = await pool.query(
      `SELECT pl.id, pl.worker_id, pl.jrk_nr, w.nimi
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
              COALESCE(SUM(CASE WHEN pk.paar = 1 THEN np.p1p ELSE np.p2p END), 0) AS punktid,
              COALESCE(SUM(CASE WHEN pk.paar = 1 THEN np.p1g ELSE np.p2g END), 0) AS geimid_kokku,
              COUNT(np.nadal_id) AS mange
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
        liige_id: l.id, nimi: l.nimi,
        punktid: rida ? parseInt(rida.punktid, 10) : 0,
        geimid: rida ? parseInt(rida.geimid_kokku, 10) : 0,
        mange: rida ? parseInt(rida.mange, 10) : 0
      };
    }).sort((a, b) => b.punktid - a.punktid || b.geimid - a.geimid);

    const nadaladR = await pool.query(
      `SELECT pn.*,
              (SELECT json_agg(json_build_object('liige_id', pk.liige_id, 'paar', pk.paar, 'osaleb', pk.osaleb, 'kinnitatud', pk.kinnitatud, 'asendaja_nimi', pk.asendaja_nimi, 'nimi', w.nimi, 'id', pk.id, 'makstud', pk.makstud, 'summa', pk.summa))
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

// Loo (või tagasta olemasolev) selle nädala trenn, koos automaatse paarijaotusega
// Loob (kui puudub) ühe nädala trenni koos automaatse paarijaotusega. Tagastab {nadal_id, uus}
// või {veateade} kui gruppi ei saa (nt liikmeid pole täpselt 4).
async function looNadalKuiPuudub(ryhmId, kuupaev) {
  const olemasR = await pool.query('SELECT id FROM padel_nadalad WHERE ryhm_id=$1 AND kuupaev=$2', [ryhmId, kuupaev]);
  if (olemasR.rows.length) return { nadal_id: olemasR.rows[0].id, uus: false };

  const liikmedR = await pool.query('SELECT id, worker_id FROM padel_liikmed WHERE ryhm_id=$1 ORDER BY jrk_nr', [ryhmId]);
  if (liikmedR.rows.length !== 4) return { veateade: 'Grupis peab olema täpselt 4 liiget, et nädalat luua' };

  const arvR = await pool.query('SELECT COUNT(*) c FROM padel_nadalad WHERE ryhm_id=$1', [ryhmId]);
  const indeks = parseInt(arvR.rows[0].c, 10);
  const [paar1, paar2] = paaridRotatsioon(liikmedR.rows, indeks);

  const nadalR = await pool.query('INSERT INTO padel_nadalad (ryhm_id, kuupaev) VALUES ($1,$2) RETURNING id', [ryhmId, kuupaev]);
  const nadalId = nadalR.rows[0].id;
  for (const liige of paar1) {
    await pool.query('INSERT INTO padel_kohad (nadal_id, liige_id, paar) VALUES ($1,$2,1)', [nadalId, liige.id]);
  }
  for (const liige of paar2) {
    await pool.query('INSERT INTO padel_kohad (nadal_id, liige_id, paar) VALUES ($1,$2,2)', [nadalId, liige.id]);
  }
  return { nadal_id: nadalId, uus: true };
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

router.post('/ryhm/:id/nadal', noudaPadelLigipaas, async (req, res) => {
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
router.put('/kohad/:id/osalus', noudaPadelLigipaas, async (req, res) => {
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
router.get('/ryhm/:id/asendajad', noudaPadelLigipaas, async (req, res) => {
  try {
    const r = await pool.query('SELECT nimi FROM padel_asendajad WHERE ryhm_id=$1 ORDER BY nimi', [req.params.id]);
    res.json({ ok: true, nimed: r.rows.map(x => x.nimi) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Sisesta/muuda nädala setid (kehtib kohe, ei vaja kinnitust). Asendab kõik setid korraga.
// Playtomicust saadud uksekood selle trenni jaoks (4 kohta, kõik grupi liikmed näevad/saavad muuta)
router.put('/nadalad/:id/uksekood', noudaPadelLigipaas, async (req, res) => {
  const kood = (req.body.kood || '').trim();
  if (kood && !/^[0-9]{1,4}$/.test(kood)) return res.json({ ok: false, veateade: 'Uksekood peab olema kuni 4 numbrit' });
  try {
    await pool.query('UPDATE padel_nadalad SET ukse_kood=$1 WHERE id=$2', [kood || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/nadalad/:id/setid', noudaPadelLigipaas, async (req, res) => {
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

// Minu enda saldo — ainult nädalad, kus ma ISE osalesin (asendaja-nädalad ei lähe minu arvele)
router.get('/minu-saldo', noudaPadelLigipaas, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.nimi AS ryhm_nimi, pn.kuupaev, pk.summa
       FROM padel_kohad pk
       JOIN padel_liikmed pl ON pl.id = pk.liige_id
       JOIN padel_nadalad pn ON pn.id = pk.nadal_id
       JOIN padel_ryhmad r ON r.id = pn.ryhm_id
       WHERE pl.worker_id = $1 AND pk.osaleb = true AND pk.makstud = false AND pk.summa IS NOT NULL
       ORDER BY pn.kuupaev DESC`,
      [req.session.workerId]
    );
    const kokku = r.rows.reduce((s, row) => s + parseFloat(row.summa), 0);
    res.json({ ok: true, vola: r.rows, kokku: +kokku.toFixed(2) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Saada kõigile grupi liikmetele meeldetuletus (push) — admin või liige ise
router.post('/ryhm/:id/meeldetuletus', noudaPadelLigipaas, async (req, res) => {
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

module.exports = router;
