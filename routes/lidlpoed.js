const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// ── LIDL PROJEKTIDE POED ("Tulevased projektid") ─────────────────────────────
// Admin määrab iga Lidl projekti (lidl_projektid) juurde poed, kus see töö tuleb teha.
// - Töötaja pealeht näitab "Tulevased projektid": projekt → poed, tehtud/tegemata.
// - Töökirje vormis tõstetakse valitud projekti tegemata poed objekti valikus ette.
// - Lidl Eesti fotovaates (routes/kristo.js) näidatakse projekti all ainult neid poode.
//
// Pood loetakse TEHTUKS automaatselt, kui sellel projektil + poel on vähemalt üks töökirje.
// Admin saab seda käsitsi üle kirjutada (kasitsi_tehtud: true = tehtud, false = tegemata,
// NULL = automaatne), nt kui töö tehti ilma kirjeta või osaliselt ja tuleb uuesti minna.
//
// Töötajad: kui projektile on määratud töötajad (lidl_projekt_tootajad), näevad projekti
// "Tulevased projektid" all ainult nemad. Kui ühtegi pole määratud, näevad seda kõik Lidli töötajad.

async function initLidlPoed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lidl_projekt_poed (
      id SERIAL PRIMARY KEY,
      projekt_id INTEGER NOT NULL REFERENCES lidl_projektid(id) ON DELETE CASCADE,
      objekt_id INTEGER NOT NULL REFERENCES objektid(id) ON DELETE CASCADE,
      kasitsi_tehtud BOOLEAN,
      lisatud TIMESTAMP DEFAULT NOW(),
      UNIQUE (projekt_id, objekt_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lidl_projekt_tootajad (
      id SERIAL PRIMARY KEY,
      projekt_id INTEGER NOT NULL REFERENCES lidl_projektid(id) ON DELETE CASCADE,
      worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      lisatud TIMESTAMP DEFAULT NOW(),
      UNIQUE (projekt_id, worker_id)
    );
  `);
  await pool.query(`ALTER TABLE lidl_projektid ADD COLUMN IF NOT EXISTS tahtaeg DATE;`);
  await pool.query(`ALTER TABLE lidl_projektid ADD COLUMN IF NOT EXISTS markus TEXT;`);
}
// Init käivitub serveri stardil; kui see ebaõnnestub (nt lidl_projektid tabel loodi alles hiljem),
// proovitakse uuesti esimese päringu ajal.
let initOk = false;
async function tagaInit() {
  if (initOk) return;
  await initLidlPoed();
  initOk = true;
}
tagaInit().catch(e => console.error('Lidl projekti poodide init ebaõnnestus:', e.message));

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId && !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}
function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// Poe numbri järgi sorteerimine ("623 - Marja" → 623), sama loogika mis Lidl Eesti vaates
const POE_JARJEKORD = `NULLIF(regexp_replace(o.nimi, '^(\\d+).*$', '\\1'), o.nimi)::int NULLS LAST, o.nimi`;

// Töötaja Lidli ettevõtte ID (null, kui töötajal Lidli ligipääsu pole)
async function tootajaLidlId(workerId) {
  const r = await pool.query(
    `SELECT e.id FROM worker_ettevotted we
     JOIN ettevotted e ON e.id = we.ettevote_id
     WHERE we.worker_id = $1 AND e.aktiivne = true AND (e.tyyp = 'lidl' OR UPPER(e.nimi) = 'LIDL')
     ORDER BY e.id LIMIT 1`,
    [workerId]
  );
  return r.rows.length ? r.rows[0].id : null;
}

// Projekti poed koos staatusega. projektIds = massiiv; tagastab read koos projekt_id-ga.
async function poedStaatusega(projektIds) {
  if (!projektIds.length) return [];
  const r = await pool.query(
    `SELECT pp.projekt_id, o.id AS objekt_id, o.nimi AS objekt_nimi, pp.kasitsi_tehtud,
            COALESCE(x.kirjeid, 0)::int AS kirjeid, x.viimane_kuupaev,
            COALESCE(pp.kasitsi_tehtud, COALESCE(x.kirjeid, 0) > 0) AS tehtud
     FROM lidl_projekt_poed pp
     JOIN objektid o ON o.id = pp.objekt_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS kirjeid, MAX(t.kuupaev) AS viimane_kuupaev
       FROM tookirjed t
       WHERE t.lidl_projekt_id = pp.projekt_id AND t.objekt_id = pp.objekt_id
     ) x ON true
     WHERE pp.projekt_id = ANY($1::int[])
     ORDER BY ${POE_JARJEKORD}`,
    [projektIds]
  );
  return r.rows;
}

// ── TÖÖTAJA POOL ─────────────────────────────────────────────────────────────

// Pealehe "Tulevased projektid": aktiivsed projektid, millel on poode ja mis pole veel lõpuni tehtud
router.get('/tulevased', noudaSisslogimist, async (req, res) => {
  try {
    await tagaInit();
    const lidlId = req.session.isAdmin ? null : await tootajaLidlId(req.session.workerId);
    if (!req.session.isAdmin && !lidlId) return res.json({ ok: true, lubatud: false, projektid: [] });
    const p = await pool.query(
      `SELECT lp.id, lp.nimi, lp.tahtaeg, lp.markus
       FROM lidl_projektid lp
       WHERE lp.aktiivne = true
         AND EXISTS (SELECT 1 FROM lidl_projekt_poed pp WHERE pp.projekt_id = lp.id)
         AND (
           $1::int IS NULL
           OR NOT EXISTS (SELECT 1 FROM lidl_projekt_tootajad pt WHERE pt.projekt_id = lp.id)
           OR EXISTS (SELECT 1 FROM lidl_projekt_tootajad pt WHERE pt.projekt_id = lp.id AND pt.worker_id = $1)
         )
       ORDER BY lp.tahtaeg NULLS LAST, lp.jrk_nr, lp.nimi`,
      [req.session.isAdmin ? null : req.session.workerId]
    );
    const poed = await poedStaatusega(p.rows.map(x => x.id));
    const projektid = p.rows.map(pr => {
      const minu = poed.filter(x => x.projekt_id === pr.id);
      const tehtud = minu.filter(x => x.tehtud).length;
      return { ...pr, poed: minu, tehtud, kokku: minu.length };
    }).filter(pr => pr.tehtud < pr.kokku); // lõpuni tehtud projektid pole enam "tulevased"
    res.json({ ok: true, lubatud: true, lidl_ettevote_id: lidlId, projektid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Töökirje vorm: ühe projekti poed (et objekti valikus tegemata poed ette tõsta)
router.get('/projekt/:id/poed', noudaSisslogimist, async (req, res) => {
  try {
    await tagaInit();
    const poed = await poedStaatusega([parseInt(req.params.id, 10)]);
    res.json({ ok: true, poed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── ADMIN ────────────────────────────────────────────────────────────────────

// Kõigi projektide poodide arvud (admini projektide nimekirja jaoks)
router.get('/admin/kokkuvote', noudaAdmin, async (req, res) => {
  try {
    await tagaInit();
    const p = await pool.query(`SELECT id, tahtaeg, markus FROM lidl_projektid`);
    const poed = await poedStaatusega(p.rows.map(x => x.id));
    const tt = await pool.query(
      `SELECT pt.projekt_id, w.nimi FROM lidl_projekt_tootajad pt
       JOIN workers w ON w.id = pt.worker_id ORDER BY w.nimi`
    );
    const kokkuvote = {};
    p.rows.forEach(pr => {
      const minu = poed.filter(x => x.projekt_id === pr.id);
      kokkuvote[pr.id] = {
        kokku: minu.length,
        tehtud: minu.filter(x => x.tehtud).length,
        tahtaeg: pr.tahtaeg,
        markus: pr.markus,
        tootajad: tt.rows.filter(x => x.projekt_id === pr.id).map(x => x.nimi)
      };
    });
    res.json({ ok: true, kokkuvote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kõik aktiivsed Lidli poed + kas see on projekti valitud + staatus
router.get('/admin/:projektId/poed', noudaAdmin, async (req, res) => {
  const projektId = parseInt(req.params.projektId, 10);
  try {
    await tagaInit();
    const projekt = await pool.query(
      `SELECT lp.id, lp.nimi, lp.tahtaeg, lp.markus, lp.aktiivne,
              (SELECT COUNT(*)::int FROM tookirjed t WHERE t.lidl_projekt_id = lp.id) AS kirjeid
       FROM lidl_projektid lp WHERE lp.id = $1`,
      [projektId]
    );
    if (!projekt.rows.length) return res.json({ ok: false, veateade: 'Projekti ei leitud' });
    const koik = await pool.query(
      `SELECT o.id AS objekt_id, o.nimi AS objekt_nimi, o.pood_number
       FROM objektid o
       JOIN ettevotted e ON o.ettevote_id = e.id
       WHERE (e.tyyp = 'lidl' OR UPPER(e.nimi) = 'LIDL') AND o.aktiivne = true
       ORDER BY ${POE_JARJEKORD}`
    );
    const valitud = await poedStaatusega([projektId]);
    const valitudMap = {};
    valitud.forEach(v => { valitudMap[v.objekt_id] = v; });
    const poed = koik.rows.map(o => {
      const v = valitudMap[o.objekt_id];
      return {
        ...o,
        valitud: !!v,
        tehtud: v ? v.tehtud : false,
        kirjeid: v ? v.kirjeid : 0,
        kasitsi_tehtud: v ? v.kasitsi_tehtud : null,
        viimane_kuupaev: v ? v.viimane_kuupaev : null
      };
    });
    // Lidli töötajad + kas nad on sellele projektile määratud
    const tootajad = await pool.query(
      `SELECT DISTINCT w.id, w.nimi,
              EXISTS (SELECT 1 FROM lidl_projekt_tootajad pt WHERE pt.projekt_id = $1 AND pt.worker_id = w.id) AS valitud
       FROM workers w
       JOIN worker_ettevotted we ON we.worker_id = w.id
       JOIN ettevotted e ON e.id = we.ettevote_id
       WHERE (e.tyyp = 'lidl' OR UPPER(e.nimi) = 'LIDL')
         AND w.aktiivne = true AND COALESCE(w.arhiveeritud, false) = false
       ORDER BY w.nimi`,
      [projektId]
    );
    res.json({ ok: true, projekt: projekt.rows[0], poed, tootajad: tootajad.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Salvesta kogu projekt: nimi, aktiivsus, tähtaeg, märkus, poed (asendab kogu valiku) ja töötajad
router.put('/admin/:projektId/poed', noudaAdmin, async (req, res) => {
  const projektId = parseInt(req.params.projektId, 10);
  const ids = (Array.isArray(req.body.objekt_ids) ? req.body.objekt_ids : [])
    .map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  const workerIds = (Array.isArray(req.body.worker_ids) ? req.body.worker_ids : [])
    .map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  const tahtaeg = req.body.tahtaeg || null;
  const markus = (req.body.markus || '').trim() || null;
  const uusNimi = typeof req.body.nimi === 'string' ? req.body.nimi.trim() : null;
  const aktiivne = typeof req.body.aktiivne === 'boolean' ? req.body.aktiivne : null;
  if (uusNimi !== null && !uusNimi) return res.json({ ok: false, veateade: 'Projekti nimi ei saa olla tühi' });
  try { await tagaInit(); } catch (e) { return res.status(500).json({ ok: false, veateade: 'Tabeli loomine ebaõnnestus: ' + e.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vana = await client.query(`SELECT nimi FROM lidl_projektid WHERE id = $1 FOR UPDATE`, [projektId]);
    if (!vana.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: false, veateade: 'Projekti ei leitud' });
    }
    const vanaNimi = vana.rows[0].nimi;
    // Ümbernimetamine: Lidl Eesti vaates on PO/projektinumbrid ja Kristo kommentaarid seotud
    // projekti NIMEGA — need liiguvad uue nime alla kaasa, et midagi ei kaoks.
    if (uusNimi && uusNimi !== vanaNimi) {
      const topelt = await client.query(`SELECT 1 FROM lidl_projektid WHERE nimi = $1 AND id <> $2`, [uusNimi, projektId]);
      if (topelt.rows.length) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, veateade: 'Selle nimega projekt on juba olemas' });
      }
      await client.query(`UPDATE lidl_projektid SET nimi = $1 WHERE id = $2`, [uusNimi, projektId]);
      const info = await client.query(`SELECT to_regclass('lidl_projekti_info') AS t, to_regclass('kristo_kommentaarid') AS k`);
      if (info.rows[0].t) {
        await client.query(
          `UPDATE lidl_projekti_info SET kirjeldus = $1
           WHERE kirjeldus = $2 AND NOT EXISTS (SELECT 1 FROM lidl_projekti_info WHERE kirjeldus = $1)`,
          [uusNimi, vanaNimi]
        );
      }
      if (info.rows[0].k) {
        await client.query(`UPDATE kristo_kommentaarid SET kirjeldus = $1 WHERE kirjeldus = $2`, [uusNimi, vanaNimi]);
      }
    }
    await client.query(
      `UPDATE lidl_projektid SET tahtaeg = $1, markus = $2, aktiivne = COALESCE($3, aktiivne) WHERE id = $4`,
      [tahtaeg, markus, aktiivne, projektId]
    );
    // Eemalda need, mida enam valitud pole (olemasolevate käsitsi staatus jääb alles)
    await client.query(
      `DELETE FROM lidl_projekt_poed WHERE projekt_id = $1 AND NOT (objekt_id = ANY($2::int[]))`,
      [projektId, ids]
    );
    for (const oid of ids) {
      await client.query(
        `INSERT INTO lidl_projekt_poed (projekt_id, objekt_id) VALUES ($1, $2) ON CONFLICT (projekt_id, objekt_id) DO NOTHING`,
        [projektId, oid]
      );
    }
    // Töötajad (tühi nimekiri = kõik Lidli töötajad näevad)
    await client.query(`DELETE FROM lidl_projekt_tootajad WHERE projekt_id = $1`, [projektId]);
    for (const wid of workerIds) {
      await client.query(
        `INSERT INTO lidl_projekt_tootajad (projekt_id, worker_id) VALUES ($1, $2) ON CONFLICT (projekt_id, worker_id) DO NOTHING`,
        [projektId, wid]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, kokku: ids.length, tootajaid: workerIds.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga: ' + err.message });
  } finally {
    client.release();
  }
});

// Kustuta projekt — ainult siis, kui sellel pole ühtegi töökirjet (muidu kaoks fotode kaust
// Lidl Eesti vaatest). Töökirjetega projekti saab ainult mitteaktiivseks muuta.
router.delete('/admin/:projektId', noudaAdmin, async (req, res) => {
  const projektId = parseInt(req.params.projektId, 10);
  try {
    await tagaInit();
    const k = await pool.query(`SELECT COUNT(*)::int AS n FROM tookirjed WHERE lidl_projekt_id = $1`, [projektId]);
    if (k.rows[0].n > 0) {
      return res.json({
        ok: false,
        veateade: `Projektil on ${k.rows[0].n} töökirjet (koos fotodega), seda ei saa kustutada. Võta linnuke "Aktiivne" ära — siis kaob see töötajate valikust, aga ajalugu jääb alles.`
      });
    }
    const r = await pool.query(`DELETE FROM lidl_projektid WHERE id = $1`, [projektId]);
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Projekti ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga: ' + err.message });
  }
});

// Käsitsi staatus ühele poele: { kasitsi: true | false | null }
router.put('/admin/:projektId/staatus/:objektId', noudaAdmin, async (req, res) => {
  const k = req.body.kasitsi;
  const vaartus = k === true ? true : k === false ? false : null;
  try {
    await tagaInit();
    const r = await pool.query(
      `UPDATE lidl_projekt_poed SET kasitsi_tehtud = $1 WHERE projekt_id = $2 AND objekt_id = $3`,
      [vaartus, req.params.projektId, req.params.objektId]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Pood pole selle projekti nimekirjas' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

module.exports = router;
