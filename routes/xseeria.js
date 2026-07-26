const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function genToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getSession(req) {
  const token = req.headers['x-xseeria-token'] || req.query._token;
  if (!token) return null;
  const r = await pool.query(
    `SELECT s.*, w.nimi AS worker_nimi FROM xseeria_sessions s
     LEFT JOIN xseeria_workers w ON w.id = s.worker_id
     WHERE s.token = $1`,
    [token]
  );
  return r.rows[0] || null;
}

function requireAuth(session, res) {
  if (!session) {
    res.status(401).json({ ok: false, veateade: 'Palun logi uuesti sisse' });
    return false;
  }
  return true;
}

function requireAdmin(session, res) {
  if (!session || !session.is_admin) {
    res.status(403).json({ ok: false, veateade: 'Puudub admini õigus' });
    return false;
  }
  return true;
}

// ---------- LOGIN ----------

router.post('/login', async (req, res) => {
  const { pin } = req.body;
  const r = await pool.query('SELECT * FROM xseeria_workers WHERE pin = $1 AND aktiivne = true', [pin]);
  if (r.rows.length === 0) return res.json({ ok: false, veateade: 'Vale PIN' });
  const worker = r.rows[0];
  const token = genToken();
  await pool.query('INSERT INTO xseeria_sessions (token, worker_id, is_admin) VALUES ($1,$2,false)', [token, worker.id]);
  res.json({ ok: true, token, nimi: worker.nimi });
});

router.post('/admin-login', async (req, res) => {
  const { pin } = req.body;
  const r = await pool.query('SELECT * FROM xseeria_admin WHERE pin = $1', [pin]);
  if (r.rows.length === 0) return res.json({ ok: false, veateade: 'Vale PIN' });
  const admin = r.rows[0];
  const token = genToken();
  await pool.query('INSERT INTO xseeria_sessions (token, is_admin) VALUES ($1,true)', [token]);
  res.json({ ok: true, token, nimi: admin.nimi });
});

// ---------- WORKER + ADMIN: read active event ----------

router.get('/aktiivne', async (req, res) => {
  const session = await getSession(req);
  if (!requireAuth(session, res)) return;
  const ev = await pool.query('SELECT * FROM xseeria_events WHERE aktiivne = true ORDER BY kuupaev DESC LIMIT 1');
  if (ev.rows.length === 0) return res.json({ ok: true, event: null, asukohad: [] });
  const event = ev.rows[0];
  const asukohad = await pool.query('SELECT * FROM xseeria_asukohad WHERE event_id = $1 ORDER BY jrk_nr, nimi', [event.id]);
  res.json({ ok: true, event, asukohad: asukohad.rows });
});

// ---------- WORKER: mark installed / cleaned ----------

router.post('/asukohad/:id/paigaldatud', async (req, res) => {
  const session = await getSession(req);
  if (!requireAuth(session, res)) return;
  const nimi = session.is_admin ? 'Admin' : session.worker_nimi;
  await pool.query(
    `UPDATE xseeria_asukohad SET paigaldus_staatus='tehtud', paigaldas_id=$1, paigaldas_nimi=$2, paigaldatud_kell=NOW() WHERE id=$3`,
    [session.worker_id || null, nimi, req.params.id]
  );
  res.json({ ok: true });
});

