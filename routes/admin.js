const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { Parser } = require('json2csv');

function noudaAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// ── TÖÖTAJAD ──────────────────────────────────────────────

router.get('/tootajad', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT id, nimi, pin, aktiivne FROM workers ORDER BY nimi');
  res.json(r.rows);
});

router.post('/tootajad', noudaAdmin, async (req, res) => {
  const { nimi, pin } = req.body;
  try {
    await pool.query('INSERT INTO workers (nimi, pin) VALUES ($1, $2)', [nimi, pin]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See PIN on juba kasutusel' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.put('/tootajad/:id', noudaAdmin, async (req, res) => {
  const { nimi, pin, aktiivne } = req.body;
  try {
    await pool.query('UPDATE workers SET nimi=$1, pin=$2, aktiivne=$3 WHERE id=$4', [nimi, pin, aktiivne, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── TÖÖTAJA ETTEVÕTTED JA TUNNITASUD ──────────────────────

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
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.delete('/tootaja-ettevotted/:workerId/:ettevoteId', noudaAdmin, async (req, res) => {
  await pool.query(
    'DELETE FROM worker_ettevotted WHERE worker_id=$1 AND ettevote_id=$2',
    [req.params.workerId, req.params.ettevoteId]
  );
  res.json({ ok: true });
});

// ── ETTEVÕTTED ────────────────────────────────────────────

router.get('/ettevotted', noudaAdmin, async (req, res) => {
  const r = await pool.query('SELECT * FROM ettevotted ORDER BY id');
  res.json(r.rows);
});

// ── OBJEKTID ──────────────────────────────────────────────

router.post('/objektid', async (req, res) => {
  const r = await pool.query(
    `SELECT o.*, e.nimi as ettevote_nimi FROM objektid o
     JOIN ettevotted e ON o.ettevote_id = e.id ORDER BY e.id, o.nimi`
  );
  res.json(r.rows);
});

router.post('/objektid', noudaAdmin, async (req, res) => {
  const { nimi, ettevote_id } = req.body;
  await pool.query('INSERT INTO objektid (nimi, ettevote_id) VALUES ($1, $2)', [nimi, ettevote_id]);
  res.json({ ok: true });
});

router.put('/objektid/:id', noudaAdmin, async (req, res) => {
  const { nimi, aktiivne } = req.body;
  await pool.query('UPDATE objektid SET nimi=$1, aktiivne=$2 WHERE id=$3', [nimi, aktiivne, req.params.id]);
  res.json({ ok: true });
});

// ── MAKSED ────────────────────────────────────────────────

router.get('/maksed', async (req, res) => {
  const isAdmin = req.session.isAdmin;
  let { worker_id, aasta, kuu } = req.query;
  if (worker_id === 'self') {
    if (!req.session.workerId) return res.status(401).json([]);
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

// ── TULEVASED TÖÖD ────────────────────────────────────────

router.get('/tulevased', noudaAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT t.*, w.nimi as worker_nimi, e.nimi as ettevote_nimi,
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
  res.json({ ok: true });
});

router.delete('/tulevased/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM tulevased_tood WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ── KOKKUVÕTE ─────────────────────────────────────────────

router.get('/kokkuvote', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const workers = await pool.query('SELECT * FROM workers WHERE aktiivne=true ORDER BY nimi');
  const andmed = [];
  for (const w of workers.rows) {
    const kirjed = await pool.query(
      `SELECT t.tunnid, t.kuupaev, t.algus, t.lopp, t.kommentaar,
              e.nimi as ettevote_nimi, COALESCE(o.nimi,'') as objekt_nimi,
              COALESCE(we.tunnitasu,0) as tunnitasu
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
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);
    andmed.push({
      nimi: w.nimi,
      tunnid: tunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (teenitud - makstud).toFixed(2),
      kirjed: kirjed.rows
    });
  }
  res.json(andmed);
});

// ── CSV ───────────────────────────────────────────────────

router.get('/raport-csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const r = await pool.query(
    `SELECT w.nimi as Tootaja, e.nimi as Ettevote, COALESCE(o.nimi,'') as Objekt,
            t.kuupaev as Kuupaev, t.algus as Algus, t.lopp as Lopp,
            t.tunnid as Tunnid, COALESCE(we.tunnitasu,0) as Tunnitasu,
            ROUND(t.tunnid * COALESCE(we.tunnitasu,0), 2) as Summa, t.kommentaar as Kommentaar
     FROM tookirjed t
     JOIN workers w ON t.worker_id=w.id
     JOIN ettevotted e ON t.ettevote_id=e.id
     LEFT JOIN objektid o ON t.objekt_id=o.id
     LEFT JOIN worker_ettevotted we ON (we.worker_id=t.worker_id AND we.ettevote_id=t.ettevote_id)
     WHERE EXTRACT(YEAR FROM t.kuupaev)=$1 AND EXTRACT(MONTH FROM t.kuupaev)=$2
     ORDER BY w.nimi, t.kuupaev`,
    [aasta, kuu]
  );
  const parser = new Parser({ delimiter: ';' });
  const csv = parser.parse(r.rows);
  const kuu2 = `${aasta}-${String(kuu).padStart(2,'0')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="raport-${kuu2}.csv"`);
  res.send('\uFEFF' + csv);
});

module.exports = router;
