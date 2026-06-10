const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { Parser } = require('json2csv');
const { saadaTeavitus } = require('./push');
const { Resend } = require('resend');
function getResend() { 
  console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'OK' : 'PUUDUB');
  return new Resend(process.env.RESEND_API_KEY); 
}

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ ok: false, veateade: 'Admin Ãµigused puuduvad' });
  }
  next();
}

// â”€â”€ TÃ–Ã–TAJAD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tootajad', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT id, nimi, pin, aktiivne, email FROM workers ORDER BY nimi');
  res.json(r.rows);
});

router.post('/tootajad', noudaAdmin, async (req, res) => {
  const { nimi, pin, email } = req.body;
  try {
    await pool.query('INSERT INTO workers (nimi, pin, email) VALUES ($1, $2, $3)', [nimi, pin, email || null]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See PIN on juba kasutusel' });
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/tootajad/:id', noudaAdmin, async (req, res) => {
  const { nimi, pin, aktiivne, email } = req.body;
  try {
    await pool.query('UPDATE workers SET nimi=$1, pin=$2, aktiivne=$3, email=$4 WHERE id=$5', [nimi, pin, aktiivne, email || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.delete('/tootajad/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM tookirjed WHERE worker_id=$1', [req.params.id]);
    await pool.query('DELETE FROM tulevased_tood WHERE worker_id=$1', [req.params.id]);
    await pool.query('DELETE FROM maksed WHERE worker_id=$1', [req.params.id]);
    await pool.query('DELETE FROM worker_ettevotted WHERE worker_id=$1', [req.params.id]);
    await pool.query('DELETE FROM worker_sessions WHERE worker_id=$1', [req.params.id]);
    await pool.query('DELETE FROM workers WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// â”€â”€ TÃ–Ã–TAJA ETTEVÃ•TTED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tootaja-ettevotted/:workerId', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT we.*, e.nimi as ettevote_nimi, e.tyyp
     FROM worker_ettevotted we
     JOIN ettevotted e ON we.ettevote_id = e.id
     WHERE we.worker_id = $1`,
    [req.params.workerId]
  );
  res.json(r.rows);
});

router.post('/tootaja-ettevotted', noudaAdmin, async (req, res) => {
  const { worker_id, ettevote_id, tunnitasu } = req.body;
  try {
    await pool.query(
      `INSERT INTO worker_ettevotted (worker_id, ettevote_id, tunnitasu)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, ettevote_id) DO UPDATE SET tunnitasu = $3`,
      [worker_id, ettevote_id, tunnitasu]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.delete('/tootaja-ettevotted/:workerId/:ettevoteId', noudaAdmin, async (req, res) => {
  await pool.query(
    'DELETE FROM worker_ettevotted WHERE worker_id=$1 AND ettevote_id=$2',
    [req.params.workerId, req.params.ettevoteId]
  );
  res.json({ ok: true });
});

// â”€â”€ ETTEVÃ•TTED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/ettevotted', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT * FROM ettevotted ORDER BY id');
  res.json(r.rows);
});

// â”€â”€ OBJEKTID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/objektid', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, e.nimi as ettevote_nimi FROM objektid o
       JOIN ettevotted e ON o.ettevote_id = e.id ORDER BY e.id, o.nimi`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.post('/objektid', noudaAdmin, async (req, res) => {
  const { nimi, ettevote_id } = req.body;
  try {
    await pool.query('INSERT INTO objektid (nimi, ettevote_id) VALUES ($1, $2)', [nimi, ettevote_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/objektid/:id', noudaAdmin, async (req, res) => {
  const { nimi, aktiivne } = req.body;
  await pool.query('UPDATE objektid SET nimi=$1, aktiivne=$2 WHERE id=$3', [nimi, aktiivne, req.params.id]);
  res.json({ ok: true });
});

// â”€â”€ MAKSED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/maksed', async (req, res) => {
  const isAdmin = req.session && req.session.isAdmin;
  let { worker_id, aasta, kuu } = req.query;
  if (worker_id === 'self') {
    if (!req.session || !req.session.workerId) return res.status(401).json([]);
    worker_id = req.session.workerId;
  } else if (!isAdmin) {
    return res.status(401).json([]);
  }
  let q = `SELECT m.*, w.nimi as worker_nimi FROM maksed m JOIN workers w ON m.worker_id=w.id WHERE 1=1`;
  const params = [];
  if (worker_id) { params.push(worker_id); q += ` AND m.worker_id=$${params.length}`; }
  if (aasta) { params.push(aasta); q += ` AND EXTRACT(YEAR FROM m.kuupaev)=$${params.length}`; }
  if (kuu) { params.push(kuu); q += ` AND EXTRACT(MONTH FROM m.kuupaev)=$${params.length}`; }
  q += ' ORDER BY m.kuupaev DESC';
  const r = await pool.query(q, params);
  res.json(r.rows);
});

router.post('/maksed', noudaAdmin, async (req, res) => {
  const { worker_id, summa, kuupaev, kommentaar } = req.body;
  await pool.query(
    'INSERT INTO maksed (worker_id, summa, kuupaev, kommentaar) VALUES ($1,$2,$3,$4)',
    [worker_id, summa, kuupaev, kommentaar || '']
  );
  res.json({ ok: true });
});

router.delete('/maksed/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM maksed WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// â”€â”€ TULEVASED TÃ–Ã–D â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tulevased', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT t.*, w.nimi as worker_nimi, w.email as worker_email, e.nimi as ettevote_nimi,
            COALESCE(o.nimi,'') as objekt_nimi
     FROM tulevased_tood t
     JOIN workers w ON t.worker_id=w.id
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     WHERE t.kuupaev >= CURRENT_DATE ORDER BY t.kuupaev, t.algus_kell`
  );
  res.json(r.rows);
});

router.post('/tulevased', noudaAdmin, async (req, res) => {
  const { worker_id, ettevote_id, objekt_id, kuupaev, algus_kell, lopp_kell, kirjeldus } = req.body;
  await pool.query(
    `INSERT INTO tulevased_tood (worker_id, ettevote_id, objekt_id, kuupaev, algus_kell, lopp_kell, kirjeldus)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [worker_id, ettevote_id, objekt_id || null, kuupaev, algus_kell, lopp_kell, kirjeldus || '']
  );
  // Saada push teavitus töötajale
  try {
    const ettevoteInfo = await pool.query('SELECT nimi FROM ettevotted WHERE id=$1', [ettevote_id]);
    const objektInfo = objekt_id ? await pool.query('SELECT nimi FROM objektid WHERE id=$1', [objekt_id]) : null;
    const ettevoteNimi = ettevoteInfo.rows[0]?.nimi || '';
    const objektNimi = objektInfo?.rows[0]?.nimi || '';
    const kp = new Date(kuupaev);
    const kuupaevTekst = `${kp.getDate()}.${kp.getMonth()+1}.${kp.getFullYear()}`;
    const body = `${kuupaevTekst} ${algus_kell||''}${lopp_kell?'-'+lopp_kell:''} · ${ettevoteNimi}${objektNimi?' '+objektNimi:''}${kirjeldus?' · '+kirjeldus:''}`;
    await saadaTeavitus(worker_id, '📅 Uus töö lisatud!', body, '/tootaja');
    // Saada email teavitus
    const workerInfo = await pool.query('SELECT email, nimi FROM workers WHERE id=$1', [worker_id]);
    const workerEmail = workerInfo.rows[0]?.email;
    if (workerEmail) {
      try {
        await getResend().emails.send({
          from: 'Royal Paigaldus <onboarding@resend.dev>',
          to: workerEmail,
          subject: '📅 Uus töö lisatud!',
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
            <h2 style="color:#c9a84c">📅 Uus töö lisatud!</h2>
            <p>Tere ${workerInfo.rows[0].nimi}!</p>
            <p style="font-size:16px;background:#f5f5f5;padding:16px;border-radius:8px">${body}</p>
            <p><a href="https://royal-paigaldus-production.up.railway.app/tootaja" style="background:#c9a84c;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Vaata tööpäevikus</a></p>
            <p style="color:#888;font-size:12px">Royal Paigaldus Tööpäevik</p>
          </div>`
        });
      } catch(emailErr) { console.error('Email ebaõnnestus:', emailErr.message); }
    }
  } catch(e) { console.error('Teavitus ebaõnnestus:', e.message); }
  res.json({ ok: true });
});

router.put('/tulevased/:id', noudaAdmin, async (req, res) => {
  const { kuupaev, algus_kell, lopp_kell, kirjeldus } = req.body;
  try {
    await pool.query(
      'UPDATE tulevased_tood SET kuupaev=$1, algus_kell=$2, lopp_kell=$3, kirjeldus=$4 WHERE id=$5',
      [kuupaev, algus_kell, lopp_kell, kirjeldus||'', req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.delete('/tulevased/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM tulevased_tood WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// â”€â”€ KOKKUVÃ•TE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// ── TÖÖKIRJE TUNNITASU (MUU käsitsi) ─────────────────────────────

// Muuda töökirjet (admin)
router.put('/tookirjed/:id', noudaAdmin, async (req, res) => {
  const { kuupaev, algus, lopp, kommentaar, lisakulu_summa, lisakulu_selgitus } = req.body;
  try {
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    let minutid = (lh * 60 + lm) - (ah * 60 + am);
    if (minutid < 0) minutid += 1440;
    const tunnid = minutid / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });

    // Audit log
    const vana = await pool.query('SELECT * FROM tookirjed WHERE id=$1', [req.params.id]);
    await pool.query(
      `UPDATE tookirjed SET kuupaev=$1, algus=$2, lopp=$3, tunnid=$4, kommentaar=$5, lisakulu_summa=$6, lisakulu_selgitus=$7 WHERE id=$8`,
      [kuupaev, algus, lopp, tunnid, kommentaar||'', parseFloat(lisakulu_summa)||0, lisakulu_selgitus||'', req.params.id]
    );
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [null, 'ADMIN_MUUTIS_TOOKIRJET', JSON.stringify({
        kirje_id: req.params.id,
        vana: { algus: vana.rows[0]?.algus, lopp: vana.rows[0]?.lopp, tunnid: vana.rows[0]?.tunnid },
        uus: { algus, lopp, tunnid: tunnid.toFixed(2) }
      }), req.ip]
    );
    res.json({ ok: true, tunnid: tunnid.toFixed(2) });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// Kustuta töökirje (admin)
router.delete('/tookirjed/:id', noudaAdmin, async (req, res) => {
  try {
    const kirje = await pool.query('SELECT * FROM tookirjed WHERE id=$1', [req.params.id]);
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    await pool.query('DELETE FROM tookirjed WHERE id=$1', [req.params.id]);
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [null, 'ADMIN_KUSTUTAS_TOOKIRJE', JSON.stringify({ kirje_id: req.params.id, tunnid: kirje.rows[0].tunnid }), req.ip]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/tookirjed/:id/tunnitasu', noudaAdmin, async (req, res) => {
  const { tunnitasu } = req.body;
  try {
    // Uuenda worker_ettevotted tunnitasu selle kirje põhjal
    const kirje = await pool.query('SELECT worker_id, ettevote_id FROM tookirjed WHERE id=$1', [req.params.id]);
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    const { worker_id, ettevote_id } = kirje.rows[0];
    // Salvesta ühekordseks kasutuseks otse tookirjed tabelisse lisaveeru kaudu
    await pool.query(
      'UPDATE tookirjed SET muu_tunnitasu=$1 WHERE id=$2',
      [tunnitasu, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.get('/kokkuvote', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const workers = await pool.query('SELECT * FROM workers WHERE aktiivne=true ORDER BY nimi');
  const andmed = [];
  for (const w of workers.rows) {
    const kirjed = await pool.query(
      `SELECT t.id, t.tunnid, t.kuupaev, t.algus, t.lopp, t.kommentaar,
              e.nimi as ettevote_nimi, e.tyyp as ettevote_tyyp, COALESCE(o.nimi,'') as objekt_nimi,
              COALESCE(t.muu_tunnitasu, we.tunnitasu, 0) as tunnitasu,
              COALESCE(we.tunnitasu, 0) as vaikimisi_tunnitasu,
              t.muu_tunnitasu,
              COALESCE(t.km_raha, 0) as km_raha,
              COALESCE(t.lisakulu_summa, 0) as lisakulu_summa,
              COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id=e.id
       LEFT JOIN objektid o ON t.objekt_id=o.id
       LEFT JOIN worker_ettevotted we ON (we.worker_id=t.worker_id AND we.ettevote_id=t.ettevote_id)
       WHERE t.worker_id=$1 AND EXTRACT(YEAR FROM t.kuupaev)=$2 AND EXTRACT(MONTH FROM t.kuupaev)=$3
       ORDER BY t.kuupaev`,
      [w.id, aasta, kuu]
    );
    const tunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);
    const teenitud = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid) * parseFloat(r.tunnitasu), 0);
    const km_raha_kokku = kirjed.rows.reduce((s, r) => s + parseFloat(r.km_raha || 0), 0);
    const lisakulu_kokku = kirjed.rows.reduce((s, r) => s + parseFloat(r.lisakulu_summa || 0), 0);
    const kogusumma = teenitud + km_raha_kokku + lisakulu_kokku;
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);
    andmed.push({
      nimi: w.nimi, tunnid: tunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      km_raha: km_raha_kokku.toFixed(2),
      lisakulu: lisakulu_kokku.toFixed(2),
      kogusumma: kogusumma.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (kogusumma - makstud).toFixed(2),
      kirjed: kirjed.rows
    });
  }
  res.json(andmed);
});

// â”€â”€ CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/raport-csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const r = await pool.query(
    `SELECT w.nimi as tootaja, e.nimi as ettevote, COALESCE(o.nimi,'') as objekt,
            TO_CHAR(t.kuupaev, 'DD.MM.YYYY') as kuupaev,
            TO_CHAR(t.algus, 'HH24:MI') as algus,
            TO_CHAR(t.lopp, 'HH24:MI') as lopp,
            t.tunnid::numeric as tunnid,
            COALESCE(we.tunnitasu,0)::numeric as tunnitasu,
            ROUND(t.tunnid * COALESCE(we.tunnitasu,0), 2)::numeric as summa,
            COALESCE(t.kilomeetrid, 0)::numeric as km,
            COALESCE(t.km_raha, 0)::numeric as km_raha,
            COALESCE(t.lisakulu_summa, 0)::numeric as lisakulu_summa,
            COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus,
            t.kommentaar
     FROM tookirjed t
     JOIN workers w ON t.worker_id=w.id
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     LEFT JOIN worker_ettevotted we ON (we.worker_id=t.worker_id AND we.ettevote_id=t.ettevote_id)
     WHERE EXTRACT(YEAR FROM t.kuupaev)=$1 AND EXTRACT(MONTH FROM t.kuupaev)=$2
     ORDER BY w.nimi, t.kuupaev`,
    [aasta, kuu]
  );

  const read = r.rows;
  if (!read.length) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + 'tootaja;ettevote;objekt;kuupaev;algus;lopp;tunnid;tunnitasu;summa;km;km_raha;lisakulu;lisakulu_selgitus;kommentaar\r\n');
    return;
  }
  const header = 'tootaja;ettevote;objekt;kuupaev;algus;lopp;tunnid;tunnitasu;summa;km;km_raha;lisakulu;lisakulu_selgitus;kommentaar';
  const rows = read.map(k => [
    k.tootaja, k.ettevote, k.objekt, k.kuupaev, k.algus, k.lopp,
    String(parseFloat(k.tunnid)).replace('.', ','),
    String(parseFloat(k.tunnitasu)).replace('.', ','),
    String(parseFloat(k.summa)).replace('.', ','),
    String(parseFloat(k.km)).replace('.', ','),
    String(parseFloat(k.km_raha)).replace('.', ','),
    String(parseFloat(k.lisakulu_summa)).replace('.', ','),
    k.lisakulu_selgitus || '',
    k.kommentaar || ''
  ].join(';')).join('\r\n');

  const kuu2 = `${aasta}-${String(kuu).padStart(2,'0')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="raport-${kuu2}.csv"`);
  res.send('\uFEFF' + header + '\r\n' + rows);
});

module.exports = router;

// ── AUDIT LOG ─────────────────────────────────────────────────────

router.get('/audit-log', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT a.*, w.nimi as worker_nimi
     FROM audit_log a
     LEFT JOIN workers w ON a.worker_id=w.id
     ORDER BY a.loodud DESC`
  );
  res.json(r.rows);
});

// ── FILTER RAPORT ─────────────────────────────────────────────────

async function filterPäring(req) {
  const { ettevote_id, objekt_id, algus, lopp, workers } = req.query;
  const workerList = workers ? workers.split(',').filter(Boolean) : [];
  
  let q = `SELECT t.id, t.tunnid, t.kuupaev, t.algus, t.lopp, t.kommentaar,
            t.kilomeetrid, t.km_raha, t.lisakulu_summa, t.lisakulu_selgitus,
            w.nimi as worker_nimi, e.nimi as ettevote_nimi,
            COALESCE(o.nimi,'') as objekt_nimi,
            COALESCE(we.tunnitasu, t.muu_tunnitasu, 0) as tunnitasu
     FROM tookirjed t
     JOIN workers w ON t.worker_id=w.id
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     LEFT JOIN worker_ettevotted we ON (we.worker_id=t.worker_id AND we.ettevote_id=t.ettevote_id)
     WHERE 1=1`;
  
  const params = [];
  if (ettevote_id) { params.push(ettevote_id); q += ` AND t.ettevote_id=$${params.length}`; }
  if (objekt_id) { params.push(objekt_id); q += ` AND t.objekt_id=$${params.length}`; }
  if (algus) { params.push(algus); q += ` AND t.kuupaev>=$${params.length}`; }
  if (lopp) { params.push(lopp); q += ` AND t.kuupaev<=$${params.length}`; }
  if (workerList.length) { q += ` AND t.worker_id = ANY($${params.length+1}::int[])`; params.push(workerList); }
  q += ' ORDER BY w.nimi, t.kuupaev, t.algus';
  
  const pool2 = require('../db').pool;
  const r = await pool2.query(q, params);
  return r.rows;
}

router.get('/raport-filter', noudaAdmin, async (req, res) => {
  try {
    const rows = await filterPäring(req);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.get('/raport-filter-csv', noudaAdmin, async (req, res) => {
  try {
    const rows = await filterPäring(req);
    const { algus, lopp } = req.query;
    
    const header = 'tootaja;ettevote;objekt;kuupaev;algus;lopp;tunnid;tunnitasu;summa;km;km_raha;lisakulu;lisakulu_selgitus;kommentaar';
    
    let kokku_tunnid = 0, kokku_summa = 0, kokku_km = 0, kokku_lisakulu = 0;
    const dataRows = rows.map(k => {
      const tunnid = parseFloat(k.tunnid);
      const tunnitasu = parseFloat(k.tunnitasu||0);
      const summa = tunnid * tunnitasu;
      const km_raha = parseFloat(k.km_raha||0);
      const lisakulu = parseFloat(k.lisakulu_summa||0);
      kokku_tunnid += tunnid; kokku_summa += summa; kokku_km += km_raha; kokku_lisakulu += lisakulu;
      const kp = new Date(k.kuupaev);
      return [
        k.worker_nimi, k.ettevote_nimi, k.objekt_nimi,
        `${kp.getDate()}.${kp.getMonth()+1}.${kp.getFullYear()}`,
        k.algus?.slice(0,5)||'', k.lopp?.slice(0,5)||'',
        String(tunnid).replace('.', ','),
        String(tunnitasu).replace('.', ','),
        String(summa.toFixed(2)).replace('.', ','),
        String(parseFloat(k.kilomeetrid||0)).replace('.', ','),
        String(km_raha.toFixed(2)).replace('.', ','),
        String(lisakulu.toFixed(2)).replace('.', ','),
        k.lisakulu_selgitus||'',
        k.kommentaar||''
      ].join(';');
    });

    // Kokku rida
    const kogusumma = kokku_summa + kokku_km + kokku_lisakulu;
    dataRows.push(`KOKKU;;;;;;;${String(kokku_tunnid.toFixed(1)).replace('.', ',')};;${String(kokku_summa.toFixed(2)).replace('.', ',')};;${String(kokku_km.toFixed(2)).replace('.', ',')};;${String(kokku_lisakulu.toFixed(2)).replace('.', ',')};;Kogusumma: ${String(kogusumma.toFixed(2)).replace('.', ',')}`);

    const failiNimi = `raport_${algus||''}${lopp?'_'+lopp:''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}"`);
    res.send('\uFEFF' + header + '\r\n' + dataRows.join('\r\n'));
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
