const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const PDFDocument = require('pdfkit');

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

// Royal Paigaldus OÜ enda (müüja) andmed — samad, mis varasematel arvetel.
const MUUJA = {
  nimi: 'Royal paigaldus OÜ',
  aadress: 'Lai tn 14-14',
  linn: 'Paide linn, Paide linn',
  piirkond: '72711 Järva maakond',
  rg_kood: '16256983',
  kmkr: 'EE102384750',
  telefon: '+37258586475',
  epost: 'ralf.rogov@gmail.com',
  iban: 'EE602200221076951690',
  swift: 'HABAEE2X'
};

// Eesti viitenumbri kontrollnumbri arvutus (7-3-1 kaalud paremalt, kontrollnumber = (10 - summa%10) % 10).
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

// Arve number = kuupäevapõhine (PPKKAA + jrk-number selle päeva sees), nt 17.08.2026 esimene arve = "170826001".
// Ei sõltu globaalsest järjekorrast — arveid võib lisada tagasiulatuvalt ega pea olema kronoloogilises numbrijärjekorras.
function paevaVoti(kuupaev) {
  const dt = new Date(kuupaev);
  return String(dt.getDate()).padStart(2, '0') + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getFullYear()).slice(-2);
}
// Vaatab, milline number järgmisena antud kuupäeva jaoks väljastataks, ilma loendurit suurendamata.
async function vaataJargmineNumber(kuupaev) {
  const paev = paevaVoti(kuupaev);
  const r = await pool.query('SELECT jargmine_jrk FROM arve_paeva_loendur WHERE paev=$1', [paev]);
  const jrk = r.rows.length ? r.rows[0].jargmine_jrk : 1;
  return paev + String(jrk).padStart(3, '0');
}
// Reserveerib järgmise numbri antud kuupäeva jaoks (kasutab transaktsiooni sees rea lukustamist).
async function reserveeriJargmineNumber(client, kuupaev) {
  const paev = paevaVoti(kuupaev);
  const r = await client.query('SELECT jargmine_jrk FROM arve_paeva_loendur WHERE paev=$1 FOR UPDATE', [paev]);
  let jrk;
  if (r.rows.length) {
    jrk = r.rows[0].jargmine_jrk;
    await client.query('UPDATE arve_paeva_loendur SET jargmine_jrk=$1 WHERE paev=$2', [jrk + 1, paev]);
  } else {
    jrk = 1;
    await client.query('INSERT INTO arve_paeva_loendur (paev, jargmine_jrk) VALUES ($1,2)', [paev]);
  }
  return paev + String(jrk).padStart(3, '0');
}

