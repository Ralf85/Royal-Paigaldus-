
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

router.post('/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM workers WHERE pin = $1 AND aktiivne = true', [pin]
    );
    if (result.rows.length === 0) {
      return res.json({ ok: false, veateade: 'Vale PIN-kood' });
    }
    const worker = result.rows[0];
    const token = await req.saveSession({ workerId: worker.id, workerNimi: worker.nimi });
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [worker.id, 'SISSELOGIMINE', JSON.stringify({ nimi: worker.nimi }), req.ip]
    );
    res.json({ ok: true, nimi: worker.nimi, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.post('/admin-login', async (req, res) => {
  const { pin } = req.body;
  if (pin === process.env.ADMIN_PIN) {
    const token = await req.saveSession({ isAdmin: true });
    res.json({ ok: true, token });
  } else {
    res.json({ ok: false, veateade: 'Vale admin PIN' });
  }
});

router.post('/graafik-admin-login', async (req, res) => {
  const { pin } = req.body;
  try {
    const r = await pool.query(
      'SELECT * FROM graafik_adminid WHERE pin = $1 AND aktiivne = true', [pin]
    );
    if (r.rows.length === 0) {
      return res.json({ ok: false, veateade: 'Vale PIN-kood' });
    }
    const ga = r.rows[0];
    const token = await req.saveSession({ isGraafikAdmin: true, graafikAdminNimi: ga.nimi });
    res.json({ ok: true, nimi: ga.nimi, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

router.get('/sessioon', (req, res) => {
  if (req.session.workerId) {
    res.json({ sisselogitud: true, nimi: req.session.workerNimi, workerId: req.session.workerId, isAdmin: false, isGraafikAdmin: false });
  } else if (req.session.isAdmin) {
    res.json({ sisselogitud: true, nimi: 'Admin', isAdmin: true, isGraafikAdmin: false });
  } else if (req.session.isGraafikAdmin) {
    res.json({ sisselogitud: true, nimi: req.session.graafikAdminNimi, isAdmin: false, isGraafikAdmin: true });
  } else {
    res.json({ sisselogitud: false });
  }
});

module.exports = router;
