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
    return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  }
  next();
}

// ── TÖÖTAJAD ──────────────────────────────────────────────────────

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

// ── TÖÖTAJA ETTEVÕTTED ────────────────────────────────────────────

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

// ── ETTEVÕTTED ────────────────────────────────────────────────────

router.get('/ettevotted', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT * FROM ettevotted ORDER BY id');
  res.json(r.rows);
});

// ── OBJEKTID ──────────────────────────────────────────────────────

router.get('/objektid', async (req, res) => {
  try {
    const { ettevote_id } = req.query;
    let q = `SELECT o.*, e.nimi as ettevote_nimi FROM objektid o
       JOIN ettevotted e ON o.ettevote_id = e.id`;
    const params = [];
    if (ettevote_id) { params.push(ettevote_id); q += ` WHERE o.ettevote_id = $${params.length}`; }
    q += ` ORDER BY e.id, o.nimi`;
    const r = await pool.query(q, params);
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

// ── MAKSED ────────────────────────────────────────────────────────

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

// ── TULEVASED TÖÖD ────────────────────────────────────────────────

router.get('/tulevased', noudaAdmin, async (req, res) => {
  const { ettevote_id } = req.query;
  let q = `SELECT t.*, w.nimi as worker_nimi, w.email as worker_email, e.nimi as ettevote_nimi,
            COALESCE(o.nimi,'') as objekt_nimi
     FROM tulevased_tood t
     JOIN workers w ON t.worker_id=w.id
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     WHERE t.kuupaev >= CURRENT_DATE`;
  const params = [];
  if (ettevote_id) { params.push(ettevote_id); q += ` AND t.ettevote_id = $${params.length}`; }
  q += ` ORDER BY t.kuupaev, t.algus_kell`;
  const r = await pool.query(q, params);
  res.json(r.rows);
});

router.post('/tulevased', noudaAdmin, async (req, res) => {
  const { worker_id, ettevote_id, objekt_id, kuupaev, algus_kell, lopp_kell, kirjeldus } = req.body;
  await pool.query(
    `INSERT INTO tulevased_tood (worker_id, ettevote_id, objekt_id, kuupaev, algus_kell, lopp_kell, kirjeldus)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [worker_id, ettevote_id, objekt_id || null, kuupaev, algus_kell, lopp_kell, kirjeldus || '']
  );
  try {
    const ettevoteInfo = await pool.query('SELECT nimi FROM ettevotted WHERE id=$1', [ettevote_id]);
    const objektInfo = objekt_id ? await pool.query('SELECT nimi FROM objektid WHERE id=$1', [objekt_id]) : null;
    const ettevoteNimi = ettevoteInfo.rows[0]?.nimi || '';
    const objektNimi = objektInfo?.rows[0]?.nimi || '';
    const kp = new Date(kuupaev);
    const kuupaevTekst = `${kp.getDate()}.${kp.getMonth()+1}.${kp.getFullYear()}`;
    const body = `${kuupaevTekst} ${algus_kell||''}${lopp_kell?'-'+lopp_kell:''} · ${ettevoteNimi}${objektNimi?' '+objektNimi:''}${kirjeldus?' · '+kirjeldus:''}`;
    await saadaTeavitus(worker_id, '📅 Uus töö lisatud!', body, '/tootaja');
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

// ── TÖÖKIRJED (admin muuda/kustuta) ──────────────────────────────

router.put('/tookirjed/:id', noudaAdmin, async (req, res) => {
  const { kuupaev, algus, lopp, kommentaar, lisakulu_summa, lisakulu_selgitus } = req.body;
  try {
    const [ah, am] = algus.split(':').map(Number);
    const [lh, lm] = lopp.split(':').map(Number);
    let minutid = (lh * 60 + lm) - (ah * 60 + am);
    if (minutid < 0) minutid += 1440;
    const tunnid = minutid / 60;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
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
    const kirje = await pool.query('SELECT worker_id, ettevote_id FROM tookirjed WHERE id=$1', [req.params.id]);
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    await pool.query('UPDATE tookirjed SET muu_tunnitasu=$1 WHERE id=$2', [tunnitasu, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── KOKKUVÕTE ─────────────────────────────────────────────────────

router.get('/kokkuvote', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const kuupaevPiir = `${aasta}-${String(kuu).padStart(2, '0')}-01`;

  const workers = await pool.query('SELECT * FROM workers WHERE aktiivne=true ORDER BY nimi');
  const andmed = [];

  for (const w of workers.rows) {
    // Jooksva kuu kirjed (kuvamiseks)
    const kirjed = await pool.query(
      `SELECT t.id, t.tunnid, t.kuupaev, t.algus, t.lopp, t.kommentaar,
              e.nimi as ettevote_nimi, e.tyyp as ettevote_tyyp, COALESCE(o.nimi,'') as objekt_nimi,
              COALESCE(t.muu_tunnitasu, we.tunnitasu, 0) as tunnitasu,
              COALESCE(we.tunnitasu, 0) as vaikimisi_tunnitasu,
              t.muu_tunnitasu,
              COALESCE(t.km_raha, 0) as km_raha,
              COALESCE(t.lisakulu_summa, 0) as lisakulu_summa,
              COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus,
              t.muudetud_tootaja
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

    // Jooksva kuu EDGF kulud
    const edgfKulud = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM edgf_kulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const edgf_kokku = parseFloat(edgfKulud.rows[0].kokku);

    // Jooksva kuu X-seeria töötaja isiklikud kulud (Minu kulud — kütus, toit, tööriistad jne)
    const xseeriaKulud = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM xseeria_omakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const xseeria_kokku = parseFloat(xseeriaKulud.rows[0].kokku);

    // Jooksva kuu vabad lisakulud
    const lisakulud = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const vabad_lisakulud = parseFloat(lisakulud.rows[0].kokku);

    const kogusumma = teenitud + km_raha_kokku + lisakulu_kokku + edgf_kokku + xseeria_kokku + vabad_lisakulud;

    // Jooksva kuu maksed (kuvamiseks)
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);

    // ── KUMULATIIVNE SAADA VEEL ──────────────────────────────────
    // Kõik teenitud kuni selle kuu lõpuni (kaasa arvatud)
    const kogTeenitudRes = await pool.query(
      `SELECT
         COALESCE(SUM(tk.tunnid * COALESCE(tk.muu_tunnitasu, we.tunnitasu, 0)), 0) +
         COALESCE((SELECT SUM(km_raha) FROM tookirjed WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(lisakulu_summa) FROM tookirjed WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(summa) FROM lisakulud WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(summa) FROM edgf_kulud WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0) +
         COALESCE((SELECT SUM(summa) FROM xseeria_omakulud WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'), 0)
       AS kokku
       FROM tookirjed tk
       LEFT JOIN worker_ettevotted we ON (we.worker_id = tk.worker_id AND we.ettevote_id = tk.ettevote_id)
       WHERE tk.worker_id=$1 AND tk.kuupaev < $2::date + INTERVAL '1 month'`,
      [w.id, kuupaevPiir]
    );

    // Kõik maksed kuni selle kuu lõpuni (kaasa arvatud)
    const kogMakstudRes = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND kuupaev < $2::date + INTERVAL '1 month'`,
      [w.id, kuupaevPiir]
    );

    const kogTeenitud = parseFloat(kogTeenitudRes.rows[0].kokku) || 0;
    const kogMakstud = parseFloat(kogMakstudRes.rows[0].kokku) || 0;

    andmed.push({
      nimi: w.nimi,
      tunnid: tunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      km_raha: km_raha_kokku.toFixed(2),
      lisakulu: lisakulu_kokku.toFixed(2),
      edgf: edgf_kokku.toFixed(2),
      xseeria: xseeria_kokku.toFixed(2),
      kogusumma: kogusumma.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (kogTeenitud - kogMakstud).toFixed(2),
      kirjed: kirjed.rows
    });
  }
  res.json(andmed);
});

// ── CSV RAPORT ────────────────────────────────────────────────────

router.get('/raport-csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;

  // Tookirjed
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

  // EDGF kulud
  const edgf = await pool.query(
    `SELECT w.nimi as tootaja, TO_CHAR(e.kuupaev, 'DD.MM.YYYY') as kuupaev,
            e.summa, e.selgitus
     FROM edgf_kulud e
     JOIN workers w ON e.worker_id = w.id
     WHERE EXTRACT(YEAR FROM e.kuupaev)=$1 AND EXTRACT(MONTH FROM e.kuupaev)=$2
     ORDER BY w.nimi, e.kuupaev`,
    [aasta, kuu]
  );

  const header = 'tootaja;ettevote;objekt;kuupaev;algus;lopp;tunnid;tunnitasu;summa;km;km_raha;lisakulu;lisakulu_selgitus;kommentaar';

  const tookirjeRead = r.rows.map(k => [
    k.tootaja, k.ettevote, k.objekt, k.kuupaev, k.algus, k.lopp,
    String(parseFloat(k.tunnid)).replace('.', ','),
    String(parseFloat(k.tunnitasu)).replace('.', ','),
    String(parseFloat(k.summa)).replace('.', ','),
    String(parseFloat(k.km)).replace('.', ','),
    String(parseFloat(k.km_raha)).replace('.', ','),
    String(parseFloat(k.lisakulu_summa)).replace('.', ','),
    k.lisakulu_selgitus || '',
    k.kommentaar || ''
  ].join(';'));

  // EDGF read — summa läheb "lisakulu" veergu
  const edgfRead = edgf.rows.map(e => [
    e.tootaja, 'EDGF 2026', '', e.kuupaev, '', '',
    '0', '0', '0', '0', '0',
    String(parseFloat(e.summa)).replace('.', ','),
    e.selgitus || '',
    ''
  ].join(';'));

  const koikRead = [...tookirjeRead, ...edgfRead];

  if (!koikRead.length) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('﻿' + header + '\r\n');
    return;
  }

  const kuu2 = `${aasta}-${String(kuu).padStart(2,'0')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="raport-${kuu2}.csv"`);
  res.send('﻿' + header + '\r\n' + koikRead.join('\r\n'));
});


router.post('/raport-excel', noudaAdmin, async (req, res) => {
  const { andmed, tyyp, algus, lopp, esitus_hind } = req.body;
  if (!andmed || !andmed.length) return res.status(400).json({ ok: false, veateade: 'Andmed puuduvad' });

  try {
    const ExcelJS = require('exceljs');
    const km_maar = 0.24;
    const km_hind = 0.5; // €/km, käibemaksuta — Lidli arve kilometraaži hind
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Raport');

    const headers = ['Töötaja','Kuupäev','Objekt','Algus','Lõpp','Tunnid','Esitushind (km-ta)','KM 24%','Summa (km-ga)'];
    if (tyyp === 'lidl') {
      headers.push('Km','Km hind (km-ta)','KM 24%','Km summa (km-ga)','Lisakulu (km-ta)','KM 24%','Lisakulu summa (km-ga)','Selgitus','Rea KOKKU (km-ga)','Kommentaar');
    }
    const ncols = headers.length;
    // Numbriveerud (0-indeksiga, vastavalt rida-massiivile) — paremjoondus + numFmt
    const numCols = tyyp === 'lidl'
      ? [5,6,7,8,9,10,11,12,13,14,15,17]
      : [5,6,7,8];

    // Rida 1 - pealkiri
    ws.mergeCells(1, 1, 1, ncols);
    const titleCell = ws.getCell('A1');
    titleCell.value = `${tyyp.toUpperCase()} RAPORT  |  ${algus} - ${lopp}  |  ${esitus_hind}€/h + KM${tyyp === 'lidl' ? `  |  Km ${km_hind}€/km + KM` : ''}`;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    titleCell.font = { name: 'Arial', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 40;

    // Rida 2 - firma
    ws.mergeCells(2, 1, 2, ncols);
    const subCell = ws.getCell('A2');
    subCell.value = 'Royal Paigaldus OÜ';
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4057' } };
    subCell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFA8C4E0' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 22;

    // Lidli puhul jätame rea 3 arve kokkuvõtte jaoks (täidetakse pärast andmete läbimist)
    const hdrRowIdx = tyyp === 'lidl' ? 4 : 3;
    const dataStartIdx = hdrRowIdx + 1;

    // Päis
    const hdrRow = ws.getRow(hdrRowIdx);
    hdrRow.height = 55;
    headers.forEach((h, i) => {
      const cell = hdrRow.getCell(i + 1);
      cell.value = h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } };
      cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: {style:'thin',color:{argb:'FFB8CCE4'}}, bottom: {style:'thin',color:{argb:'FFB8CCE4'}}, left: {style:'thin',color:{argb:'FFB8CCE4'}}, right: {style:'thin',color:{argb:'FFB8CCE4'}} };
    });

    // Andmed
    let kokku_tunnid = 0;
    let kokku_km_vahemaa = 0, kokku_km_ilm = 0, kokku_km_km = 0, kokku_km_kogu = 0;
    let kokku_lisakulu_ilm = 0, kokku_lisakulu_km = 0, kokku_lisakulu_kogu = 0;
    andmed.forEach((k, i) => {
      const row = ws.getRow(dataStartIdx + i);
      const tunnid = parseFloat(k.tunnid || 0);
      const summa_ilm = Math.round(tunnid * esitus_hind * 100) / 100;
      const tunni_km = Math.round(summa_ilm * km_maar * 100) / 100;
      const summa_km = Math.round((summa_ilm + tunni_km) * 100) / 100;
      kokku_tunnid += tunnid;

      const kp = String(k.kuupaev || '').split('T')[0];
      const parts = kp.split('-');
      const kp_str = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : kp;

      const bgColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFDCE6F1';
      const rida = [k.worker_nimi||'', kp_str, k.objekt_nimi||'',
        (k.algus||'').slice(0,5), (k.lopp||'').slice(0,5),
        tunnid, summa_ilm, tunni_km, summa_km];

      if (tyyp === 'lidl') {
        const kmVahemaa = parseFloat(k.kilomeetrid || 0);
        const km_ilm = Math.round(kmVahemaa * km_hind * 100) / 100;
        const km_km = Math.round(km_ilm * km_maar * 100) / 100;
        const km_kogu = Math.round((km_ilm + km_km) * 100) / 100;

        const lisakulu_ilm = parseFloat(k.lisakulu_summa || 0);
        const lisakulu_km = Math.round(lisakulu_ilm * km_maar * 100) / 100;
        const lisakulu_kogu = Math.round((lisakulu_ilm + lisakulu_km) * 100) / 100;

        const rea_kokku = Math.round((summa_km + km_kogu + lisakulu_kogu) * 100) / 100;

        kokku_km_vahemaa += kmVahemaa;
        kokku_km_ilm += km_ilm; kokku_km_km += km_km; kokku_km_kogu += km_kogu;
        kokku_lisakulu_ilm += lisakulu_ilm; kokku_lisakulu_km += lisakulu_km; kokku_lisakulu_kogu += lisakulu_kogu;

        rida.push(kmVahemaa, km_ilm, km_km, km_kogu, lisakulu_ilm, lisakulu_km, lisakulu_kogu, k.lisakulu_selgitus || '', rea_kokku, k.kommentaar || '');
      }

      rida.forEach((val, j) => {
        const cell = row.getCell(j + 1);
        cell.value = val;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.font = { name: 'Arial', size: 10, bold: j === 0 };
        cell.border = { top: {style:'thin',color:{argb:'FFB8CCE4'}}, bottom: {style:'thin',color:{argb:'FFB8CCE4'}}, left: {style:'thin',color:{argb:'FFB8CCE4'}}, right: {style:'thin',color:{argb:'FFB8CCE4'}} };
        if (numCols.includes(j)) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (typeof val === 'number') cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        }
        row.height = 20;
      });
    });

    // KOKKU rida
    const kokku_row_idx = dataStartIdx + andmed.length;
    const kokku_ilm = Math.round(kokku_tunnid * esitus_hind * 100) / 100;
    const kokku_km24_tunnid = Math.round(kokku_ilm * km_maar * 100) / 100;
    const kokku_tunnid_kogu = Math.round((kokku_ilm + kokku_km24_tunnid) * 100) / 100;
    const kokku_vals = ['KOKKU','','','','', kokku_tunnid, kokku_ilm, kokku_km24_tunnid, kokku_tunnid_kogu];

    let arve_kokku = kokku_tunnid_kogu;
    if (tyyp === 'lidl') {
      arve_kokku = Math.round((kokku_tunnid_kogu + kokku_km_kogu + kokku_lisakulu_kogu) * 100) / 100;
      kokku_vals.push(
        Math.round(kokku_km_vahemaa * 10) / 10, kokku_km_ilm, kokku_km_km, kokku_km_kogu,
        kokku_lisakulu_ilm, kokku_lisakulu_km, kokku_lisakulu_kogu, '',
        arve_kokku, ''
      );
    }

    const kokku_row = ws.getRow(kokku_row_idx);
    kokku_row.height = 26;
    // Paks joon KOKKU rea kohale
    for (let c = 1; c <= ncols; c++) {
      const cell = kokku_row.getCell(c);
      cell.border = {
        top: {style:'medium', color:{argb:'FF1F3864'}},
        bottom: {style:'thin', color:{argb:'FFB8CCE4'}},
        left: {style:'thin', color:{argb:'FFB8CCE4'}},
        right: {style:'thin', color:{argb:'FFB8CCE4'}}
      };
    }
    kokku_vals.forEach((val, j) => {
      const cell = kokku_row.getCell(j + 1);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
      cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.border = { top: {style:'thin',color:{argb:'FFB8CCE4'}}, bottom: {style:'thin',color:{argb:'FFB8CCE4'}}, left: {style:'thin',color:{argb:'FFB8CCE4'}}, right: {style:'thin',color:{argb:'FFB8CCE4'}} };
      if (j === 0) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (numCols.includes(j)) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (typeof val === 'number') cell.numFmt = '#,##0.00';
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });

    // Rida 3 - arve kokkuvõte (ainult Lidl)
    if (tyyp === 'lidl') {
      ws.mergeCells(3, 1, 3, ncols);
      const summaryCell = ws.getCell('A3');
      summaryCell.value = `ARVE KOKKU:  Tööd ${kokku_tunnid_kogu.toFixed(2)}€  +  Kilometraaž ${kokku_km_kogu.toFixed(2)}€  +  Lisakulud ${kokku_lisakulu_kogu.toFixed(2)}€  =  ${arve_kokku.toFixed(2)}€ (km-ga)`;
      summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7431' } };
      summaryCell.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(3).height = 26;
    }

    // Veeru laiused
    const colWidths = [16, 13, 30, 8, 8, 10, 22, 10, 16];
    if (tyyp === 'lidl') colWidths.push(9, 14, 10, 14, 14, 10, 16, 26, 14, 40);
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // AutoFilter
    ws.autoFilter = { from: { row: hdrRowIdx, column: 1 }, to: { row: hdrRowIdx, column: ncols } };
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: hdrRowIdx }];

    const failiNimi = `${tyyp}_raport_${algus}_${lopp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel viga:', err.message);
    res.status(500).json({ ok: false, veateade: 'Excel viga: ' + err.message });
  }
});

// ── TÖÖTAJA DETAILRAPORT (Excel) ────────────────────────────────
// Üks töötaja, vabalt valitav periood — kõik töötunnid (koos tunnitasu ja summaga), kõik kululiigid
// (EDGF/Rally Estonia/X-seeria/vabad lisakulud), maksed ning perioodi + kogu aja saldo ("palju veel võlgu").
// Töökirjete lehel hoiatatakse, kui sama päeva kirjed eri objektidel ajaliselt kattuvad (võimalik viga/pettus).
// Andmete laadimine on eraldi funktsioonis, et sama loogikat saaks kasutada nii ühe töötaja kui
// KÕIGI töötajate koondraportis (vt /koik-tootajad-raport-excel allpool).

async function laeTootajaAndmed(worker_id, algus, lopp) {
  const workerRes = await pool.query('SELECT * FROM workers WHERE id=$1', [worker_id]);
  if (!workerRes.rows.length) return null;
  const worker = workerRes.rows[0];

  const tookirjedRes = await pool.query(
    `SELECT t.id, t.kuupaev, t.algus, t.lopp, t.tunnid, t.kommentaar,
            COALESCE(t.kilomeetrid,0) AS kilomeetrid, COALESCE(t.km_raha,0) AS km_raha,
            COALESCE(t.lisakulu_summa,0) AS lisakulu_summa, COALESCE(t.lisakulu_selgitus,'') AS lisakulu_selgitus,
            t.muudetud_tootaja,
            e.nimi AS ettevote_nimi, COALESCE(o.nimi,'') AS objekt_nimi,
            COALESCE(t.muu_tunnitasu, we.tunnitasu, 0) AS tunnitasu
     FROM tookirjed t
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     LEFT JOIN worker_ettevotted we ON (we.worker_id=t.worker_id AND we.ettevote_id=t.ettevote_id)
     WHERE t.worker_id=$1 AND t.kuupaev BETWEEN $2 AND $3
     ORDER BY t.kuupaev, t.algus`,
    [worker_id, algus, lopp]
  );

  // Töötaja enda tehtud töökirje-muudatuste ajalugu (auditiks) — igale kirjele leiame
  // KÕIGE ESIMESE muudatuse, et näidata algselt sisestatud vs praegused tunnid ühel real.
  const auditRes = await pool.query(
    `SELECT details, loodud FROM audit_log WHERE worker_id=$1 AND tegevus='MUUDA_TOOKIRJE' ORDER BY loodud ASC`,
    [worker_id]
  );
  const esimeneMuutus = {};
  auditRes.rows.forEach(row => {
    try {
      const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      const kid = String(d.kirje_id);
      if (d.vana_tunnid !== undefined && !esimeneMuutus[kid]) {
        esimeneMuutus[kid] = { vana_tunnid: d.vana_tunnid, vana_algus: d.vana_algus, vana_lopp: d.vana_lopp };
      }
    } catch (e) { /* ignore vigased kirjed */ }
  });

  const edgfRes = await pool.query(
    `SELECT kuupaev, summa, selgitus FROM edgf_kulud WHERE worker_id=$1 AND kuupaev BETWEEN $2 AND $3 ORDER BY kuupaev`,
    [worker_id, algus, lopp]
  );
  const reRes = await pool.query(
    `SELECT kuupaev, summa, selgitus FROM re_kulud WHERE worker_id=$1 AND kuupaev BETWEEN $2 AND $3 ORDER BY kuupaev`,
    [worker_id, algus, lopp]
  );
  const xseeriaRes = await pool.query(
    `SELECT ok.kuupaev, ok.summa, ok.selgitus, ev.nimi AS event_nimi
     FROM xseeria_omakulud ok
     LEFT JOIN xseeria_events ev ON ev.id = ok.event_id
     WHERE ok.worker_id=$1 AND ok.kuupaev BETWEEN $2 AND $3 ORDER BY ok.kuupaev`,
    [worker_id, algus, lopp]
  );
  const lisakuludRes = await pool.query(
    `SELECT kuupaev, summa, selgitus FROM lisakulud WHERE worker_id=$1 AND kuupaev BETWEEN $2 AND $3 ORDER BY kuupaev`,
    [worker_id, algus, lopp]
  );
  const maksedRes = await pool.query(
    `SELECT kuupaev, summa, kommentaar FROM maksed WHERE worker_id=$1 AND kuupaev BETWEEN $2 AND $3 ORDER BY kuupaev`,
    [worker_id, algus, lopp]
  );

  // Kogu aja seis kuni lõppkuupäevani (sama loogika, mis /kokkuvote kasutab kumulatiivse saldo jaoks)
  const kogTeenitudRes = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(tk.tunnid * COALESCE(tk.muu_tunnitasu, we.tunnitasu, 0))
                  FROM tookirjed tk LEFT JOIN worker_ettevotted we ON (we.worker_id=tk.worker_id AND we.ettevote_id=tk.ettevote_id)
                  WHERE tk.worker_id=$1 AND tk.kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(km_raha) FROM tookirjed WHERE worker_id=$1 AND kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(lisakulu_summa) FROM tookirjed WHERE worker_id=$1 AND kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(summa) FROM lisakulud WHERE worker_id=$1 AND kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(summa) FROM edgf_kulud WHERE worker_id=$1 AND kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(summa) FROM re_kulud WHERE worker_id=$1 AND kuupaev <= $2), 0) +
       COALESCE((SELECT SUM(summa) FROM xseeria_omakulud WHERE worker_id=$1 AND kuupaev <= $2), 0)
     AS kokku`,
    [worker_id, lopp]
  );
  const kogMakstudRes = await pool.query(
    `SELECT COALESCE(SUM(summa),0) AS kokku FROM maksed WHERE worker_id=$1 AND kuupaev <= $2`,
    [worker_id, lopp]
  );
  const kogTeenitud = parseFloat(kogTeenitudRes.rows[0].kokku) || 0;
  const kogMakstud = parseFloat(kogMakstudRes.rows[0].kokku) || 0;
  const kogSaldo = kogTeenitud - kogMakstud;

  // ── Kattuvate tööaegade tuvastamine (sama päev, kattuvad kellaajad, erinevad kirjed) ──
  function toMin(t) { const p = String(t).slice(0,5).split(':').map(Number); return p[0]*60+(p[1]||0); }
  function kpStr(v) { return v && v.toISOString ? v.toISOString().slice(0,10) : String(v).slice(0,10); }
  const paevaGrupid = {};
  tookirjedRes.rows.forEach(r => {
    const kp = kpStr(r.kuupaev);
    (paevaGrupid[kp] = paevaGrupid[kp] || []).push(r);
  });
  const kattuvad = new Set();
  Object.values(paevaGrupid).forEach(grupp => {
    for (let i = 0; i < grupp.length; i++) {
      for (let j = i + 1; j < grupp.length; j++) {
        const a = grupp[i], b = grupp[j];
        const a1 = toMin(a.algus); let a2 = toMin(a.lopp); if (a2 <= a1) a2 += 1440;
        const b1 = toMin(b.algus); let b2 = toMin(b.lopp); if (b2 <= b1) b2 += 1440;
        if (a1 < b2 && b1 < a2) { kattuvad.add(a.id); kattuvad.add(b.id); }
      }
    }
  });

  return { worker, tookirjedRes, esimeneMuutus, edgfRes, reRes, xseeriaRes, lisakuludRes, maksedRes, kogTeenitud, kogMakstud, kogSaldo, kattuvad, kpStr };
}

router.get('/tootaja-raport-excel', noudaAdmin, async (req, res) => {
  const { worker_id, algus, lopp } = req.query;
  if (!worker_id || !algus || !lopp) {
    return res.status(400).json({ ok: false, veateade: 'worker_id, algus ja lopp on kohustuslikud' });
  }
  try {
    const ExcelJS = require('exceljs');

    const d = await laeTootajaAndmed(worker_id, algus, lopp);
    if (!d) return res.status(404).json({ ok: false, veateade: 'Töötajat ei leitud' });
    const { worker, tookirjedRes, esimeneMuutus, edgfRes, reRes, xseeriaRes, lisakuludRes, maksedRes, kogTeenitud, kogMakstud, kogSaldo, kattuvad, kpStr } = d;

    // ── EXCEL ──
    const wb = new ExcelJS.Workbook();

    // Sheet 1: Kokkuvõte
    const wsK = wb.addWorksheet('Kokkuvõte');
    wsK.mergeCells('A1:B1');
    wsK.getCell('A1').value = `Töötaja detailraport — ${worker.nimi}`;
    wsK.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    wsK.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    wsK.getCell('A1').alignment = { vertical: 'middle' };
    wsK.getRow(1).height = 28;
    wsK.mergeCells('A2:B2');
    wsK.getCell('A2').value = `Periood: ${algus} — ${lopp}`;
    wsK.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

    let row = 4;
    function kvRidaText(label, val, opts) {
      opts = opts || {};
      wsK.getCell('A' + row).value = label;
      wsK.getCell('A' + row).font = { bold: !!opts.bold };
      wsK.getCell('B' + row).value = val;
      wsK.getCell('B' + row).font = { bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
      row++;
    }
    function kvRida(label, val, opts) {
      opts = opts || {};
      wsK.getCell('A' + row).value = label;
      wsK.getCell('A' + row).font = { bold: !!opts.bold };
      const cell = wsK.getCell('B' + row);
      cell.value = val;
      cell.numFmt = '#,##0.00 "€"';
      cell.font = { bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
      row++;
    }

    const kokkuTunnid = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);
    const kokkuTeenitud = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.tunnid) * parseFloat(r.tunnitasu), 0);
    const kokkuKmRaha = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.km_raha), 0);
    const kokkuLisakuluTookirjetel = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.lisakulu_summa), 0);
    const kokkuEdgf = edgfRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
    const kokkuRe = reRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
    const kokkuXseeria = xseeriaRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
    const kokkuVabadLisakulud = lisakuludRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
    const kokkuKulud = kokkuKmRaha + kokkuLisakuluTookirjetel + kokkuEdgf + kokkuRe + kokkuXseeria + kokkuVabadLisakulud;
    const kokkuKohustus = kokkuTeenitud + kokkuKulud;
    const kokkuMakstudPerioodis = maksedRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
    const perioodiSaldo = kokkuKohustus - kokkuMakstudPerioodis;

    wsK.getCell('A' + row).value = 'SELLE PERIOODI KOHTA'; wsK.getCell('A' + row).font = { bold: true, color: { argb: 'FFC0504D' } }; row++;
    kvRidaText('Kokku tunnid', kokkuTunnid.toFixed(2) + ' h');
    kvRida('Teenitud tunnitööst', kokkuTeenitud);
    kvRida('Km/sõidukulu', kokkuKmRaha);
    kvRida('Lisakulud (töökirje juures)', kokkuLisakuluTookirjetel);
    kvRida('EDGF 2026 kulud', kokkuEdgf);
    kvRida('Rally Estonia kulud', kokkuRe);
    kvRida('X-seeria kulud', kokkuXseeria);
    kvRida('Vabad lisakulud', kokkuVabadLisakulud);
    kvRida('KOKKU KOHUSTUS selles perioodis', kokkuKohustus, { bold: true });
    kvRida('Makstud selles perioodis', kokkuMakstudPerioodis);
    kvRida('Perioodi saldo (kohustus − makstud)', perioodiSaldo, { bold: true, color: perioodiSaldo > 0 ? 'FFEF4444' : 'FF16A34A' });
    row++;
    wsK.getCell('A' + row).value = `KOGU AJA SEIS (kuni ${lopp})`; wsK.getCell('A' + row).font = { bold: true, color: { argb: 'FFC0504D' } }; row++;
    kvRida('Kokku teenitud + kulud ajaloos', kogTeenitud);
    kvRida('Kokku makstud ajaloos', kogMakstud);
    kvRida('VÕLGU TÖÖTAJALE (+) / ETTEMAKSTUD (−)', kogSaldo, { bold: true, color: kogSaldo > 0 ? 'FFEF4444' : 'FF16A34A' });
    wsK.getColumn('A').width = 40;
    wsK.getColumn('B').width = 18;

    // Sheet 2: Töökirjed
    const wsT = wb.addWorksheet('Töökirjed');
    const tHeaders = ['Kuupäev', 'Ettevõte', 'Objekt', 'Algus', 'Lõpp', 'Tunnid', 'Tunnitasu €/h', 'Summa €', 'Km', 'Km-raha €', 'Lisakulu €', 'Lisakulu selgitus', 'Kommentaar', '⚠ Kattub teise kirjega', '✏️ Töötaja muutis'];
    const tHdrRow = wsT.addRow(tHeaders);
    tHdrRow.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    tHdrRow.height = 32;
    let trTunnid = 0, trSumma = 0;
    tookirjedRes.rows.forEach((r, i) => {
      const summa = parseFloat(r.tunnid) * parseFloat(r.tunnitasu);
      trTunnid += parseFloat(r.tunnid); trSumma += summa;
      let muudetudStr = '';
      if (r.muudetud_tootaja) {
        const aeg = kpStr(r.muudetud_tootaja) + ' ' + new Date(r.muudetud_tootaja).toTimeString().slice(0, 5);
        const orig = esimeneMuutus[String(r.id)];
        if (orig && orig.vana_tunnid !== undefined) {
          const vanaTunnid = parseFloat(orig.vana_tunnid);
          const uusTunnid = parseFloat(r.tunnid);
          const ajaMuutus = String(orig.vana_algus).slice(0,5) !== String(r.algus).slice(0,5) || String(orig.vana_lopp).slice(0,5) !== String(r.lopp).slice(0,5);
          muudetudStr = `${aeg}: ${vanaTunnid.toFixed(2)}h${ajaMuutus ? ' (' + String(orig.vana_algus).slice(0,5) + '–' + String(orig.vana_lopp).slice(0,5) + ')' : ''} → ${uusTunnid.toFixed(2)}h${ajaMuutus ? ' (' + String(r.algus).slice(0,5) + '–' + String(r.lopp).slice(0,5) + ')' : ''}`;
        } else {
          muudetudStr = aeg;
        }
      }
      const rr = wsT.addRow([
        kpStr(r.kuupaev), r.ettevote_nimi, r.objekt_nimi, String(r.algus).slice(0, 5), String(r.lopp).slice(0, 5),
        parseFloat(r.tunnid), parseFloat(r.tunnitasu), summa,
        parseFloat(r.kilomeetrid), parseFloat(r.km_raha), parseFloat(r.lisakulu_summa), r.lisakulu_selgitus, r.kommentaar || '',
        kattuvad.has(r.id) ? '⚠ JAH' : '',
        muudetudStr
      ]);
      if (i % 2 === 1) rr.eachCell(c => { if (!c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
      if (r.muudetud_tootaja) {
        rr.getCell(15).font = { bold: true, color: { argb: 'FF9A6B00' } };
        rr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; });
      }
      if (kattuvad.has(r.id)) {
        rr.getCell(14).font = { bold: true, color: { argb: 'FFEF4444' } };
        rr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } }; });
      }
    });
    const tTot = wsT.addRow(['KOKKU', '', '', '', '', trTunnid, '', trSumma, '', '', '', '', '', '', '']);
    tTot.font = { bold: true };
    wsT.columns.forEach((c, i) => { c.width = [12, 16, 20, 8, 8, 9, 12, 11, 7, 10, 10, 22, 24, 18, 42][i] || 14; });
    wsT.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tHeaders.length } };
    wsT.views = [{ state: 'frozen', ySplit: 1 }];

    // Sheet 3: Kulud
    const wsKu = wb.addWorksheet('Kulud');
    const kuHdr = wsKu.addRow(['Tüüp', 'Kuupäev', 'Summa €', 'Selgitus', 'Sündmus']);
    kuHdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } }; });
    const kuluRead = [
      ...edgfRes.rows.map(r => ['EDGF 2026', r.kuupaev, parseFloat(r.summa), r.selgitus, '']),
      ...reRes.rows.map(r => ['Rally Estonia', r.kuupaev, parseFloat(r.summa), r.selgitus, '']),
      ...xseeriaRes.rows.map(r => ['X-seeria', r.kuupaev, parseFloat(r.summa), r.selgitus, r.event_nimi || '']),
      ...lisakuludRes.rows.map(r => ['Vaba lisakulu', r.kuupaev, parseFloat(r.summa), r.selgitus, ''])
    ].sort((a, b) => new Date(a[1]) - new Date(b[1]));
    let kuluKokku = 0;
    kuluRead.forEach(r => {
      kuluKokku += r[2];
      wsKu.addRow([r[0], kpStr(r[1]), r[2], r[3], r[4]]);
    });
    const kuTot = wsKu.addRow(['KOKKU', '', kuluKokku, '', '']); kuTot.font = { bold: true };
    wsKu.getColumn(3).numFmt = '#,##0.00 "€"';
    wsKu.columns.forEach((c, i) => { c.width = [16, 12, 12, 32, 20][i] || 14; });

    // Sheet 4: Maksed
    const wsM = wb.addWorksheet('Maksed');
    const mHdr = wsM.addRow(['Kuupäev', 'Summa €', 'Kommentaar']);
    mHdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } }; });
    let maksedKokku = 0;
    maksedRes.rows.forEach(r => {
      maksedKokku += parseFloat(r.summa);
      wsM.addRow([kpStr(r.kuupaev), parseFloat(r.summa), r.kommentaar || '']);
    });
    const mTot = wsM.addRow(['KOKKU', maksedKokku, '']); mTot.font = { bold: true };
    wsM.getColumn(2).numFmt = '#,##0.00 "€"';
    wsM.columns.forEach((c, i) => { c.width = [12, 12, 32][i] || 14; });

    const failiNimi = `tootaja_raport_${worker.nimi.replace(/\s+/g, '_')}_${algus}_${lopp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Töötaja raporti viga:', err.message);
    res.status(500).json({ ok: false, veateade: 'Viga: ' + err.message });
  }
});

// ── KÕIKIDE TÖÖTAJATE DETAILRAPORT (Excel) ──────────────────────
// Sama sisu, mis /tootaja-raport-excel, aga KÕIGI aktiivsete töötajate kohta korraga —
// igaüks saab failis oma eraldi Exceli lehe (üks koondatud leht: kokkuvõte + töökirjed + kulud + maksed).

function lisaTootajaKoondLeht(wb, d, algus, lopp, kasutatudNimed) {
  const { worker, tookirjedRes, esimeneMuutus, edgfRes, reRes, xseeriaRes, lisakuludRes, maksedRes, kogTeenitud, kogMakstud, kogSaldo, kattuvad, kpStr } = d;
  const NCOLS = 15;

  // Lehe nimi: Exceli piirang 31 tähemärki, keelatud märgid : \ / ? * [ ], peab olema unikaalne
  let baasNimi = worker.nimi.replace(/[:\\/?*\[\]]/g, '').trim().slice(0, 31) || `Töötaja ${worker.id}`;
  let lehNimi = baasNimi, n = 2;
  while (kasutatudNimed.has(lehNimi.toLowerCase())) { lehNimi = (baasNimi.slice(0, 28) + '_' + n).slice(0, 31); n++; }
  kasutatudNimed.add(lehNimi.toLowerCase());

  const ws = wb.addWorksheet(lehNimi);

  ws.mergeCells(1, 1, 1, NCOLS);
  ws.getCell('A1').value = `Töötaja detailraport — ${worker.nimi}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  ws.getCell('A1').alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, NCOLS);
  ws.getCell('A2').value = `Periood: ${algus} — ${lopp}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

  let row = 4;
  function kvRidaText(label, val, opts) {
    opts = opts || {};
    ws.mergeCells(row, 1, row, 3);
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: !!opts.bold };
    ws.mergeCells(row, 4, row, 5);
    ws.getCell(row, 4).value = val;
    ws.getCell(row, 4).font = { bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
    row++;
  }
  function kvRida(label, val, opts) {
    opts = opts || {};
    ws.mergeCells(row, 1, row, 3);
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: !!opts.bold };
    ws.mergeCells(row, 4, row, 5);
    const cell = ws.getCell(row, 4);
    cell.value = val;
    cell.numFmt = '#,##0.00 "€"';
    cell.font = { bold: !!opts.bold, color: opts.color ? { argb: opts.color } : undefined };
    row++;
  }

  const kokkuTunnid = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);
  const kokkuTeenitud = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.tunnid) * parseFloat(r.tunnitasu), 0);
  const kokkuKmRaha = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.km_raha), 0);
  const kokkuLisakuluTookirjetel = tookirjedRes.rows.reduce((s, r) => s + parseFloat(r.lisakulu_summa), 0);
  const kokkuEdgf = edgfRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
  const kokkuRe = reRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
  const kokkuXseeria = xseeriaRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
  const kokkuVabadLisakulud = lisakuludRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
  const kokkuKulud = kokkuKmRaha + kokkuLisakuluTookirjetel + kokkuEdgf + kokkuRe + kokkuXseeria + kokkuVabadLisakulud;
  const kokkuKohustus = kokkuTeenitud + kokkuKulud;
  const kokkuMakstudPerioodis = maksedRes.rows.reduce((s, r) => s + parseFloat(r.summa), 0);
  const perioodiSaldo = kokkuKohustus - kokkuMakstudPerioodis;

  ws.getCell('A' + row).value = 'SELLE PERIOODI KOHTA'; ws.getCell('A' + row).font = { bold: true, color: { argb: 'FFC0504D' } }; row++;
  kvRidaText('Kokku tunnid', kokkuTunnid.toFixed(2) + ' h');
  kvRida('Teenitud tunnitööst', kokkuTeenitud);
  kvRida('Km/sõidukulu', kokkuKmRaha);
  kvRida('Lisakulud (töökirje juures)', kokkuLisakuluTookirjetel);
  kvRida('EDGF 2026 kulud', kokkuEdgf);
  kvRida('Rally Estonia kulud', kokkuRe);
  kvRida('X-seeria kulud', kokkuXseeria);
  kvRida('Vabad lisakulud', kokkuVabadLisakulud);
  kvRida('KOKKU KOHUSTUS selles perioodis', kokkuKohustus, { bold: true });
  kvRida('Makstud selles perioodis', kokkuMakstudPerioodis);
  kvRida('Perioodi saldo (kohustus − makstud)', perioodiSaldo, { bold: true, color: perioodiSaldo > 0 ? 'FFEF4444' : 'FF16A34A' });
  row++;
  ws.getCell('A' + row).value = `KOGU AJA SEIS (kuni ${lopp})`; ws.getCell('A' + row).font = { bold: true, color: { argb: 'FFC0504D' } }; row++;
  kvRida('Kokku teenitud + kulud ajaloos', kogTeenitud);
  kvRida('Kokku makstud ajaloos', kogMakstud);
  kvRida('VÕLGU TÖÖTAJALE (+) / ETTEMAKSTUD (−)', kogSaldo, { bold: true, color: kogSaldo > 0 ? 'FFEF4444' : 'FF16A34A' });
  row += 2;

  // TÖÖKIRJED
  ws.mergeCells(row, 1, row, NCOLS);
  ws.getCell(row, 1).value = '📋 TÖÖKIRJED';
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4057' } };
  row++;
  const tHeaders = ['Kuupäev', 'Ettevõte', 'Objekt', 'Algus', 'Lõpp', 'Tunnid', 'Tunnitasu €/h', 'Summa €', 'Km', 'Km-raha €', 'Lisakulu €', 'Lisakulu selgitus', 'Kommentaar', '⚠ Kattub teise kirjega', '✏️ Töötaja muutis'];
  const tHdrRow = ws.getRow(row);
  tHeaders.forEach((h, i) => {
    const c = tHdrRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  tHdrRow.height = 32;
  row++;
  let trTunnid = 0, trSumma = 0;
  tookirjedRes.rows.forEach((r, i) => {
    const summa = parseFloat(r.tunnid) * parseFloat(r.tunnitasu);
    trTunnid += parseFloat(r.tunnid); trSumma += summa;
    let muudetudStr = '';
    if (r.muudetud_tootaja) {
      const aeg = kpStr(r.muudetud_tootaja) + ' ' + new Date(r.muudetud_tootaja).toTimeString().slice(0, 5);
      const orig = esimeneMuutus[String(r.id)];
      if (orig && orig.vana_tunnid !== undefined) {
        const vanaTunnid = parseFloat(orig.vana_tunnid);
        const uusTunnid = parseFloat(r.tunnid);
        const ajaMuutus = String(orig.vana_algus).slice(0, 5) !== String(r.algus).slice(0, 5) || String(orig.vana_lopp).slice(0, 5) !== String(r.lopp).slice(0, 5);
        muudetudStr = `${aeg}: ${vanaTunnid.toFixed(2)}h${ajaMuutus ? ' (' + String(orig.vana_algus).slice(0, 5) + '–' + String(orig.vana_lopp).slice(0, 5) + ')' : ''} → ${uusTunnid.toFixed(2)}h${ajaMuutus ? ' (' + String(r.algus).slice(0, 5) + '–' + String(r.lopp).slice(0, 5) + ')' : ''}`;
      } else {
        muudetudStr = aeg;
      }
    }
    const rr = ws.getRow(row);
    const vals = [
      kpStr(r.kuupaev), r.ettevote_nimi, r.objekt_nimi, String(r.algus).slice(0, 5), String(r.lopp).slice(0, 5),
      parseFloat(r.tunnid), parseFloat(r.tunnitasu), summa,
      parseFloat(r.kilomeetrid), parseFloat(r.km_raha), parseFloat(r.lisakulu_summa), r.lisakulu_selgitus, r.kommentaar || '',
      kattuvad.has(r.id) ? '⚠ JAH' : '',
      muudetudStr
    ];
    vals.forEach((v, ci) => { rr.getCell(ci + 1).value = v; });
    if (i % 2 === 1) rr.eachCell(c => { if (!c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
    if (r.muudetud_tootaja) {
      rr.getCell(15).font = { bold: true, color: { argb: 'FF9A6B00' } };
      rr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; });
    }
    if (kattuvad.has(r.id)) {
      rr.getCell(14).font = { bold: true, color: { argb: 'FFEF4444' } };
      rr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } }; });
    }
    row++;
  });
  const tTotRow = ws.getRow(row);
  ['KOKKU', '', '', '', '', trTunnid, '', trSumma, '', '', '', '', '', '', ''].forEach((v, ci) => { tTotRow.getCell(ci + 1).value = v; });
  tTotRow.font = { bold: true };
  row += 2;

  // KULUD
  ws.mergeCells(row, 1, row, NCOLS);
  ws.getCell(row, 1).value = '💶 KULUD (EDGF / Rally Estonia / X-seeria / vabad lisakulud)';
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4057' } };
  row++;
  const kuHdrRow = ws.getRow(row);
  ['Tüüp', 'Kuupäev', 'Summa €', 'Selgitus', 'Sündmus'].forEach((h, ci) => {
    const c = kuHdrRow.getCell(ci + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } };
  });
  row++;
  const kuluRead = [
    ...edgfRes.rows.map(r => ['EDGF 2026', r.kuupaev, parseFloat(r.summa), r.selgitus, '']),
    ...reRes.rows.map(r => ['Rally Estonia', r.kuupaev, parseFloat(r.summa), r.selgitus, '']),
    ...xseeriaRes.rows.map(r => ['X-seeria', r.kuupaev, parseFloat(r.summa), r.selgitus, r.event_nimi || '']),
    ...lisakuludRes.rows.map(r => ['Vaba lisakulu', r.kuupaev, parseFloat(r.summa), r.selgitus, ''])
  ].sort((a, b) => new Date(a[1]) - new Date(b[1]));
  let kuluKokku = 0;
  kuluRead.forEach(r => {
    kuluKokku += r[2];
    const rr = ws.getRow(row);
    [r[0], kpStr(r[1]), r[2], r[3], r[4]].forEach((v, ci) => { rr.getCell(ci + 1).value = v; });
    row++;
  });
  const kuTotRow = ws.getRow(row);
  ['KOKKU', '', kuluKokku, '', ''].forEach((v, ci) => { kuTotRow.getCell(ci + 1).value = v; });
  kuTotRow.font = { bold: true };
  row += 2;

  // MAKSED
  ws.mergeCells(row, 1, row, NCOLS);
  ws.getCell(row, 1).value = '💰 MAKSED';
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E4057' } };
  row++;
  const mHdrRow = ws.getRow(row);
  ['Kuupäev', 'Summa €', 'Kommentaar'].forEach((h, ci) => {
    const c = mHdrRow.getCell(ci + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0504D' } };
  });
  row++;
  let maksedKokku = 0;
  maksedRes.rows.forEach(r => {
    maksedKokku += parseFloat(r.summa);
    const rr = ws.getRow(row);
    [kpStr(r.kuupaev), parseFloat(r.summa), r.kommentaar || ''].forEach((v, ci) => { rr.getCell(ci + 1).value = v; });
    row++;
  });
  const mTotRow = ws.getRow(row);
  ['KOKKU', maksedKokku, ''].forEach((v, ci) => { mTotRow.getCell(ci + 1).value = v; });
  mTotRow.font = { bold: true };

  ws.columns.forEach((c, i) => { c.width = [14, 18, 20, 8, 8, 9, 12, 11, 7, 10, 10, 22, 24, 18, 42][i] || 14; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

router.get('/koik-tootajad-raport-excel', noudaAdmin, async (req, res) => {
  const { algus, lopp } = req.query;
  if (!algus || !lopp) {
    return res.status(400).json({ ok: false, veateade: 'algus ja lopp on kohustuslikud' });
  }
  try {
    const ExcelJS = require('exceljs');
    const workersRes = await pool.query('SELECT * FROM workers WHERE aktiivne=true ORDER BY nimi');
    const wb = new ExcelJS.Workbook();
    const kasutatudNimed = new Set();

    for (const w of workersRes.rows) {
      const d = await laeTootajaAndmed(w.id, algus, lopp);
      if (!d) continue;
      lisaTootajaKoondLeht(wb, d, algus, lopp, kasutatudNimed);
    }

    if (!wb.worksheets.length) {
      return res.status(400).json({ ok: false, veateade: 'Aktiivseid töötajaid ei leitud' });
    }

    const failiNimi = `koik_tootajad_raport_${algus}_${lopp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Kõikide töötajate raporti viga:', err.message);
    res.status(500).json({ ok: false, veateade: 'Viga: ' + err.message });
  }
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
            t.objekt_id,
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

    const kogusumma = kokku_summa + kokku_km + kokku_lisakulu;
    dataRows.push(`KOKKU;;;;;;;${String(kokku_tunnid.toFixed(1)).replace('.', ',')};;${String(kokku_summa.toFixed(2)).replace('.', ',')};;${String(kokku_km.toFixed(2)).replace('.', ',')};;${String(kokku_lisakulu.toFixed(2)).replace('.', ',')};;Kogusumma: ${String(kogusumma.toFixed(2)).replace('.', ',')}`);

    const failiNimi = `raport_${algus||''}${lopp?'_'+lopp:''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${failiNimi}"`);
    res.send('﻿' + header + '\r\n' + dataRows.join('\r\n'));
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
