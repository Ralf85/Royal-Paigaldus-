require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initDB, pool } = require('./db');
const app = express();
const PORT = process.env.PORT || 8080;
// Sessioonide kehtivusajad — pärast seda aega token enam ei kehti (vt allpool WHERE loodud > ...)
const ADMIN_SESSIOON_PAEVI = 14;
const WORKER_SESSIOON_PAEVI = 180;
const GRAAFIK_ADMIN_SESSIOON_PAEVI = 30;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(async (req, res, next) => {
  const token = req.headers['x-session-token'] || req.query._token;
  req.session = {};
  req.sessionToken = token;
  if (token) {
    try {
      // Üks päring kolme sessioonitabeli asemel — vähendab iga HTTP päringu
      // andmebaasi round-trip'e kolmelt ühele.
      const r = await pool.query(`
        SELECT 'admin' AS tyyp, NULL::int AS worker_id, NULL::varchar AS worker_nimi, NULL::varchar AS nimi
        FROM admin_sessions WHERE token=$1 AND loodud > NOW() - INTERVAL '${ADMIN_SESSIOON_PAEVI} days'
        UNION ALL
        SELECT 'worker' AS tyyp, worker_id, worker_nimi, NULL::varchar AS nimi
        FROM worker_sessions WHERE token=$1 AND loodud > NOW() - INTERVAL '${WORKER_SESSIOON_PAEVI} days'
        UNION ALL
        SELECT 'graafik' AS tyyp, NULL::int AS worker_id, NULL::varchar AS worker_nimi, nimi
        FROM graafik_admin_sessions WHERE token=$1 AND loodud > NOW() - INTERVAL '${GRAAFIK_ADMIN_SESSIOON_PAEVI} days'
      `, [token]);
      for (const row of r.rows) {
        if (row.tyyp === 'admin') req.session.isAdmin = true;
        if (row.tyyp === 'worker') {
          req.session.workerId = row.worker_id;
          req.session.workerNimi = row.worker_nimi;
        }
        if (row.tyyp === 'graafik') {
          req.session.isGraafikAdmin = true;
          req.session.graafikAdminNimi = row.nimi;
        }
      }
    } catch(e) {}
  }
  req.saveSession = async (data) => {
    // Krüptograafiliselt turvaline juhuslik token (varem Math.random(), mis pole selleks otstarbeks turvaline)
    const t = crypto.randomBytes(32).toString('hex');
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
app.use('/api/projektid', require('./routes/projektid'));
app.use('/api/omaarved', require('./routes/omaarved'));
app.use('/api/xseeria', require('./routes/xseeria'));
app.use('/api/arved', require('./routes/arved'));
app.use('/api/padel', require('./routes/padel'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tootaja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/tootaja-tood', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tootaja-tood.html')));
app.get('/graafik-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'graafik-admin.html')));
app.get('/graafik-admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'graafik-admin-login.html')));
// "Kristo" nimetati ümber "Lidl Eesti"-ks (moodul kasvas ühe töötaja isiklikust vaatest kogu Lidl Eesti
// poodide fotokorpuseks) — vana /kristo aadress jääb alles ja suunab uuele, et miski katki ei läheks.
app.get('/lidl-eesti', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lidl-eesti.html')));
app.get('/kristo', (req, res) => res.redirect('/lidl-eesti'));
app.get('/xseeria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'xseeria.html')));
app.get('/arved-vaade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'arved-vaade.html')));
app.get('/minu-arved', (req, res) => res.sendFile(path.join(__dirname, 'public', 'minu-arved.html')));
app.get('/padel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'padel.html')));
app.get('/padel-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'padel-admin.html')));
initDB().then(async () => {
  // Kustutame käivitumisel aegunud sessioonid, et tabelid ei kasvaks lõputult
  try {
    await pool.query(`DELETE FROM admin_sessions WHERE loodud < NOW() - INTERVAL '${ADMIN_SESSIOON_PAEVI} days'`);
    await pool.query(`DELETE FROM worker_sessions WHERE loodud < NOW() - INTERVAL '${WORKER_SESSIOON_PAEVI} days'`);
    await pool.query(`DELETE FROM graafik_admin_sessions WHERE loodud < NOW() - INTERVAL '${GRAAFIK_ADMIN_SESSIOON_PAEVI} days'`);
  } catch (e) {
    console.error('Vananenud sessioonide koristus ebaõnnestus:', e.message);
  }
  app.listen(PORT, () => console.log(`🚀 Server käib pordil ${PORT}`));
});
