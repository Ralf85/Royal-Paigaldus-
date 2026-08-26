const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const https = require('https');
const http = require('http');
const { Resend } = require('resend');
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return cloudinary;
}
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Ainult pildid!'));
  }
});
// Kasutame arve PDF genereerimisel logo joonistamiseks — pdfkit vajab Bufferit, mitte URL-i.
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https:') ? https : http;
    proto.get(url, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
      r.on('error', reject);
    }).on('error', reject);
  });
}

// ── TÖÖTAJA ISIKLIK ARVETE MOODUL ────────────────────────────────────────
// Erinevalt routes/arved.js-st (kus müüja = Royal Paigaldus OÜ), on siin müüja töötaja ENDA
// ettevõte (FIE/oma OÜ) — töötaja saab siin genereerida oma arveid mistahes kliendile.
// Nähtavus on adminni poolt lülitatav worker'i kaupa (omaarve_lubatud), sama muster mis
// Projektid/X-seeria moodulite ligipääsu haldusel.

function noudaSisslogimist(req, res, next) {
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}
function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}
async function omabLigipaasu(workerId) {
  const r = await pool.query('SELECT 1 FROM omaarve_lubatud WHERE worker_id=$1', [workerId]);
  return r.rows.length > 0;
}
async function noudaOmaarveLubatud(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (!req.session || !req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  if (!(await omabLigipaasu(req.session.workerId))) return res.status(403).json({ ok: false, veateade: 'Sul pole Arved ligipääsu' });
  next();
}

// ── Abifunktsioonid (number, kuupäevad, vormindus) — samad põhimõtted mis routes/arved.js,
// aga oma eraldi loendur (omaarve_paeva_loendur), et ei seguneks Royal Paigalduse enda numbritega. ──
function paevaVoti(kuupaev) {
  const dt = new Date(kuupaev);
  return String(dt.getDate()).padStart(2, '0') + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getFullYear()).slice(-2);
}
async function reserveeriJargmineNumber(client, kuupaev) {
  const paev = paevaVoti(kuupaev);
  const r = await client.query('SELECT jargmine_jrk FROM omaarve_paeva_loendur WHERE paev=$1 FOR UPDATE', [paev]);
  let jrk;
  if (r.rows.length) {
    jrk = r.rows[0].jargmine_jrk;
    await client.query('UPDATE omaarve_paeva_loendur SET jargmine_jrk=$1 WHERE paev=$2', [jrk + 1, paev]);
  } else {
    jrk = 1;
    await client.query('INSERT INTO omaarve_paeva_loendur (paev, jargmine_jrk) VALUES ($1,2)', [paev]);
  }
  return paev + String(jrk).padStart(3, '0');
}
function arveViitenumber(number) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    const digit = parseInt(number[number.length - 1 - i], 10);
    sum += digit * weights[i % 3];
  }
  const checksum = (10 - (sum % 10)) % 10;
  return number + String(checksum);
}
function fmtKp(d) {
  if (!d) return '';
  const dt = new Date(d);
  return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
}
function fmtNum(n, kohti) {
  const num = parseFloat(n) || 0;
  const parts = num.toFixed(kohti === undefined ? 1 : kohti).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join(',');
}
function fmtEur(n) { return fmtNum(n, 2); }

// ── LIGIPÄÄSU KONTROLL ────────────────────────────────────────────────────
router.get('/kontroll', noudaSisslogimist, async (req, res) => {
  try {
    const lubatud = await omabLigipaasu(req.session.workerId);
    res.json({ ok: true, lubatud });
  } catch (err) {
    res.json({ ok: false, lubatud: false });
  }
});

// ── MINU ETTEVÕTTE REKVISIIDID (müüja andmed) ────────────────────────────
router.get('/seaded', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM omaarve_seaded WHERE worker_id=$1', [req.session.workerId]);
    res.json({ ok: true, seaded: r.rows[0] || null });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});
