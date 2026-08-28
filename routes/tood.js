const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

// Töötaja ettevõtted (ainult talle määratud)
router.get('/minu-ettevotted', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id, e.nimi, e.tyyp, we.tunnitasu
       FROM worker_ettevotted we
       JOIN ettevotted e ON we.ettevote_id = e.id
       WHERE we.worker_id = $1 AND e.aktiivne = true
       ORDER BY e.id`,
      [req.session.workerId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// Lidl "projektide" nimekiri (Kristo fotode kaustastruktuuri jaoks) — admin hallatav, kuvatakse
// töökirje lisamisel Lidli töö puhul eraldi valikuna (mitte segi vaba "kommentaar" väljaga).
router.get('/lidl-projektid', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, nimi FROM lidl_projektid WHERE aktiivne=true ORDER BY jrk_nr, nimi`);
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// Objektid ettevõtte järgi
router.get('/objektid/:ettevoteId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM objektid WHERE ettevote_id = $1 AND aktiivne = true ORDER BY nimi`,
      [req.params.ettevoteId]
    );
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// Lisa töökirje
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  const { ettevote_id, objekt_id, kuupaev, algus, lopp, kommentaar, kilomeetrid, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id } = req.body;
  try {
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    let minutid = (lh * 60 + lm) - (ah * 60 + am);
    if (minutid < 0) minutid += 1440;
    let tunnid = minutid / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    const ettevoteInfo = await pool.query('SELECT tyyp FROM ettevotted WHERE id=$1', [ettevote_id]);
    const tyyp = ettevoteInfo.rows[0]?.tyyp || '';
    if (tyyp === 'cramo' && tunnid >= 6) {
      tunnid = tunnid - 0.5;
    }

    const km = parseFloat(kilomeetrid) || 0;
    const km_raha = km > 0 ? (km / 100 * 12) : 0;
    const lisakulu = parseFloat(lisakulu_summa) || 0;
    const lisakulu_sel = lisakulu_selgitus || '';

    const result = await pool.query(
      `INSERT INTO tookirjed (worker_id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, kilomeetrid, km_raha, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [req.session.workerId, ettevote_id, objekt_id || null, kuupaev, algus, lopp, tunnid, kommentaar || '', km, km_raha, lisakulu, lisakulu_sel, lidl_projekt_id || null]
    );
    const kirjeId = result.rows[0].id;

    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'LISA_TOOKIRJE', JSON.stringify({
        kirje_id: kirjeId, ettevote_id, objekt_id, kuupaev, algus, lopp,
        tunnid: tunnid.toFixed(2), kommentaar
      }), req.ip]
    );

    res.json({ ok: true, tunnid: tunnid.toFixed(2), km_raha: km_raha.toFixed(2), kirjeId, lounaPaus: tyyp === 'cramo' && tunnid < (minutid/60) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kustuta töökirje
router.delete('/kustuta/:id', noudaSisslogimist, async (req, res) => {
  try {
    const kirje = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, o.nimi as objekt_nimi
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id=e.id
       LEFT JOIN objektid o ON t.objekt_id=o.id
       WHERE t.id=$1 AND t.worker_id=$2`,
      [req.params.id, req.session.workerId]
    );
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    const k = kirje.rows[0];

    const r = await pool.query(
      `DELETE FROM tookirjed WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (r.rowCount === 0) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });

    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'KUSTUTA_TOOKIRJE', JSON.stringify({
        kirje_id: req.params.id, ettevote: k.ettevote_nimi,
        objekt: k.objekt_nimi, kuupaev: k.kuupaev,
        algus: k.algus, lopp: k.lopp, tunnid: k.tunnid
      }), req.ip]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kuu kokkuvõte
router.get('/kokkuvote', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  const wid = req.session.workerId;
  try {
    const kirjed = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp as ettevote_tyyp,
              COALESCE(o.nimi, '') as objekt_nimi,
              we.tunnitasu,
              COALESCE(t.kilomeetrid, 0) as kilomeetrid,
              COALESCE(t.km_raha, 0) as km_raha,
              COALESCE(t.lisakulu_summa, 0) as lisakulu_summa,
              COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus,
              lp.nimi as lidl_projekt_nimi
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       LEFT JOIN worker_ettevotted we ON (we.worker_id = t.worker_id AND we.ettevote_id = t.ettevote_id)
       LEFT JOIN lidl_projektid lp ON t.lidl_projekt_id = lp.id
       WHERE t.worker_id=$1 AND EXTRACT(YEAR FROM t.kuupaev)=$2 AND EXTRACT(MONTH FROM t.kuupaev)=$3
       ORDER BY t.kuupaev, t.algus`,
      [wid, aasta, kuu]
    );

    // Jooksva kuu teenitud summa
    let teenitud = 0;
    kirjed.rows.forEach(k => {
      teenitud += parseFloat(k.tunnid) * parseFloat(k.tunnitasu || 0);
      teenitud += parseFloat(k.km_raha || 0);
      teenitud += parseFloat(k.lisakulu_summa || 0);
    });

    // Jooksva kuu vabad lisakulud
    const lisakulud = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [wid, aasta, kuu]
    );
    lisakulud.rows.forEach(l => {
      teenitud += parseFloat(l.summa);
    });

    // Jooksva kuu EDGF kulud
    const edgfKulud = await pool.query(
      `SELECT * FROM edgf_kulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [wid, aasta, kuu]
    );
    edgfKulud.rows.forEach(e => {
      teenitud += parseFloat(e.summa);
    });

    const kogutunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);

    // Jooksva kuu maksed (kuvamiseks)
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [wid, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);

    // ── KUMULATIIVNE SAADA VEEL ──────────────────────────────────
    // Kõik teenitud kuni selle kuu lõpuni (kaasa arvatud)
    const kuupaevPiir = `${aasta}-${String(kuu).padStart(2, '0')}-01`;

    const kogTeenitudRes = await pool.query(
      `SELECT
         COALESCE(SUM(tk.tunnid * COALESCE(we.tunnitasu, 0)), 0) +
         COALESCE((SELECT SUM(km_raha) FROM tookirjed WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(lisakulu_summa) FROM tookirjed WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(summa) FROM lisakulud WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(summa) FROM edgf_kulud WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0)
       AS kokku
       FROM tookirjed tk
       LEFT JOIN worker_ettevotted we ON (we.worker_id = tk.worker_id AND we.ettevote_id = tk.ettevote_id)
       WHERE tk.worker_id=$1 AND tk.kuupaev < $2::date + INTERVAL '1 month'`,
      [wid, kuupaevPiir]
    );

    // Kõik maksed kuni selle kuu lõpuni (kaasa arvatud)
    const kogMakstudRes = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'`,
      [wid, kuupaevPiir]
    );

    const kogTeenitud = parseFloat(kogTeenitudRes.rows[0].kokku) || 0;
    const kogMakstud = parseFloat(kogMakstudRes.rows[0].kokku) || 0;

    res.json({
      ok: true,
      kirjed: kirjed.rows,
      lisakulud: lisakulud.rows,
      edgfKulud: edgfKulud.rows,
      kogutunnid: kogutunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (kogTeenitud - kogMakstud).toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Tulevased tööd
router.get('/tulevased', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp,
              COALESCE(o.nimi, '') as objekt_nimi
       FROM tulevased_tood t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       WHERE t.worker_id=$1 AND t.kuupaev >= CURRENT_DATE
       ORDER BY t.kuupaev, t.algus_kell`,
      [req.session.workerId]
    );

    // Lisa igale tööle teised samale kuupäevale/objektile määratud töötajad
    const kirjed = r.rows;
    for (const kirje of kirjed) {
      const teised = await pool.query(
        `SELECT w.nimi FROM tulevased_tood tt
         JOIN workers w ON tt.worker_id = w.id
         WHERE tt.kuupaev = $1
           AND tt.ettevote_id = $2
           AND (tt.objekt_id IS NULL OR tt.objekt_id = $3)
           AND tt.worker_id != $4
         ORDER BY w.nimi`,
        [kirje.kuupaev, kirje.ettevote_id, kirje.objekt_id || null, req.session.workerId]
      );
      kirje.teised_tootajad = teised.rows.map(w => w.nimi);
    }

    res.json(kirjed);
  } catch (err) {
    res.json([]);
  }
});

// ── VABAD LISAKULUD ─────────────────────────────────────────────
router.post('/lisakulu/lisa', noudaSisslogimist, async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    await pool.query(
      `INSERT INTO lisakulud (worker_id, kuupaev, summa, selgitus) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, kuupaev, s, selgitus]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/lisakulu/kuu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    const r = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [req.session.workerId, aasta, kuu]
    );
    res.json({ ok: true, kulud: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.delete('/lisakulu/:id', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM lisakulud WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Töötaja muudab oma töökirjet
router.put('/kirje/:id', noudaSisslogimist, async (req, res) => {
  const { kuupaev, algus, lopp, kommentaar, kilomeetrid, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id } = req.body;
  try {
    const vana = await pool.query(
      'SELECT * FROM tookirjed WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!vana.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });

    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    let minutid = (lh * 60 + lm) - (ah * 60 + am);
    if (minutid < 0) minutid += 1440;
    let tunnid = minutid / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    // Cramo lõunapaus
    const ettevoteInfo = await pool.query('SELECT tyyp FROM ettevotted WHERE id=$1', [vana.rows[0].ettevote_id]);
    const tyyp = ettevoteInfo.rows[0]?.tyyp || '';
    if (tyyp === 'cramo' && tunnid >= 6) tunnid = tunnid - 0.5;

    const km = parseFloat(kilomeetrid) || 0;
    const km_raha = km > 0 ? (km / 100 * 12) : 0;
    const lisakulu = parseFloat(lisakulu_summa) || 0;

    await pool.query(
      `UPDATE tookirjed SET kuupaev=$1, algus=$2, lopp=$3, tunnid=$4, kommentaar=$5,
       kilomeetrid=$6, km_raha=$7, lisakulu_summa=$8, lisakulu_selgitus=$9, lidl_projekt_id=$10, muudetud_tootaja=NOW() WHERE id=$11`,
      [kuupaev, algus, lopp, tunnid, kommentaar || '', km, km_raha, lisakulu, lisakulu_selgitus || '', lidl_projekt_id || null, req.params.id]
    );

    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'MUUDA_TOOKIRJE', JSON.stringify({
        kirje_id: req.params.id,
        kuupaev, algus, lopp, tunnid: tunnid.toFixed(2),
        vana_kuupaev: vana.rows[0].kuupaev, vana_algus: vana.rows[0].algus, vana_lopp: vana.rows[0].lopp,
        vana_tunnid: parseFloat(vana.rows[0].tunnid).toFixed(2)
      }), req.ip]
    );

    res.json({ ok: true, tunnid: tunnid.toFixed(2) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});


// Töökirjete pildid batch
router.get('/pildid-batch', noudaSisslogimist, async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.json({ ok: true, pildid: [] });
  try {
    const idList = ids.split(',').map(Number).filter(Boolean);
    if (!idList.length) return res.json({ ok: true, pildid: [] });
    const r = await pool.query(
      `SELECT tp.*, t.worker_id FROM tookirje_pildid tp
       JOIN tookirjed t ON tp.kirje_id = t.id
       WHERE tp.kirje_id = ANY($1) AND t.worker_id = $2
       ORDER BY tp.loodud ASC`,
      [idList, req.session.workerId]
    );
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    res.json({ ok: true, pildid: [] });
  }
});

module.exports = router;
