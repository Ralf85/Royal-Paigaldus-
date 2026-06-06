const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { Parser } = require('json2csv');

function noudaAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  }
  next();
}

// ── TÖÖTAJAD ──────────────────────────────────────────────

router.get('/tootajad', noudaAdmin, async (req, res) => {
  const result = await pool.query('SELECT id, nimi, pin, tunnitasu, aktiivne FROM workers ORDER BY nimi');
  res.json(result.rows);
});

router.post('/tootajad', noudaAdmin, async (req, res) => {
  const { nimi, pin, tunnitasu } = req.body;
  try {
    await pool.query(
      'INSERT INTO workers (nimi, pin, tunnitasu) VALUES ($1, $2, $3)',
      [nimi, pin, tunnitasu]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See PIN on juba kasutusel' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.put('/tootajad/:id', noudaAdmin, async (req, res) => {
  const { nimi, pin, tunnitasu, aktiivne } = req.body;
  try {
    await pool.query(
      'UPDATE workers SET nimi=$1, pin=$2, tunnitasu=$3, aktiivne=$4 WHERE id=$5',
      [nimi, pin, tunnitasu, aktiivne, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── OBJEKTID ──────────────────────────────────────────────

router.get('/objektid', noudaAdmin, async (req, res) => {
  const result = await pool.query('SELECT * FROM objektid ORDER BY nimi');
  res.json(result.rows);
});

router.post('/objektid', noudaAdmin, async (req, res) => {
  const { nimi } = req.body;
  await pool.query('INSERT INTO objektid (nimi) VALUES ($1)', [nimi]);
  res.json({ ok: true });
});

router.put('/objektid/:id', noudaAdmin, async (req, res) => {
  const { nimi, aktiivne } = req.body;
  await pool.query('UPDATE objektid SET nimi=$1, aktiivne=$2 WHERE id=$3', [nimi, aktiivne, req.params.id]);
  res.json({ ok: true });
});

// ── MAKSED ────────────────────────────────────────────────

router.get('/maksed', async (req, res) => {
  // Töötaja saab vaadata enda makseid (worker_id=self)
  const isAdmin = req.session.isAdmin;
  const { aasta, kuu } = req.query;
  let { worker_id } = req.query;

  if (worker_id === 'self') {
    if (!req.session.workerId) return res.status(401).json([]);
    worker_id = req.session.workerId;
  } else if (!isAdmin) {
    return res.status(401).json([]);
  }
  let q = `SELECT m.*, w.nimi as worker_nimi FROM maksed m JOIN workers w ON m.worker_id = w.id WHERE 1=1`;
  const params = [];
  if (worker_id) { params.push(worker_id); q += ` AND m.worker_id = $${params.length}`; }
  if (aasta) { params.push(aasta); q += ` AND EXTRACT(YEAR FROM m.kuupaev) = $${params.length}`; }
  if (kuu) { params.push(kuu); q += ` AND EXTRACT(MONTH FROM m.kuupaev) = $${params.length}`; }
  q += ' ORDER BY m.kuupaev DESC';
  const result = await pool.query(q, params);
  res.json(result.rows);
});

router.post('/maksed', noudaAdmin, async (req, res) => {
  const { worker_id, summa, kuupaev, kommentaar } = req.body;
  await pool.query(
    'INSERT INTO maksed (worker_id, summa, kuupaev, kommentaar) VALUES ($1, $2, $3, $4)',
    [worker_id, summa, kuupaev, kommentaar || '']
  );
  res.json({ ok: true });
});

router.delete('/maksed/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM maksed WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── KOKKUVÕTE (kõik töötajad) ─────────────────────────────

router.get('/kokkuvote', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const workers = await pool.query('SELECT * FROM workers WHERE aktiivne = true ORDER BY nimi');
  const andmed = [];

  for (const w of workers.rows) {
    const kirjed = await pool.query(
      `SELECT t.tunnid, o.nimi as objekt_nimi, t.kuupaev, t.algus, t.lopp, t.kommentaar
       FROM tookirjed t JOIN objektid o ON t.objekt_id = o.id
       WHERE t.worker_id = $1 AND EXTRACT(YEAR FROM t.kuupaev) = $2 AND EXTRACT(MONTH FROM t.kuupaev) = $3
       ORDER BY t.kuupaev`,
      [w.id, aasta, kuu]
    );
    const tunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);
    const teenitud = tunnid * parseFloat(w.tunnitasu);
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [w.id, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);
    andmed.push({
      nimi: w.nimi,
      tunnid: tunnid.toFixed(2),
      tunnitasu: w.tunnitasu,
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (teenitud - makstud).toFixed(2),
      kirjed: kirjed.rows
    });
  }
  res.json(andmed);
});

// ── TULEVASED TÖÖD ───────────────────────────────────────

router.get('/tulevased', noudaAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, w.nimi as worker_nimi FROM tulevased_tood t
     JOIN workers w ON t.worker_id = w.id
     WHERE t.kuupaev >= CURRENT_DATE
     ORDER BY t.kuupaev, t.algus_kell`
  );
  res.json(result.rows);
});

router.post('/tulevased', noudaAdmin, async (req, res) => {
  const { worker_id, firma, objekt, kuupaev, algus_kell, lopp_kell, kirjeldus } = req.body;
  await pool.query(
    `INSERT INTO tulevased_tood (worker_id, firma, objekt, kuupaev, algus_kell, lopp_kell, kirjeldus)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [worker_id, firma, objekt, kuupaev, algus_kell, lopp_kell, kirjeldus || '']
  );
  res.json({ ok: true });
});

router.delete('/tulevased/:id', noudaAdmin, async (req, res) => {
  await pool.query('DELETE FROM tulevased_tood WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── CSV RAPORT ────────────────────────────────────────────

router.get('/raport-csv', noudaAdmin, async (req, res) => {
  const { aasta, kuu } = req.query;
  const result = await pool.query(
    `SELECT w.nimi as Tootaja, o.nimi as Objekt, t.kuupaev as Kuupaev,
            t.algus as Algus, t.lopp as Lopp, t.tunnid as Tunnid,
            w.tunnitasu as Tunnitasu,
            ROUND(t.tunnid * w.tunnitasu, 2) as Summa, t.kommentaar as Kommentaar
     FROM tookirjed t
     JOIN workers w ON t.worker_id = w.id
     JOIN objektid o ON t.objekt_id = o.id
     WHERE EXTRACT(YEAR FROM t.kuupaev) = $1 AND EXTRACT(MONTH FROM t.kuupaev) = $2
     ORDER BY w.nimi, t.kuupaev`,
    [aasta, kuu]
  );

  const parser = new Parser({ delimiter: ';' });
  const csv = parser.parse(result.rows);
  const kuuNimi = `${aasta}-${String(kuu).padStart(2,'0')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="raport-${kuuNimi}.csv"`);
  res.send('\uFEFF' + csv); // BOM Exceli jaoks
});

module.exports = router;
