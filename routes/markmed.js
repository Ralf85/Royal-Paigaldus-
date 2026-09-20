const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Admini isiklikud märkmed — pealkiri + sisu, mida saab hiljem täiendada.
async function initMarkmed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_markmed (
      id SERIAL PRIMARY KEY,
      tekst TEXT NOT NULL,
      tehtud BOOLEAN DEFAULT false,
      loodud TIMESTAMP DEFAULT NOW(),
      uuendatud TIMESTAMP DEFAULT NOW()
    );
  `);
  // Pealkiri lisandus hiljem — olemasolevatel märkmetel jääb see tühjaks ja sisu on endine tekst.
  await pool.query(`ALTER TABLE admin_markmed ADD COLUMN IF NOT EXISTS pealkiri TEXT`);
}
initMarkmed().catch(e => console.error('admin_markmed init failed:', e.message));

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// Järjestus nagu Apple Notes: viimati puudutatud kirje on alati kõige ülemine.
router.get('/', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM admin_markmed ORDER BY tehtud ASC, uuendatud DESC');
    res.json({ ok: true, markmed: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.post('/', noudaAdmin, async (req, res) => {
  const pealkiri = (req.body.pealkiri || '').trim();
  const tekst = (req.body.tekst || '').trim();
  if (!pealkiri && !tekst) return res.json({ ok: false, veateade: 'Märge on tühi' });
  try {
    const r = await pool.query(
      'INSERT INTO admin_markmed (pealkiri, tekst) VALUES ($1,$2) RETURNING *',
      [pealkiri || null, tekst]
    );
    res.json({ ok: true, markme: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/:id', noudaAdmin, async (req, res) => {
  const pealkiri = (req.body.pealkiri || '').trim();
  const tekst = (req.body.tekst || '').trim();
  if (!pealkiri && !tekst) return res.json({ ok: false, veateade: 'Märge on tühi' });
  try {
    const r = await pool.query(
      'UPDATE admin_markmed SET pealkiri=$1, tekst=$2, uuendatud=NOW() WHERE id=$3 RETURNING *',
      [pealkiri || null, tekst, req.params.id]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Märget ei leitud' });
    res.json({ ok: true, markme: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/:id/tehtud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('UPDATE admin_markmed SET tehtud=$1, uuendatud=NOW() WHERE id=$2', [!!req.body.tehtud, req.params.id]);
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Märget ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.delete('/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM admin_markmed WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

module.exports = router;