function fmtKp(d) {
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

// ── JÄRGMINE ARVE NUMBER valitud kuupäeva jaoks (ainult vaatamiseks, ei broneeri) ──
router.get('/jargmine-number', noudaAdmin, async (req, res) => {
  try {
    const kuupaev = req.query.kuupaev ? new Date(req.query.kuupaev) : new Date();
    const number = await vaataJargmineNumber(kuupaev);
    res.json({ ok: true, number });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── AUTOTÄITMINE: valmis read valitud ettevõtte+perioodi töökirjete põhjal ──
// viis=koond  -> üks rida kogutundide (levinuima tunnitasuga) + üks rida km transpordi kohta (nagu senine Lidli raport)
// viis=tootajad -> üks rida töötaja kohta, kogus=tema tunnid, hind=tema tunnitasu selle ettevõtte juures (nagu Cramo arved)
router.get('/autotaita', noudaAdmin, async (req, res) => {
  const { ettevote_id, algus, lopp, viis } = req.query;
  if (!ettevote_id || !algus || !lopp) return res.json({ ok: false, veateade: 'Vali ettevõte ja periood' });
  try {
    if (viis === 'tootajad') {
      const r = await pool.query(
        `SELECT w.nimi as worker_nimi, SUM(t.tunnid) as tunnid, we.tunnitasu
         FROM tookirjed t
         JOIN workers w ON t.worker_id = w.id
         LEFT JOIN worker_ettevotted we ON we.worker_id = t.worker_id AND we.ettevote_id = t.ettevote_id
         WHERE t.ettevote_id = $1 AND t.kuupaev BETWEEN $2 AND $3
         GROUP BY w.nimi, we.tunnitasu
         ORDER BY w.nimi`,
        [ettevote_id, algus, lopp]
      );
      const read = r.rows.filter(row => parseFloat(row.tunnid) > 0).map(row => {
        const kogus = parseFloat(row.tunnid);
        const hind = parseFloat(row.tunnitasu || 0);
        return { kirjeldus: `Tööd (${row.worker_nimi})`, kogus, uhik: '', hind, summa: +(kogus * hind).toFixed(2) };
      });
      return res.json({ ok: true, read });
    }

    const tR = await pool.query(
      `SELECT COALESCE(SUM(tunnid),0) as tunnid, COALESCE(SUM(kilomeetrid),0) as km
       FROM tookirjed WHERE ettevote_id=$1 AND kuupaev BETWEEN $2 AND $3`,
      [ettevote_id, algus, lopp]
    );
    const tunnid = parseFloat(tR.rows[0].tunnid), km = parseFloat(tR.rows[0].km);
    const tasuR = await pool.query(
      `SELECT tunnitasu, COUNT(*) c FROM worker_ettevotted WHERE ettevote_id=$1 AND tunnitasu > 0 GROUP BY tunnitasu ORDER BY c DESC LIMIT 1`,
      [ettevote_id]
    );
    const tunnitasu = tasuR.rows[0] ? parseFloat(tasuR.rows[0].tunnitasu) : 0;
    const read = [];
    if (tunnid > 0) read.push({ kirjeldus: 'Tehtud tööd', kogus: tunnid, uhik: 'h', hind: tunnitasu, summa: +(tunnid * tunnitasu).toFixed(2) });
    if (km > 0) read.push({ kirjeldus: 'Transport', kogus: km, uhik: 'km', hind: 0.5, summa: +(km * 0.5).toFixed(2) });
    res.json({ ok: true, read });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ARVETE NIMEKIRI ──────────────────────────────────────────────────────
router.get('/', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, e.nimi as ettevote_nimi FROM arved a LEFT JOIN ettevotted e ON a.ettevote_id = e.id ORDER BY a.kuupaev DESC, a.id DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── ÜKS ARVE (koos ridadega) ───────────────────────────────────────────
router.get('/:id', noudaAdmin, async (req, res) => {
  try {
    const a = await pool.query(
      `SELECT a.*, e.nimi as ettevote_nimi FROM arved a LEFT JOIN ettevotted e ON a.ettevote_id = e.id WHERE a.id=$1`,
      [req.params.id]
    );
    if (!a.rows.length) return res.status(404).json({ ok: false, veateade: 'Arvet ei leitud' });
    const read = await pool.query('SELECT * FROM arve_read WHERE arve_id=$1 ORDER BY jrk_nr', [req.params.id]);
    res.json({ ok: true, arve: a.rows[0], read: read.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── UUE ARVE LOOMINE ─────────────────────────────────────────────────────
router.post('/', noudaAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      ettevote_id, ostja_nimi, ostja_aadress, ostja_rg_kood, ostja_kmkr,
      kontaktisik, po_number, kuupaev, maksetahtaeg_paevad, algus, lopp, read
    } = req.body;
    if (!ostja_nimi || !Array.isArray(read) || !read.length) {
      return res.json({ ok: false, veateade: 'Täida ostja nimi ja vähemalt üks arve rida' });
    }

    await client.query('BEGIN');
    const kp = kuupaev ? new Date(kuupaev) : new Date();
    const number = await reserveeriJargmineNumber(client, kp);

    const paevi = parseInt(maksetahtaeg_paevad, 10) || 14;
    const tahtaeg = new Date(kp);
    tahtaeg.setDate(tahtaeg.getDate() + paevi);
    const viitenumber = arveViitenumber(number);

    const summaKmTa = read.reduce((s, r) => s + (parseFloat(r.summa) || 0), 0);
    const kaibemaksProtsent = 24;
    const kaibemaks = +(summaKmTa * kaibemaksProtsent / 100).toFixed(2);
    const kokku = +(summaKmTa + kaibemaks).toFixed(2);

    const arveR = await client.query(
      `INSERT INTO arved (number, kuupaev, maksetahtaeg, viitenumber, ettevote_id, ostja_nimi, ostja_aadress, ostja_rg_kood, ostja_kmkr, kontaktisik, po_number, algus, lopp, summa_km_ta, kaibemaks_protsent, kaibemaks, kokku)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [number, kp, tahtaeg, viitenumber, ettevote_id || null, ostja_nimi, ostja_aadress || '', ostja_rg_kood || '', ostja_kmkr || '', kontaktisik || '', po_number || '', algus || null, lopp || null, summaKmTa, kaibemaksProtsent, kaibemaks, kokku]
    );
    const arveId = arveR.rows[0].id;

    let jrk = 0;
    for (const rida of read) {
      jrk++;
      await client.query(
        `INSERT INTO arve_read (arve_id, jrk_nr, kirjeldus, kogus, uhik, hind, summa) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [arveId, jrk, rida.kirjeldus, parseFloat(rida.kogus) || 0, rida.uhik || '', parseFloat(rida.hind) || 0, parseFloat(rida.summa) || 0]
      );
    }
    if (ettevote_id && kontaktisik) {
      await client.query('UPDATE ettevotted SET arve_kontakt_viimane=$1 WHERE id=$2', [kontaktisik, ettevote_id]);
    }
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

// ── STAATUS (maksmata/makstud) ───────────────────────────────────────────
router.put('/:id/staatus', noudaAdmin, async (req, res) => {
  const { staatus } = req.body;
  if (!['maksmata', 'makstud'].includes(staatus)) return res.json({ ok: false, veateade: 'Vale staatus' });
  try {
    await pool.query('UPDATE arved SET staatus=$1 WHERE id=$2', [staatus, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── KUSTUTAMINE ──────────────────────────────────────────────────────────
router.delete('/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM arved WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: err.message });
  }
});

// ── PDF GENEREERIMINE ────────────────────────────────────────────────────
router.get('/:id/pdf', noudaAdmin, async (req, res) => {
  try {
    const a = await pool.query('SELECT * FROM arved WHERE id=$1', [req.params.id]);
    const arve = a.rows[0];
    if (!arve) return res.status(404).send('Arvet ei leitud');
    const readR = await pool.query('SELECT * FROM arve_read WHERE arve_id=$1 ORDER BY jrk_nr', [req.params.id]);
    const read = readR.rows;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Royal paigaldus OU Arve nr ${arve.number}.pdf"`);
    doc.pipe(res);

    const MARGIN = 40, PAGE_W = 595.28, CONTENT_W = PAGE_W - MARGIN * 2;
    const leftX = MARGIN, rightColX = MARGIN + 300, rightColW = CONTENT_W - 300;

    doc.font('Helvetica').fontSize(9).fillColor('#000');

    // Vasak veerg — Arve saaja
    let y = MARGIN;
    doc.text('Arve saaja', leftX, y); y += 14;
    doc.font('Helvetica-Bold').fontSize(11).text(arve.ostja_nimi, leftX, y); y += 16;
    doc.font('Helvetica').fontSize(9);
    (arve.ostja_aadress || '').split(',').filter(s => s.trim()).forEach(line => { doc.text(line.trim(), leftX, y); y += 12; });
    y += 10;
    if (arve.ostja_rg_kood) { doc.text('Rg-kood ' + arve.ostja_rg_kood, leftX, y); y += 12; }
    if (arve.ostja_kmkr) { doc.text('KMKR nr ' + arve.ostja_kmkr, leftX, y); y += 12; }

    // Parem veerg — arve number + kuupäevad + müüja
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
    paar('Viitenumber', arve.viitenumber);
    paar('Viivis', '0,05% päevas');
    ry += 8;
    doc.font('Helvetica-Bold').fontSize(10).text(MUUJA.nimi, rightColX, ry, { width: rightColW, align: 'right' }); ry += 14;
    doc.font('Helvetica').fontSize(9);
    [MUUJA.aadress, MUUJA.linn, MUUJA.piirkond].forEach(line => { doc.text(line, rightColX, ry, { width: rightColW, align: 'right' }); ry += 12; });
    ry += 8;
    doc.text('Rg-kood ' + MUUJA.rg_kood, rightColX, ry, { width: rightColW, align: 'right' }); ry += 12;
    doc.text('KMKR nr ' + MUUJA.kmkr, rightColX, ry, { width: rightColW, align: 'right' }); ry += 12;

    y = Math.max(y, ry) + 18;

    // Kontaktisik
    if (arve.kontaktisik) {
      doc.font('Helvetica').fontSize(9).text('Kontaktisik ' + arve.kontaktisik, leftX, y);
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

    if (arve.po_number) {
      y += 10;
      doc.font('Helvetica').fontSize(9).text('PO ' + arve.po_number, leftX, y);
    }

    // Jalus
    const footY = 780;
    doc.moveTo(leftX, footY - 10).lineTo(leftX + CONTENT_W, footY - 10).strokeColor('#cccccc').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    doc.text('Telefon ' + MUUJA.telefon, leftX, footY);
    doc.text('E-post ' + MUUJA.epost, leftX, footY + 11);
    doc.text(MUUJA.nimi.toUpperCase() + '  SWIFT ' + MUUJA.swift, leftX, footY, { width: CONTENT_W, align: 'right' });
    doc.text('IBAN ' + MUUJA.iban, leftX, footY + 11, { width: CONTENT_W, align: 'right' });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Viga PDF genereerimisel: ' + err.message);
  }
});

module.exports = router;
