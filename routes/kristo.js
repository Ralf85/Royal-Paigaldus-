const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const KRISTO_WORKER_ID = 17;
function noudaKristo(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Logi sisse' });
  if (req.session.workerId !== KRISTO_WORKER_ID && !req.session.isAdmin) {
    return res.status(403).json({ ok: false, veateade: 'Ligipääs keelatud' });
  }
  next();
}
function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(403).json({ ok: false, veateade: 'Ainult admin' });
  next();
}

// Ühine grupeerimisvõti "projekti" jaoks: eelistatakse struktureeritud lidl_projektid nimekirja
// (lidl_projekt_id), aga vanad, enne seda tekkinud kirjed grupeeritakse endiselt oma vaba kommentaari
// teksti järgi, et ajalugu ei kaoks ega jookseks kokku "Määramata" alla.
const KIRJELDUS_VOTI = `COALESCE(lp.nimi, t.kommentaar, 'Määramata')`;
const LP_JOIN = `LEFT JOIN lidl_projektid lp ON t.lidl_projekt_id = lp.id`;

// ── TASE 1: Poed (Lidl kauplused, kus on pilte) ──────────────────────────
router.get('/poed', noudaKristo, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         o.id as objekt_id,
         o.nimi as objekt_nimi,
         COUNT(DISTINCT ${KIRJELDUS_VOTI}) as projektide_arv,
         COUNT(DISTINCT p.id) as piltide_arv,
         MAX(t.kuupaev) as viimane_kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       ${LP_JOIN}
       WHERE e.nimi = 'LIDL'
       GROUP BY o.id, o.nimi
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY NULLIF(regexp_replace(o.nimi, '^(\\d+).*$', '\\1'), o.nimi)::int NULLS LAST, o.nimi`
    );
    res.json({ ok: true, poed: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── TASE 2: Projektid ühe poe sees ────────────────────────────────────────
router.get('/projektid', noudaKristo, async (req, res) => {
  const { objekt_id } = req.query;
  if (!objekt_id) return res.json({ ok: false, veateade: 'Pood määramata' });
  try {
    const r = await pool.query(
      `SELECT
         ${KIRJELDUS_VOTI} as kirjeldus,
         COUNT(DISTINCT p.id) as piltide_arv,
         MAX(t.kuupaev) as viimane_kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       ${LP_JOIN}
       WHERE e.nimi = 'LIDL' AND o.id = $1
       GROUP BY ${KIRJELDUS_VOTI}
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY MAX(t.kuupaev) DESC`,
      [objekt_id]
    );
    res.json({ ok: true, projektid: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── TASE 3: Pildid poe + projekti järgi ───────────────────────────────────
router.get('/pildid/:objektId', noudaKristo, async (req, res) => {
  const { kirjeldus } = req.query;
  try {
    const r = await pool.query(
      `SELECT p.id, p.url, DATE(t.kuupaev) as kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       ${LP_JOIN}
       WHERE t.objekt_id = $1
         AND ${KIRJELDUS_VOTI} = $2
       ORDER BY t.kuupaev DESC, p.loodud`,
      [req.params.objektId, kirjeldus]
    );
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ZIP allalaadimine Kristole ────────────────────────────────────────────
router.get('/zip/:objektId', noudaKristo, async (req, res) => {
  const archiver = require('archiver');
  const https = require('https');
  const http = require('http');
  const { kirjeldus } = req.query;
  try {
    let query, params;
    if (kirjeldus) {
      query = `SELECT p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               ${LP_JOIN}
               WHERE t.objekt_id = $1 AND ${KIRJELDUS_VOTI} = $2
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId, kirjeldus];
    } else {
      query = `SELECT p.url, p.nimi, DATE(t.kuupaev) as kuupaev, w.nimi as worker_nimi
               FROM tookirje_pildid p
               JOIN tookirjed t ON p.tookirje_id = t.id
               JOIN workers w ON t.worker_id = w.id
               WHERE t.objekt_id = $1
               ORDER BY t.kuupaev, p.loodud`;
      params = [req.params.objektId];
    }
    const pildid = await pool.query(query, params);
    if (!pildid.rows.length) return res.status(404).json({ ok: false, veateade: 'Pilte ei leitud' });
    const objektInfo = await pool.query('SELECT nimi FROM objektid WHERE id=$1', [req.params.objektId]);
    const objektNimi = (objektInfo.rows[0]?.nimi || 'pildid').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${objektNimi}_pildid.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    for (const pilt of pildid.rows) {
      const kuupaev = String(pilt.kuupaev).split('T')[0];
      const fileName = `${kuupaev}_${pilt.nimi || 'pilt.jpg'}`.replace(/[^a-zA-Z0-9-_.]/g, '_');
      await new Promise((resolve, reject) => {
        const url = new URL(pilt.url);
        const proto = url.protocol === 'https:' ? https : http;
        proto.get(pilt.url, (imgRes) => {
          archive.append(imgRes, { name: fileName });
          imgRes.on('end', resolve);
          imgRes.on('error', reject);
        }).on('error', reject);
      });
    }
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: vana vaba-teksti kirjelduse ümbernimetamine/ühendamine ────────
// (ajalooline tööriist — puudutab ainult kirjeid, millel POLE veel lidl_projekt_id-d).
router.put('/kirjeldus', noudaAdmin, async (req, res) => {
  const { vana, uus } = req.body;
  const uusTrim = (uus || '').trim();
  if (!uusTrim) return res.json({ ok: false, veateade: 'Uus kirjeldus puudub' });
  try {
    let r;
    if (!vana || vana === 'Määramata') {
      r = await pool.query(
        `UPDATE tookirjed t SET kommentaar = $1
         FROM objektid o
         JOIN ettevotted e ON o.ettevote_id = e.id
         WHERE t.objekt_id = o.id AND e.nimi = 'LIDL' AND t.kommentaar IS NULL AND t.lidl_projekt_id IS NULL
           AND t.id IN (SELECT tookirje_id FROM tookirje_pildid)`,
        [uusTrim]
      );
    } else {
      r = await pool.query(
        `UPDATE tookirjed t SET kommentaar = $1
         FROM objektid o
         JOIN ettevotted e ON o.ettevote_id = e.id
         WHERE t.objekt_id = o.id AND e.nimi = 'LIDL' AND t.kommentaar = $2 AND t.lidl_projekt_id IS NULL
           AND t.id IN (SELECT tookirje_id FROM tookirje_pildid)`,
        [uusTrim, vana]
      );
    }
    res.json({ ok: true, muudetud: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: vana vaba-teksti kirjelduse grupi ümbermääramine kindlaks projektiks ──
// Erinevalt ülalolevast (mis lihtsalt muudab teksti), määrab see kõikidele antud gruppi kuuluvatele
// kirjetele lidl_projekt_id, nii et need liituvad edaspidi struktureeritud nimekirjaga.
router.put('/kirjeldus/maara-projekt', noudaAdmin, async (req, res) => {
  const { kirjeldus, projekt_id } = req.body;
  if (!kirjeldus || !projekt_id) return res.json({ ok: false, veateade: 'Kirjeldus ja projekt on kohustuslikud' });
  try {
    const r = await pool.query(
      `UPDATE tookirjed t SET lidl_projekt_id = $1
       FROM objektid o
       JOIN ettevotted e ON o.ettevote_id = e.id
       LEFT JOIN lidl_projektid lp ON t.lidl_projekt_id = lp.id
       WHERE t.objekt_id = o.id AND e.nimi = 'LIDL'
         AND ${KIRJELDUS_VOTI} = $2
         AND t.id IN (SELECT tookirje_id FROM tookirje_pildid)`,
      [projekt_id, kirjeldus]
    );
    res.json({ ok: true, muudetud: r.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: vanade (veel projekti alla määramata) vabateksti kirjelduste nimekiri ──
// Näitab, mis vabateksti kirjeldused on veel struktureerimata, mitmes poes ja mitu pilti
// nende all on — et admin saaks need ühe klikiga õige projekti alla tõsta.
router.get('/admin/vanad-kirjeldused', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COALESCE(t.kommentaar, 'Määramata') as kirjeldus,
         COUNT(DISTINCT p.id) as piltide_arv,
         COUNT(DISTINCT o.id) as poode_arv,
         STRING_AGG(DISTINCT o.nimi, ', ') as poed,
         MAX(t.kuupaev) as viimane_kuupaev
       FROM tookirje_pildid p
       JOIN tookirjed t ON p.tookirje_id = t.id
       JOIN objektid o ON t.objekt_id = o.id
       JOIN ettevotted e ON o.ettevote_id = e.id
       WHERE e.nimi = 'LIDL' AND t.lidl_projekt_id IS NULL
       GROUP BY COALESCE(t.kommentaar, 'Määramata')
       HAVING COUNT(DISTINCT p.id) > 0
       ORDER BY COUNT(DISTINCT p.id) DESC`
    );
    res.json({ ok: true, kirjeldused: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: lidl_projektid nimekirja haldus ────────────────────────────────
router.get('/admin/projektid', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM lidl_projektid ORDER BY jrk_nr, nimi`);
    res.json({ ok: true, projektid: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});
router.post('/admin/projektid', noudaAdmin, async (req, res) => {
  const { nimi } = req.body;
  if (!nimi || !nimi.trim()) return res.json({ ok: false, veateade: 'Sisesta projekti nimi' });
  try {
    const jrk = await pool.query(`SELECT COALESCE(MAX(jrk_nr),0)+1 as jrk FROM lidl_projektid`);
    const r = await pool.query(
      `INSERT INTO lidl_projektid (nimi, jrk_nr) VALUES ($1,$2) RETURNING id`,
      [nimi.trim(), jrk.rows[0].jrk]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'Selline projekt on juba olemas' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});
router.put('/admin/projektid/:id', noudaAdmin, async (req, res) => {
  const { nimi, aktiivne } = req.body;
  try {
    await pool.query(
      `UPDATE lidl_projektid SET nimi=COALESCE($1,nimi), aktiivne=COALESCE($2,aktiivne) WHERE id=$3`,
      [nimi || null, typeof aktiivne === 'boolean' ? aktiivne : null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'Selline projekt on juba olemas' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

module.exports = router;