router.post('/seaded', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  const { ettevote_nimi, aadress, rg_kood, kmkr, pangakonto, pank, telefon, epost, km_kohuslane } = req.body;
  if (!ettevote_nimi || !ettevote_nimi.trim()) return res.json({ ok: false, veateade: 'Sisesta ettevõtte nimi' });
  try {
    await pool.query(
      `INSERT INTO omaarve_seaded (worker_id, ettevote_nimi, aadress, rg_kood, kmkr, pangakonto, pank, telefon, epost, km_kohuslane, uuendatud)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (worker_id) DO UPDATE SET
         ettevote_nimi=EXCLUDED.ettevote_nimi, aadress=EXCLUDED.aadress, rg_kood=EXCLUDED.rg_kood,
         kmkr=EXCLUDED.kmkr, pangakonto=EXCLUDED.pangakonto, pank=EXCLUDED.pank,
         telefon=EXCLUDED.telefon, epost=EXCLUDED.epost, km_kohuslane=EXCLUDED.km_kohuslane, uuendatud=NOW()`,
      [req.session.workerId, ettevote_nimi.trim(), aadress || '', rg_kood || '', kmkr || '', pangakonto || '', pank || '', telefon || '', epost || '', km_kohuslane !== false]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── SALVESTATUD ARVE SAAJAD (taaskasutamiseks) ───────────────────────────
router.get('/saajad', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM omaarve_saajad WHERE worker_id=$1 ORDER BY nimi', [req.session.workerId]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});
router.delete('/saajad/:id', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    await pool.query('DELETE FROM omaarve_saajad WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── OMA ARVETE AJALUGU ────────────────────────────────────────────────────
router.get('/', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM omaarved WHERE worker_id=$1 ORDER BY kuupaev DESC, id DESC', [req.session.workerId]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── UUE ARVE LOOMINE ──────────────────────────────────────────────────────
router.post('/', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      saaja_nimi, saaja_aadress, saaja_rg_kood, saaja_kmkr, saaja_kontaktisik, saaja_epost,
      kuupaev, maksetahtaeg_paevad, read, kaibemaks_protsent
    } = req.body;
    if (!saaja_nimi || !saaja_nimi.trim() || !Array.isArray(read) || !read.length) {
      return res.json({ ok: false, veateade: 'Täida arve saaja nimi ja vähemalt üks arve rida' });
    }
    const seadedR = await client.query('SELECT * FROM omaarve_seaded WHERE worker_id=$1', [req.session.workerId]);
    if (!seadedR.rows.length || !seadedR.rows[0].ettevote_nimi) {
      return res.json({ ok: false, veateade: 'Täida enne "Minu rekvisiidid" — ilma nendeta ei saa arvet väljastada' });
    }

    await client.query('BEGIN');
    const kp = kuupaev ? new Date(kuupaev) : new Date();
    const number = await reserveeriJargmineNumber(client, new Date());
    const viitenumber = arveViitenumber(number);
    const paevi = parseInt(maksetahtaeg_paevad, 10) || 14;
    const tahtaeg = new Date(kp);
    tahtaeg.setDate(tahtaeg.getDate() + paevi);

    const summaKmTa = read.reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
    // Töötaja saab ise valida, kas ta on käibemaksukohuslane (24%) või mitte (0%) — erinevalt
    // Royal Paigalduse enda arvetest, kus 24% on alati kohustuslik.
    const kaibemaksProtsent = [0, 24].includes(parseFloat(kaibemaks_protsent)) ? parseFloat(kaibemaks_protsent) : 24;
    const kaibemaks = +(summaKmTa * kaibemaksProtsent / 100).toFixed(2);
    const kokku = +(summaKmTa + kaibemaks).toFixed(2);

    const arveR = await client.query(
      `INSERT INTO omaarved (worker_id, number, kuupaev, maksetahtaeg, saaja_nimi, saaja_aadress, saaja_rg_kood, saaja_kmkr, saaja_kontaktisik, saaja_epost, summa_km_ta, kaibemaks_protsent, kaibemaks, kokku)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [req.session.workerId, number, kp, tahtaeg, saaja_nimi.trim(), saaja_aadress || '', saaja_rg_kood || '', saaja_kmkr || '', saaja_kontaktisik || '', saaja_epost || '', summaKmTa, kaibemaksProtsent, kaibemaks, kokku]
    );
    const arveId = arveR.rows[0].id;

    let jrk = 0;
    for (const rida of read) {
      jrk++;
      await client.query(
        `INSERT INTO omaarve_read (arve_id, jrk_nr, kirjeldus, kogus, uhik, hind, summa) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [arveId, jrk, rida.kirjeldus, parseFloat(rida.kogus) || 0, rida.uhik || '', parseFloat(rida.hind) || 0, parseFloat(rida.summa) || 0]
      );
    }

    // Jäta arve saaja meelde tulevikuks (uuenda andmeid, kui nimi juba olemas).
    await client.query(
      `INSERT INTO omaarve_saajad (worker_id, nimi, aadress, rg_kood, kmkr, kontaktisik, epost, maksetahtaeg_paevad)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (worker_id, nimi) DO UPDATE SET
         aadress=EXCLUDED.aadress, rg_kood=EXCLUDED.rg_kood, kmkr=EXCLUDED.kmkr,
         kontaktisik=EXCLUDED.kontaktisik, epost=EXCLUDED.epost, maksetahtaeg_paevad=EXCLUDED.maksetahtaeg_paevad`,
      [req.session.workerId, saaja_nimi.trim(), saaja_aadress || '', saaja_rg_kood || '', saaja_kmkr || '', saaja_kontaktisik || '', saaja_epost || '', paevi]
    );

    await client.query('COMMIT');
    res.json({ ok: true, id: arveId, number, viitenumber });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    await pool.query('DELETE FROM omaarved WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// ── PDF GENEREERIMINE (müüja = töötaja enda rekvisiidid) ─────────────────
function renderOmaArvePdf(muuja, arve, read, logoBuf) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const MARGIN = 40, PAGE_W = 595.28, CONTENT_W = PAGE_W - MARGIN * 2;
  const leftX = MARGIN, rightColX = MARGIN + 300, rightColW = CONTENT_W - 300;

  doc.font('Helvetica').fontSize(9).fillColor('#000');

  // Logo (töötaja enda üleslaetud, kui admin on selle lisanud) päise vasakus servas
  let logoBottom = MARGIN;
  if (logoBuf) {
    try {
      const logoW = 110;
      doc.image(logoBuf, leftX, MARGIN, { width: logoW, height: 60, fit: [logoW, 60] });
      logoBottom = MARGIN + 60 + 14;
    } catch (e) { /* kui logo ei laadi, jätkame ilma selleta */ }
  }

  // Vasak veerg — Arve saaja
  let y = logoBottom;
  doc.text('Arve saaja', leftX, y); y += 14;
  doc.font('Helvetica-Bold').fontSize(11).text(arve.saaja_nimi, leftX, y); y += 16;
  doc.font('Helvetica').fontSize(9);
  (arve.saaja_aadress || '').split(',').filter(s => s.trim()).forEach(line => { doc.text(line.trim(), leftX, y); y += 12; });
  y += 10;
  if (arve.saaja_rg_kood) { doc.text('Rg-kood ' + arve.saaja_rg_kood, leftX, y); y += 12; }
  if (arve.saaja_kmkr) { doc.text('KMKR nr ' + arve.saaja_kmkr, leftX, y); y += 12; }

  // Parem veerg — arve number + kuupäevad + müüja (töötaja enda ettevõte)
  let ry = MARGIN;
  doc.rect(rightColX, ry, rightColW, 20).fill('#cfe2f3');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10)
    .text(`Arve nr ${arve.number}`, rightColX, ry + 5, { width: rightColW, align: 'center' });
  ry += 30;
  doc.font('Helvetica').fontSize(9);
  const paar = (label, val) => {
    doc.text(label, rightColX, ry, { width: rightColW * 0.5 });
    doc.text(val, rightColX, ry, { width: rightColW, align: 'right' });
    ry += 13;
  };
  paar('Kuupäev', fmtKp(arve.kuupaev));
  paar('Maksetähtpäev', fmtKp(arve.maksetahtaeg));
  paar('Viitenumber', arve.viitenumber || '');
  ry += 8;
  doc.font('Helvetica-Bold').fontSize(10).text(muuja.ettevote_nimi, rightColX, ry, { width: rightColW, align: 'right' }); ry += 14;
  doc.font('Helvetica').fontSize(9);
  (muuja.aadress || '').split(',').filter(s => s.trim()).forEach(line => { doc.text(line.trim(), rightColX, ry, { width: rightColW, align: 'right' }); ry += 12; });
  ry += 4;
  if (muuja.rg_kood) { doc.text('Rg-kood ' + muuja.rg_kood, rightColX, ry, { width: rightColW, align: 'right' }); ry += 12; }
  if (muuja.kmkr) { doc.text('KMKR nr ' + muuja.kmkr, rightColX, ry, { width: rightColW, align: 'right' }); ry += 12; }

  y = Math.max(y, ry) + 18;

  if (arve.saaja_kontaktisik) {
    doc.font('Helvetica').fontSize(9).text('Kontaktisik ' + arve.saaja_kontaktisik, leftX, y);
    y += 20;
  } else {
    y += 8;
  }

  // Tabeli päis
  const col = { kirjeldus: leftX, kogus: leftX + 300, uhik: leftX + 350, hind: leftX + 390, summa: leftX + 440 };
  doc.rect(leftX, y, CONTENT_W, 18).fill('#cfe2f3');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
  doc.text('Kirjeldus', col.kirjeldus + 4, y + 5);
  doc.text('Kogus', col.kogus, y + 5, { width: 40, align: 'right' });
  doc.text('Ühik', col.uhik, y + 5, { width: 30, align: 'right' });
  doc.text('Hind', col.hind, y + 5, { width: 40, align: 'right' });
  doc.text('Summa km-ta', col.summa, y + 5, { width: leftX + CONTENT_W - col.summa - 4, align: 'right' });
  y += 18;

  doc.font('Helvetica').fontSize(9);
  read.forEach(r => {
    const kirjeldusH = doc.heightOfString(r.kirjeldus, { width: 290 });
    doc.text(r.kirjeldus, col.kirjeldus + 4, y, { width: 290 });
    doc.text(fmtNum(r.kogus), col.kogus, y, { width: 40, align: 'right' });
    doc.text(r.uhik || '', col.uhik, y, { width: 30, align: 'right' });
    doc.text(fmtEur(r.hind), col.hind, y, { width: 40, align: 'right' });
    doc.text(fmtEur(r.summa), col.summa, y, { width: leftX + CONTENT_W - col.summa - 4, align: 'right' });
    y += Math.max(kirjeldusH, 12) + 6;
    doc.moveTo(leftX, y - 3).lineTo(leftX + CONTENT_W, y - 3).strokeColor('#dddddd').stroke();
  });

  y += 8;
  const totRight = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor('#000');
    doc.text(label, leftX, y, { width: CONTENT_W - 4 });
    doc.text(val, leftX, y, { width: CONTENT_W - 4, align: 'right' });
    y += bold ? 16 : 13;
  };
  totRight(`Summa km-ta ${parseFloat(arve.kaibemaks_protsent)}%`, fmtEur(arve.summa_km_ta), false);
  totRight(`Käibemaks ${parseFloat(arve.kaibemaks_protsent)}%`, fmtEur(arve.kaibemaks), false);
  doc.moveTo(leftX, y).lineTo(leftX + CONTENT_W, y).strokeColor('#000000').stroke();
  y += 6;
  totRight('Arve kokku (EUR)', fmtEur(arve.kokku), true);

  // Jalus
  const footY = 780;
  doc.moveTo(leftX, footY - 10).lineTo(leftX + CONTENT_W, footY - 10).strokeColor('#cccccc').stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#333333');
  if (muuja.telefon) doc.text('Telefon ' + muuja.telefon, leftX, footY);
  if (muuja.epost) doc.text('E-post ' + muuja.epost, leftX, footY + 11);
  doc.text(muuja.ettevote_nimi.toUpperCase(), leftX, footY, { width: CONTENT_W, align: 'right' });
  if (muuja.pangakonto) doc.text((muuja.pank ? muuja.pank + ' ' : '') + 'IBAN ' + muuja.pangakonto, leftX, footY + 11, { width: CONTENT_W, align: 'right' });

  doc.end();
  return doc;
}

router.get('/:id/pdf', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    const a = await pool.query('SELECT * FROM omaarved WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    const arve = a.rows[0];
    if (!arve) return res.status(404).send('Arvet ei leitud');
    const seadedR = await pool.query('SELECT * FROM omaarve_seaded WHERE worker_id=$1', [req.session.workerId]);
    const muuja = seadedR.rows[0];
    if (!muuja) return res.status(400).send('Rekvisiidid puuduvad');
    const readR = await pool.query('SELECT * FROM omaarve_read WHERE arve_id=$1 ORDER BY jrk_nr', [req.params.id]);
    arve.viitenumber = arveViitenumber(arve.number);
    let logoBuf = null;
    if (muuja.logo_url) { try { logoBuf = await fetchImageBuffer(muuja.logo_url); } catch (e) {} }
    const doc = renderOmaArvePdf(muuja, arve, readR.rows, logoBuf);
    const kasutus = req.query.laadi ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${kasutus}; filename="Arve nr ${arve.number}.pdf"`);
    doc.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Viga PDF genereerimisel: ' + err.message);
  }
});

// ── ARVE SAATMINE E-MAILIGA (PDF manusena, sama Resend mida kasutab töö-teavituste saatmine) ──
router.post('/:id/saada-email', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  try {
    const a = await pool.query('SELECT * FROM omaarved WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    const arve = a.rows[0];
    if (!arve) return res.status(404).json({ ok: false, veateade: 'Arvet ei leitud' });
    const sihtEpost = (req.body && req.body.epost) || arve.saaja_epost;
    if (!sihtEpost) return res.json({ ok: false, veateade: 'Sisesta saaja e-posti aadress' });
    if (!process.env.RESEND_API_KEY) return res.json({ ok: false, veateade: 'E-kirja saatmine pole seadistatud (RESEND_API_KEY puudub Railway keskkonnamuutujates).' });

    const seadedR = await pool.query('SELECT * FROM omaarve_seaded WHERE worker_id=$1', [req.session.workerId]);
    const muuja = seadedR.rows[0];
    if (!muuja) return res.json({ ok: false, veateade: 'Rekvisiidid puuduvad' });
    const readR = await pool.query('SELECT * FROM omaarve_read WHERE arve_id=$1 ORDER BY jrk_nr', [req.params.id]);
    arve.viitenumber = arveViitenumber(arve.number);
    let logoBuf = null;
    if (muuja.logo_url) { try { logoBuf = await fetchImageBuffer(muuja.logo_url); } catch (e) {} }
    const doc = renderOmaArvePdf(muuja, arve, readR.rows, logoBuf);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
    const pdfBuffer = Buffer.concat(chunks);

    await getResend().emails.send({
      from: `${muuja.ettevote_nimi} <onboarding@resend.dev>`,
      to: sihtEpost,
      subject: `Arve nr ${arve.number}`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <h2>Arve nr ${arve.number}</h2>
        <p>Tere!</p>
        <p>Manuses on arve nr ${arve.number} summas ${fmtEur(arve.kokku)}, maksetähtaeg ${fmtKp(arve.maksetahtaeg)}.</p>
        <p style="color:#888;font-size:12px">${muuja.ettevote_nimi}</p>
      </div>`,
      attachments: [{ filename: `Arve_${arve.number}.pdf`, content: pdfBuffer.toString('base64') }]
    });

    // Kui e-post anti käsitsi (mitte varem salvestatud), jäta see ka saaja juurde meelde.
    if (req.body && req.body.epost) {
      await pool.query('UPDATE omaarve_saajad SET epost=$1 WHERE worker_id=$2 AND nimi=$3', [req.body.epost, req.session.workerId, arve.saaja_nimi]);
      await pool.query('UPDATE omaarved SET saaja_epost=$1 WHERE id=$2', [req.body.epost, arve.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'E-kirja saatmine ebaõnnestus: ' + err.message });
  }
});

// ── ZIP-ina KORRAGA ALLALAADIMINE ────────────────────────────────────────
router.get('/zip', noudaSisslogimist, noudaOmaarveLubatud, async (req, res) => {
  const idid = (req.query.ids || '').split(',').map(x => parseInt(x, 10)).filter(Boolean);
  if (!idid.length) return res.status(400).json({ ok: false, veateade: 'Vali vähemalt üks arve' });
  try {
    const seadedR = await pool.query('SELECT * FROM omaarve_seaded WHERE worker_id=$1', [req.session.workerId]);
    const muuja = seadedR.rows[0];
    if (!muuja) return res.status(400).json({ ok: false, veateade: 'Rekvisiidid puuduvad' });
    const r = await pool.query('SELECT * FROM omaarved WHERE id = ANY($1) AND worker_id=$2', [idid, req.session.workerId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, veateade: 'Valitud arveid ei leitud' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Minu_arved.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    let logoBuf = null;
    if (muuja.logo_url) { try { logoBuf = await fetchImageBuffer(muuja.logo_url); } catch (e) {} }
    for (const arve of r.rows) {
      const kuupaev = String(arve.kuupaev).split('T')[0];
      const nimiAlus = `${kuupaev}_${arve.number}_${(arve.saaja_nimi || 'saaja')}`.replace(/[^a-zA-Z0-9-_.]/g, '_');
      const readR = await pool.query('SELECT * FROM omaarve_read WHERE arve_id=$1 ORDER BY jrk_nr', [arve.id]);
      arve.viitenumber = arveViitenumber(arve.number);
      const doc = renderOmaArvePdf(muuja, arve, readR.rows, logoBuf);
      archive.append(doc, { name: `${nimiAlus}.pdf` });
    }
    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ADMIN: KELLELE MOODUL NÄHTAV ──────────────────────────────────────────
router.get('/admin/lubatud', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi,
       EXISTS(SELECT 1 FROM omaarve_lubatud ol WHERE ol.worker_id=w.id) as lubatud,
       s.logo_url
       FROM workers w LEFT JOIN omaarve_seaded s ON s.worker_id=w.id
       WHERE w.aktiivne=true ORDER BY w.nimi`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});
// Admin laeb töötaja isikliku arve-logo üles (nt tema oma ettevõtte logo) — kasutatakse
// selle töötaja Minu Arved PDF-idel. Töötaja ise seda üles laadida ei saa.
router.post('/admin/logo/:workerId', noudaAdmin, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Faili ei leitud' });
  try {
    const cl = getCloudinary();
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cl.uploader.upload_stream({ folder: 'royal-paigaldus/omaarve-logod', resource_type: 'image' }, (err, result) => {
        if (err) reject(err); else resolve(result);
      });
      stream.end(req.file.buffer);
    });
    await pool.query(
      `INSERT INTO omaarve_seaded (worker_id, ettevote_nimi, logo_url, logo_public_id)
       VALUES ($1,'',$2,$3)
       ON CONFLICT (worker_id) DO UPDATE SET logo_url=EXCLUDED.logo_url, logo_public_id=EXCLUDED.logo_public_id`,
      [req.params.workerId, uploaded.secure_url, uploaded.public_id]
    );
    res.json({ ok: true, logo_url: uploaded.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Üleslaadimine ebaõnnestus' });
  }
});
router.delete('/admin/logo/:workerId', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT logo_public_id FROM omaarve_seaded WHERE worker_id=$1', [req.params.workerId]);
    if (r.rows.length && r.rows[0].logo_public_id) {
      try { const cl = getCloudinary(); await cl.uploader.destroy(r.rows[0].logo_public_id, { resource_type: 'image' }); } catch (e) {}
    }
    await pool.query('UPDATE omaarve_seaded SET logo_url=NULL, logo_public_id=NULL WHERE worker_id=$1', [req.params.workerId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

router.post('/admin/lubatud/:workerId', noudaAdmin, async (req, res) => {
  const { lubatud } = req.body;
  try {
    if (lubatud) {
      await pool.query('INSERT INTO omaarve_lubatud (worker_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.params.workerId]);
    } else {
      await pool.query('DELETE FROM omaarve_lubatud WHERE worker_id=$1', [req.params.workerId]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
