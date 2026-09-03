const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

function noudaSisslogimist(req, res, next) {
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

function rpID(req) {
  return req.hostname;
}
function origin(req) {
  return req.protocol + '://' + req.get('host');
}

const registreerimiseValjakutsed = new Map();
const sisselogimiseValjakutsed = new Map();

function puhastaAegunudValjakutsed() {
  const nyyd = Date.now();
  for (const [k, v] of registreerimiseValjakutsed) if (v.aegub < nyyd) registreerimiseValjakutsed.delete(k);
  for (const [k, v] of sisselogimiseValjakutsed) if (v.aegub < nyyd) sisselogimiseValjakutsed.delete(k);
}
setInterval(puhastaAegunudValjakutsed, 5 * 60 * 1000);

router.get('/register-options', noudaSisslogimist, async (req, res) => {
  try {
    const olemasoleva = await pool.query('SELECT credential_id, transports FROM worker_webauthn WHERE worker_id=$1', [req.session.workerId]);
    const options = await generateRegistrationOptions({
      rpName: 'Royal Paigaldus',
      rpID: rpID(req),
      userID: String(req.session.workerId),
      userName: req.session.workerNimi || 'töötaja',
      userDisplayName: req.session.workerNimi || 'töötaja',
      attestationType: 'none',
      excludeCredentials: olemasoleva.rows.map(r => ({
        id: Buffer.from(r.credential_id, 'base64url'),
        type: 'public-key',
        transports: r.transports ? r.transports.split(',') : undefined
      })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' }
    });
    registreerimiseValjakutsed.set(req.session.workerId, { challenge: options.challenge, aegub: Date.now() + 5 * 60 * 1000 });
    res.json({ ok: true, options });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.post('/register-verify', noudaSisslogimist, async (req, res) => {
  const salvestatud = registreerimiseValjakutsed.get(req.session.workerId);
  if (!salvestatud) return res.json({ ok: false, veateade: 'Registreerimise aeg aegus, proovi uuesti' });
  try {
    const tulemus = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: salvestatud.challenge,
      expectedOrigin: origin(req),
      expectedRPID: rpID(req)
    });
    registreerimiseValjakutsed.delete(req.session.workerId);
    if (!tulemus.verified || !tulemus.registrationInfo) return res.json({ ok: false, veateade: 'Kinnitamine ebaõnnestus' });
    const { credentialID, credentialPublicKey, counter } = tulemus.registrationInfo;
    await pool.query(
      `INSERT INTO worker_webauthn (worker_id, credential_id, public_key, counter, device_name, transports)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.session.workerId,
        Buffer.from(credentialID).toString('base64url'),
        Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        (req.body.deviceName || 'Telefon/arvuti').slice(0, 100),
        (req.body.response && req.body.response.transports || []).join(',')
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, veateade: 'Kinnitamine ebaõnnestus: ' + err.message });
  }
});

router.get('/minu-seadmed', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, device_name, loodud FROM worker_webauthn WHERE worker_id=$1 ORDER BY loodud DESC', [req.session.workerId]);
    res.json({ ok: true, seadmed: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});
router.delete('/seadmed/:id', noudaSisslogimist, async (req, res) => {
  try {
    await pool.query('DELETE FROM worker_webauthn WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

router.get('/login-options', async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: rpID(req),
      userVerification: 'preferred'
    });
    const id = Buffer.from(options.challenge).toString('hex') + Date.now();
    sisselogimiseValjakutsed.set(id, { challenge: options.challenge, aegub: Date.now() + 5 * 60 * 1000 });
    res.json({ ok: true, options, valjakutseId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.post('/login-verify', async (req, res) => {
  const { valjakutseId, response } = req.body;
  const salvestatud = sisselogimiseValjakutsed.get(valjakutseId);
  if (!salvestatud) return res.json({ ok: false, veateade: 'Sisselogimise aeg aegus, proovi uuesti' });
  sisselogimiseValjakutsed.delete(valjakutseId);
  try {
    const kredR = await pool.query('SELECT * FROM worker_webauthn WHERE credential_id=$1', [response.id]);
    if (!kredR.rows.length) return res.json({ ok: false, veateade: 'Seda seadet pole registreeritud. Kasuta PIN-koodi.' });
    const kred = kredR.rows[0];

    const tulemus = await verifyAuthenticationResponse({
      response,
      expectedChallenge: salvestatud.challenge,
      expectedOrigin: origin(req),
      expectedRPID: rpID(req),
      authenticator: {
        credentialID: Buffer.from(kred.credential_id, 'base64url'),
        credentialPublicKey: Buffer.from(kred.public_key, 'base64'),
        counter: Number(kred.counter),
        transports: kred.transports ? kred.transports.split(',') : undefined
      }
    });
    if (!tulemus.verified) return res.json({ ok: false, veateade: 'Kinnitamine ebaõnnestus' });

    await pool.query('UPDATE worker_webauthn SET counter=$1 WHERE id=$2', [tulemus.authenticationInfo.newCounter, kred.id]);

    const workerR = await pool.query('SELECT * FROM workers WHERE id=$1 AND aktiivne=true', [kred.worker_id]);
    if (!workerR.rows.length) return res.json({ ok: false, veateade: 'Konto pole enam aktiivne' });
    const worker = workerR.rows[0];

    const token = await req.saveSession({ workerId: worker.id, workerNimi: worker.nimi });
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [worker.id, 'SISSELOGIMINE_FACEID', JSON.stringify({ nimi: worker.nimi }), req.ip]
    );
    res.json({ ok: true, nimi: worker.nimi, token });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, veateade: 'Kinnitamine ebaõnnestus' });
  }
});

module.exports = router;
