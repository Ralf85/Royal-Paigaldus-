require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
// Node.js 18-l pole globalThis.crypto vaikimisi olemas (alles Node 20+ vaikimisi) —
// @simplewebauthn/server (Face ID/sõrmejälje tugi) eeldab seda. Täidame selle ise.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const { initDB, pool } = require('./db');
const app = express();

// ── KOKKUJOOKSMISE KAITSE ────────────────────────────────────────────────
// Express 4 ei püüa async-funktsioonide vigu: üks andmebaasi viga ühes marsruudis sulges varem
// KOGU serveri (kõik kasutajad väljas, kuni Railway selle uuesti käivitas). See lõik suunab iga
// sellise vea allpool olevasse ühisesse veakäsitlejasse — päring saab vastuseks 500, server jääb tööle.
try {
  const Layer = require('express/lib/router/layer');
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // veakäsitleja (4 argumenti) — tavapäringus jäetakse vahele
    try {
      const tulemus = fn(req, res, next);
      if (tulemus && typeof tulemus.catch === 'function') tulemus.catch(next);
    } catch (err) {
      next(err);
    }
  };
} catch (e) {
  console.error('Async-vigade kaitset ei saanud paigaldada:', e.message);
}
// Viimane turvavõrk: logime vea, aga ei lase ühel real kogu rakendust sulgeda.
process.on('unhandledRejection', (pohjus) => {
  console.error('⚠️ Püüdmata viga (unhandledRejection):', pohjus && pohjus.stack ? pohjus.stack : pohjus);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Püüdmata viga (uncaughtException):', err && err.stack ? err.stack : err);
});
// Railway tõlgib liikluse HTTPS -> HTTP oma serverisse; see seadistus laseb Expressil
// õigesti tuvastada, et algne päring OLI HTTPS (vajalik nt WebAuthn/Face ID turvakontrolliks).
app.set('trust proxy', true);
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
// Lidl projektide poed — "Tulevased projektid" (admin määrab poed, töötaja näeb pealehel)
app.use('/api/lidl-poed', require('./routes/lidlpoed'));
app.use('/api/projektid', require('./routes/projektid'));
app.use('/api/omaarved', require('./routes/omaarved'));
app.use('/api/xseeria', require('./routes/xseeria'));
app.use('/api/arved', require('./routes/arved'));
app.use('/api/markmed', require('./routes/markmed'));
app.use('/api/padel', require('./routes/padel'));
app.use('/api/webauthn', require('./routes/webauthn'));
// LIDL LATVIA — eraldiseisev fotomoodul (oma tabelid, oma admini PIN, kogu liides inglise keeles).
// Ei puuduta Eesti Lidli moodulit (/api/kristo) ega töökirjeid.
app.use('/api/latvia', require('./routes/latvia'));
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
// Lidl Latvia: töötaja fotode üleslaadimine ja galerii + Läti admini oma leht (oma PIN).
app.get('/lidl-latvia', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lidl-latvia.html')));
app.get('/lidl-latvia-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lidl-latvia-admin.html')));
app.get('/xseeria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'xseeria.html')));
app.get('/arved-vaade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'arved-vaade.html')));
app.get('/minu-arved', (req, res) => res.sendFile(path.join(__dirname, 'public', 'minu-arved.html')));
app.get('/padel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'padel.html')));
app.get('/padel-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'padel-admin.html')));
// Tundmatu API aadress -> selge JSON-vastus (mitte HTML-leht, mida liides ei oska lugeda)
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, veateade: 'Sellist API aadressi ei ole' });
});
// Ühine veakäsitleja — siia jõuavad kõik marsruutides püüdmata vead (vt "KOKKUJOOKSMISE KAITSE" ülal).
app.use((err, req, res, next) => {
  const failiViga = err && (err.name === 'MulterError' || /Ainult pildid|Ainult/.test(err.message || ''));
  if (!failiViga) console.error(`❌ Viga: ${req.method} ${req.originalUrl} —`, err && err.stack ? err.stack : err);
  // Vastus juba pooleli (nt ZIP-i allalaadimine) -> katkestame ühenduse, uut vastust saata ei saa.
  if (res.headersSent) { try { res.destroy(); } catch (e) {} return; }
  if (failiViga) {
    const tekst = err.code === 'LIMIT_FILE_SIZE' ? 'Fail on liiga suur' : (err.message || 'Faili üleslaadimine ebaõnnestus');
    return res.status(400).json({ ok: false, veateade: tekst });
  }
  res.status(500).json({ ok: false, veateade: 'Serveri viga' });
});
initDB().then(async () => {
  // Kustutame käivitumisel aegunud sessioonid, et tabelid ei kasvaks lõputult
  try {
    await pool.query(`DELETE FROM admin_sessions WHERE loodud < NOW() - INTERVAL '${ADMIN_SESSIOON_PAEVI} days'`);
    await pool.query(`DELETE FROM worker_sessions WHERE loodud < NOW() - INTERVAL '${WORKER_SESSIOON_PAEVI} days'`);
    await pool.query(`DELETE FROM graafik_admin_sessions WHERE loodud < NOW() - INTERVAL '${GRAAFIK_ADMIN_SESSIOON_PAEVI} days'`);
  } catch (e) {
    console.error('Vananenud sessioonide koristus ebaõnnestus:', e.message);
  }
  const server = app.listen(PORT, () => console.log(`🚀 Server käib pordil ${PORT}`));
  // Kui porti ei saa avada, pole mõtet "poolikult" tööle jääda — väljume, Railway käivitab uuesti.
  server.on('error', (err) => {
    console.error('❌ Serveri käivitamine ebaõnnestus:', err.message);
    process.exit(1);
  });
}).catch((err) => {
  console.error('❌ Andmebaasi ettevalmistus ebaõnnestus — server ei käivitu:', err && err.stack ? err.stack : err);
  process.exit(1);
});
