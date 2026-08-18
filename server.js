require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDB, pool } = require('./db');
const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(async (req, res, next) => {
  const token = req.headers['x-session-token'] || req.query._token;
  req.session = {};
  req.sessionToken = token;
  if (token) {
    try {
      const r = await pool.query('SELECT * FROM admin_sessions WHERE token=$1', [token]);
      if (r.rows.length > 0) req.session.isAdmin = true;
      const w = await pool.query('SELECT * FROM worker_sessions WHERE token=$1', [token]);
      if (w.rows.length > 0) {
        req.session.workerId = w.rows[0].worker_id;
        req.session.workerNimi = w.rows[0].worker_nimi;
      }
      const ga = await pool.query('SELECT * FROM graafik_admin_sessions WHERE token=$1', [token]);
      if (ga.rows.length > 0) {
        req.session.isGraafikAdmin = true;
        req.session.graafikAdminNimi = ga.rows[0].nimi;
      }
    } catch(e) {}
  }
  req.saveSession = async (data) => {
    const t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    if (data.isAdmin) {
      await pool.query('INSERT INTO admin_sessions (token) VALUES ($1) ON CONFLICT DO NOTHING', [t]);
    }
    if (data.workerId) {
      await pool.query(`INSERT INTO worker_sessions (token, worker_id, worker_nimi) VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING`, [t, data.workerId, data.workerNimi]);
    }
    if (data.isGraafikAdmin) {
      await pool.query(`INSERT INTO graafik_admin_sessions (token, nimi) VALUES ($1,$2)
        ON CONFLICT DO NOTHING`, [t, data.graafikAdminNimi]);
    }
    return t;
  };
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tood', require('./routes/tood'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pildid', require('./routes/pildid'));
app.use('/api/push', require('./routes/push').router);
app.use('/api/graafik', require('./routes/graafik'));
app.use('/api/edgf', require('./routes/edgf'));
app.use('/api/re', require('./routes/re'));
app.use('/api/kristo', require('./routes/kristo'));
app.use('/api/xseeria', require('./routes/xseeria'));
app.use('/api/arved', require('./routes/arved'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tootaja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/tootaja-tood', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja-tood.html')));
app.get('/graafik-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'graafik-admin.html')));
app.get('/graafik-admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'graafik-admin-login.html')));
app.get('/kristo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kristo.html')));
app.get('/xseeria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'xseeria.html')));
app.get('/arved-vaade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'arved-vaade.html')));
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server käib pordil ${PORT}`));
});
