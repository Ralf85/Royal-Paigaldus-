const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Töötaja PIN-sisselogimine
router.post('/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM workers WHERE pin = $1 AND aktiivne = true',
      [pin]
    );
    if (result.rows.length === 0) {
      return res.json({ ok: false, veateade: 'Vale PIN-kood' });
    }
    const worker = result.rows[0];
    req.session.workerId = worker.id;
    req.session.workerNimi = worker.nimi;
    req.session.isAdmin = false;
    res.json({ ok: true, nimi: worker.nimi });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Admin sisselogimine
router.post('/admin-login', (req, res) => {
  const { pin } = req.body;
  if (pin === process.env.ADMIN_PIN) {
    req.session.isAdmin = true;
    req.session.workerId = null;
    res.json({ ok: true });
  } else {
    res.json({ ok: false, veateade: 'Vale admin PIN' });
  }
});

// Väljalogimine
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Sessiooni kontroll
router.get('/sessioon', (req, res) => {
  if (req.session.workerId) {
    res.json({ sisselogitud: true, nimi: req.session.workerNimi, isAdmin: false });
  } else if (req.session.isAdmin) {
    res.json({ sisselogitud: true, nimi: 'Admin', isAdmin: true });
  } else {
    res.json({ sisselogitud: false });
  }
});

module.exports = router;