router.post('/asukohad/:id/paigaldus-tagasi', async (req, res) => {
  const session = await getSession(req);
  if (!requireAuth(session, res)) return;
  await pool.query(
    `UPDATE xseeria_asukohad SET paigaldus_staatus='ootel', paigaldas_id=NULL, paigaldas_nimi=NULL, paigaldatud_kell=NULL WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

router.post('/asukohad/:id/puhas', async (req, res) => {
  const session = await getSession(req);
  if (!requireAuth(session, res)) return;
  const nimi = session.is_admin ? 'Admin' : session.worker_nimi;
  await pool.query(
    `UPDATE xseeria_asukohad SET puhastus_staatus='tehtud', puhastas_id=$1, puhastas_nimi=$2, puhastatud_kell=NOW() WHERE id=$3`,
    [session.worker_id || null, nimi, req.params.id]
  );
  res.json({ ok: true });
});

router.post('/asukohad/:id/puhastus-tagasi', async (req, res) => {
  const session = await getSession(req);
  if (!requireAuth(session, res)) return;
  await pool.query(
    `UPDATE xseeria_asukohad SET puhastus_staatus='ootel', puhastas_id=NULL, puhastas_nimi=NULL, puhastatud_kell=NULL WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

// ---------- ADMIN: events ----------

router.get('/admin/events', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const r = await pool.query('SELECT * FROM xseeria_events ORDER BY kuupaev DESC');
  res.json({ ok: true, events: r.rows });
});

router.post('/admin/events', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const { nimi, kuupaev, hooaeg } = req.body;
  if (!nimi || !kuupaev) return res.json({ ok: false, veateade: 'Nimi ja kuupäev on kohustuslikud' });
  await pool.query('UPDATE xseeria_events SET aktiivne = false');
  const r = await pool.query(
    'INSERT INTO xseeria_events (nimi, kuupaev, hooaeg, aktiivne) VALUES ($1,$2,$3,true) RETURNING *',
    [nimi, kuupaev, hooaeg || 'suvi']
  );
  res.json({ ok: true, event: r.rows[0] });
});

router.post('/admin/events/:id/aktiveeri', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  await pool.query('UPDATE xseeria_events SET aktiivne = false');
  await pool.query('UPDATE xseeria_events SET aktiivne = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- ADMIN: asukohad (venues) ----------

router.post('/admin/asukohad/bulk', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const { event_id, tekst } = req.body;
  if (!event_id || !tekst) return res.json({ ok: false, veateade: 'event_id ja tekst on kohustuslikud' });
  const read = tekst.split('\n').map((l) => l.trim()).filter(Boolean);
  const maxRow = await pool.query('SELECT COALESCE(MAX(jrk_nr),0) AS m FROM xseeria_asukohad WHERE event_id=$1', [event_id]);
  let jrk = maxRow.rows[0].m;
  const lisatud = [];
  for (const line of read) {
    const parts = line.split(',').map((p) => p.trim());
    const nimi = parts[0];
    if (!nimi) continue;
    const korvid = parseInt(parts[1], 10) || 0;
    const viske = parseInt(parts[2], 10) || 0;
    jrk++;
    const r = await pool.query(
      'INSERT INTO xseeria_asukohad (event_id, nimi, korvide_arv, viskekohtade_arv, jrk_nr) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [event_id, nimi, korvid, viske, jrk]
    );
    lisatud.push(r.rows[0]);
  }
  res.json({ ok: true, lisatud });
});

router.put('/admin/asukohad/:id', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const { nimi, korvide_arv, viskekohtade_arv, markused } = req.body;
  await pool.query(
    'UPDATE xseeria_asukohad SET nimi=$1, korvide_arv=$2, viskekohtade_arv=$3, markused=$4 WHERE id=$5',
    [nimi, korvide_arv || 0, viskekohtade_arv || 0, markused || null, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/admin/asukohad/:id', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  await pool.query('DELETE FROM xseeria_asukohad WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- ADMIN: workers ----------

router.get('/admin/workers', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const r = await pool.query('SELECT id, nimi, pin, aktiivne FROM xseeria_workers ORDER BY nimi');
  res.json({ ok: true, workers: r.rows });
});

router.post('/admin/workers', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const { nimi, pin } = req.body;
  if (!nimi || !pin) return res.json({ ok: false, veateade: 'Nimi ja PIN on kohustuslikud' });
  try {
    const r = await pool.query('INSERT INTO xseeria_workers (nimi, pin) VALUES ($1,$2) RETURNING *', [nimi, pin]);
    res.json({ ok: true, worker: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See PIN on juba kasutusel' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.put('/admin/workers/:id', async (req, res) => {
  const session = await getSession(req);
  if (!requireAdmin(session, res)) return;
  const { nimi, pin, aktiivne } = req.body;
  try {
    await pool.query('UPDATE xseeria_workers SET nimi=$1, pin=$2, aktiivne=$3 WHERE id=$4', [nimi, pin, aktiivne, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.json({ ok: false, veateade: 'See PIN on juba kasutusel' });
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

module.exports = router;
