const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Admini isiklikud märkmed — kiired mõtted, kokkulepped, asjad mida tulevikus vaja meeles pidada.
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
  const tekst = (req.body.tekst || '').trim();
  if (!tekst) return res.json({ ok: false, veateade: 'Märkme tekst on tühi' });
  try {
    const r = await pool.query('INSERT INTO admin_markmed (tekst) VALUES ($1) RETURNING *', [tekst]);
    res.json({ ok: true, markme: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.put('/:id', noudaAdmin, async (req, res) => {
  const tekst = (req.body.tekst || '').trim();
  if (!tekst) return res.json({ ok: false, veateade: 'Märkme tekst on tühi' });
  try {
    const r = await pool.query('UPDATE admin_markmed SET tekst=$1, uuendatud=NOW() WHERE id=$2 RETURNING *', [tekst, req.params.id]);
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
