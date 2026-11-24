const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { onKuuSuletud, SULETUD_TEADE } = require('../kuulukk');
const { kogTeenitudSql, kogMakstudSql, tunnidKellaajast, cramoLounapaus } = require('../saldo');

function noudaSisslogimist(req, res, next) {
  if (!req.session.workerId) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}

// Kellaajad minutiteks; kui lõpp <= algus, läheb kirje üle südaöö (+24h). nihe = päeva nihe minutites.
function minVahemik(algus, lopp, nihe) {
  const m = (x) => { const [h, mm] = String(x).split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(mm, 10) || 0); };
  const a = m(algus); let l = m(lopp);
  if (l <= a) l += 1440;
  return [a + nihe, l + nihe];
}
// Kuupäev kujul AAAA-KK-PP
function kpYmdAbi(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// KAASTÖÖTAJAD: töötaja saab töökirje lisamisel märkida, kes olid temaga samal objektil koos.
// Igale kaaslasele tekib tema enda töökirje (samad kuupäev, kellaajad, objekt, kirjeldus; km 0, pildid
// jäävad ainult lisaja kirjele). lisas_worker_id = kes kirje tema eest lisas, koos_kirje_id = lisaja kirje.
const kaaslasteVeerud = pool.query(
  `ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS lisas_worker_id INTEGER;
   ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS koos_kirje_id INTEGER;
   ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS jagatud_grupp VARCHAR(50);
   ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS jagatud_osa VARCHAR(10);`
).catch(err => console.error('tookirjed kaaslaste veergude loomine ebaõnnestus:', err.message));

// Loob kaaslastele oma töökirjed (kasutavad nii uue kirje lisamine kui olemasoleva muutmine).
// k = lisaja kirje { id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, lidl_projekt_id }
async function lisaKaaslasteKirjed(req, k, kaaslasteIdd) {
  const tulemus = { lisatud: [], vahele: [] };
  if (!kaaslasteIdd.length) return tulemus;
  await kaaslasteVeerud;
  for (const kid of kaaslasteIdd) {
    try {
      const w = await pool.query(
        `SELECT w.nimi FROM workers w JOIN worker_ettevotted we ON we.worker_id = w.id
         WHERE w.id = $1 AND we.ettevote_id = $2 AND w.aktiivne = true`, [kid, k.ettevote_id]);
      if (!w.rows.length) { tulemus.vahele.push({ nimi: '#' + kid, pohjus: 'pole selle ettevõttega seotud' }); continue; }
      const nimi = w.rows[0].nimi;
      // Kattuvuse kontroll minutites; üle südaöö minev kirje (nt 21:30–00:30) loetakse järgmisse päeva ulatuvaks.
      // Vaatame ka eelmise päeva kirjeid, mis võivad üle südaöö sellesse päeva ulatuda.
      const kattub = await pool.query(
        `SELECT t.kuupaev, t.algus, t.lopp, e.nimi AS ettevote, COALESCE(o.nimi, '') AS objekt
         FROM tookirjed t JOIN ettevotted e ON e.id = t.ettevote_id LEFT JOIN objektid o ON o.id = t.objekt_id
         WHERE t.worker_id = $1 AND t.kuupaev BETWEEN ($2::date - 1) AND $2::date`,
        [kid, k.kuupaev]);
      const uusVahemik = minVahemik(k.algus, k.lopp, 0);
      const ees = kattub.rows.find(r => {
        const nihe = kpYmdAbi(r.kuupaev) === String(k.kuupaev).slice(0, 10) ? 0 : -1440;
        const v = minVahemik(r.algus, r.lopp, nihe);
        return v[0] < uusVahemik[1] && v[1] > uusVahemik[0];
      });
      if (ees) {
        const kp = kpYmdAbi(ees.kuupaev).split('-').reverse().slice(0, 2).join('.');
        tulemus.vahele.push({ nimi, pohjus: `tal on juba kirje ${kp} ${String(ees.algus).slice(0, 5)}–${String(ees.lopp).slice(0, 5)} (${ees.ettevote}${ees.objekt ? ', ' + ees.objekt : ''})` });
        continue;
      }
      const uus = await pool.query(
        `INSERT INTO tookirjed (worker_id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, kilomeetrid, km_raha,
           lisakulu_summa, lisakulu_selgitus, lidl_projekt_id, km_soiduk, lisas_worker_id, koos_kirje_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,'',$9,'puudub',$10,$11) RETURNING id`,
        [kid, k.ettevote_id, k.objekt_id || null, k.kuupaev, k.algus, k.lopp, k.tunnid, k.kommentaar || '', k.lidl_projekt_id || null, req.session.workerId, k.id]);
      await pool.query(
        `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
        [req.session.workerId, 'LISA_TOOKIRJE_KAASLASELE', JSON.stringify({
          kirje_id: uus.rows[0].id, kaaslane_id: kid, kaaslane: nimi, koos_kirje_id: k.id,
          ettevote_id: k.ettevote_id, objekt_id: k.objekt_id, kuupaev: k.kuupaev, algus: k.algus, lopp: k.lopp,
          tunnid: parseFloat(k.tunnid).toFixed(2)
        }), req.ip]);
      tulemus.lisatud.push(nimi);
    } catch (e) {
      console.error('Kaaslase kirje viga:', e.message);
      tulemus.vahele.push({ nimi: '#' + kid, pohjus: 'serveri viga' });
    }
  }
  return tulemus;
}
function kaaslasteIdNimekiri(req) {
  return Array.isArray(req.body.kaaslased)
    ? Array.from(new Set(req.body.kaaslased.map(x => parseInt(x, 10)).filter(x => x && x !== req.session.workerId))).slice(0, 4)
    : [];
}

// Kaaslaste valik: aktiivsed töötajad, kes on samale ettevõttele määratud (ilma iseendata)
router.get('/kaaslased/:ettevoteId', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT w.id, w.nimi FROM workers w
       JOIN worker_ettevotted we ON we.worker_id = w.id
       WHERE we.ettevote_id = $1 AND w.aktiivne = true AND w.id <> $2
       ORDER BY w.nimi`,
      [parseInt(req.params.ettevoteId, 10) || 0, req.session.workerId]
    );
    res.json({ ok: true, kaaslased: r.rows });
  } catch (err) {
    console.error(err);
    res.json({ ok: true, kaaslased: [] });
  }
});

// Töötaja ettevõtted (ainult talle määratud)
router.get('/minu-ettevotted', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id, e.nimi, e.tyyp, we.tunnitasu
       FROM worker_ettevotted we
       JOIN ettevotted e ON we.ettevote_id = e.id
       WHERE we.worker_id = $1 AND e.aktiivne = true
       ORDER BY e.id`,
      [req.session.workerId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// Lidl "projektide" nimekiri (Kristo fotode kaustastruktuuri jaoks) — admin hallatav, kuvatakse
// töökirje lisamisel Lidli töö puhul eraldi valikuna (mitte segi vaba "kommentaar" väljaga).
router.get('/lidl-projektid', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, nimi FROM lidl_projektid WHERE aktiivne=true ORDER BY jrk_nr, nimi`);
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// Objektid ettevõtte järgi
router.get('/objektid/:ettevoteId', async (req, res) => {
  // Ainult sisseloginud kasutajale (varem oli avalik)
  if (!req.session || (!req.session.isAdmin && !req.session.workerId)) return res.status(401).json([]);
  try {
    const r = await pool.query(
      `SELECT * FROM objektid WHERE ettevote_id = $1 AND aktiivne = true ORDER BY nimi`,
      [req.params.ettevoteId]
    );
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// Lisa töökirje
// MITU OBJEKTI ÜHE KIRJEGA (nt Lidli "Transporditeenus": üks sõit mitmesse poodi).
// Aeg ja km jagatakse objektide vahel VÕRDSELT: tekib N tavalist töökirjet järjestikuste ajavahemikega
// (nt 10:30–18:30 nelja poe peale -> 10:30–12:30, 12:30–14:30, ...), km = kokku / N. Nii näeb iga pood
// Lidli aruannetes ja arvel oma osa ning kõik olemasolevad aruanded töötavad muutmata.
// Lisakulu ja pildid jäävad esimesele kirjele; kaaslased lisatakse igale osale.
function hhmm(min) { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
router.post('/lisa', noudaSisslogimist, async (req, res) => {
  const objektid = Array.isArray(req.body.objektid)
    ? Array.from(new Set(req.body.objektid.map(x => parseInt(x, 10)).filter(x => x > 0))).slice(0, 30)
    : [];
  if (objektid.length < 2) return lisaUksKirje(req, res);

  const { algus, lopp } = req.body;
  const { minutid } = tunnidKellaajast(algus, lopp);
  const n = objektid.length;
  if (!(minutid > 0)) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
  if (minutid < n) return res.json({ ok: false, veateade: `Liiga lühike aeg ${n} objekti jaoks` });
  const [ah, am] = String(algus).split(':').map(Number);
  const alguseMin = ah * 60 + am;
  const kmKokku = req.body.km_soiduk === 'puudub' ? 0 : (parseFloat(req.body.kilomeetrid) || 0);
  const kmOsa = Math.floor(kmKokku / n * 10) / 10;
  const grupp = String(req.body.klient_id || ('g' + Date.now() + Math.random().toString(36).slice(2, 7))).slice(0, 40);
  const tulemused = [];
  let kasutatudMin = 0, kasutatudKm = 0;
  for (let i = 0; i < n; i++) {
    const viimane = i === n - 1;
    const osaMin = viimane ? minutid - kasutatudMin : Math.floor(minutid / n);
    const osaKm = viimane ? Math.round((kmKokku - kasutatudKm) * 10) / 10 : kmOsa;
    const keha = Object.assign({}, req.body, {
      objekt_id: objektid[i],
      algus: hhmm(alguseMin + kasutatudMin),
      lopp: hhmm(alguseMin + kasutatudMin + osaMin),
      kilomeetrid: osaKm,
      lisakulu_summa: i === 0 ? req.body.lisakulu_summa : 0,
      lisakulu_selgitus: i === 0 ? req.body.lisakulu_selgitus : '',
      klient_id: req.body.klient_id ? (String(req.body.klient_id).slice(0, 34) + '-' + (i + 1)) : null
    });
    delete keha.objektid;
    kasutatudMin += osaMin; kasutatudKm += osaKm;
    const r = await new Promise(resolve => {
      const vale = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(x) { resolve(x); } };
      lisaUksKirje(Object.assign(Object.create(Object.getPrototypeOf(req)), req, { body: keha }), vale);
    });
    if (!r || !r.ok) {
      if (!tulemused.length) return res.json(r || { ok: false, veateade: 'Serveri viga' });
      return res.json({ ok: false, veateade: `Salvestati ${tulemused.length}/${n} objekti, siis tekkis viga: ${(r && r.veateade) || 'serveri viga'}. Kontrolli kirjeid.` });
    }
    tulemused.push(r);
  }
  try {
    await kaaslasteVeerud;
    const idd = tulemused.map(t => t.kirjeId);
    for (let i = 0; i < idd.length; i++) {
      await pool.query('UPDATE tookirjed SET jagatud_grupp=$1, jagatud_osa=$2 WHERE id=$3', [grupp, `${i + 1}/${n}`, idd[i]]);
    }
  } catch (e) { console.error('jagatud_grupp:', e.message); }
  const kaaslased = { lisatud: [], vahele: [] };
  tulemused.forEach(t => { if (t.kaaslased) { kaaslased.lisatud.push(...(t.kaaslased.lisatud || [])); kaaslased.vahele.push(...(t.kaaslased.vahele || [])); } });
  kaaslased.lisatud = Array.from(new Set(kaaslased.lisatud));
  const tunnid = tulemused.reduce((a, t) => a + (parseFloat(t.tunnid) || 0), 0);
  res.json({ ok: true, kirjeId: tulemused[0].kirjeId, tunnid: tunnid.toFixed(2), jagatud: n,
    tunnidOsa: (parseFloat(tulemused[0].tunnid) || 0).toFixed(2), kmOsa, kaaslased });
});

async function lisaUksKirje(req, res) {
  const { ettevote_id, objekt_id, kuupaev, algus, lopp, kommentaar, kilomeetrid, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id, km_soiduk } = req.body;
  const klientId = req.body.klient_id ? String(req.body.klient_id).slice(0, 40) : null;
  try {
    // Sama kirje saadeti juba (telefon ei saanud vastust kätte ja proovis uuesti) — tagasta olemasolev
    if (klientId) {
      const olemas = await pool.query('SELECT id, tunnid FROM tookirjed WHERE worker_id=$1 AND klient_id=$2', [req.session.workerId, klientId]);
      if (olemas.rows.length) return res.json({ ok: true, tunnid: parseFloat(olemas.rows[0].tunnid).toFixed(2), kirjeId: olemas.rows[0].id, korduv: true });
    }
    if (await onKuuSuletud(kuupaev)) return res.json({ ok: false, veateade: SULETUD_TEADE });
    const aeg = tunnidKellaajast(algus, lopp);
    const minutid = aeg.minutid;
    let tunnid = aeg.tunnid;
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    const ettevoteInfo = await pool.query('SELECT tyyp FROM ettevotted WHERE id=$1', [ettevote_id]);
    const tyyp = ettevoteInfo.rows[0]?.tyyp || '';
    tunnid = cramoLounapaus(tunnid, tyyp);

    // Sõiduvahend: 'isiklik' (km-hüvitis 12 €/100 km), 'kaubik' (hüvitist pole, km tulu jääb ettevõttele)
    // või 'puudub' (ei kasutanud sõiduvahendit -> km 0). Vanad kliendid ei saada midagi -> isiklik.
    const soiduk = km_soiduk === 'kaubik' ? 'kaubik' : (km_soiduk === 'puudub' ? 'puudub' : 'isiklik');
    const km = soiduk === 'puudub' ? 0 : (parseFloat(kilomeetrid) || 0);
    const km_raha = km > 0 && soiduk === 'isiklik' ? (km / 100 * 12) : 0;
    const lisakulu = parseFloat(lisakulu_summa) || 0;
    const lisakulu_sel = lisakulu_selgitus || '';

    const result = await pool.query(
      `INSERT INTO tookirjed (worker_id, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, kilomeetrid, km_raha, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id, klient_id, km_soiduk)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [req.session.workerId, ettevote_id, objekt_id || null, kuupaev, algus, lopp, tunnid, kommentaar || '', km, km_raha, lisakulu, lisakulu_sel, lidl_projekt_id || null, klientId, soiduk]
    );
    const kirjeId = result.rows[0].id;

    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'LISA_TOOKIRJE', JSON.stringify({
        kirje_id: kirjeId, ettevote_id, objekt_id, kuupaev, algus, lopp,
        tunnid: tunnid.toFixed(2), kommentaar
      }), req.ip]
    );

    // Kaaslased: igaühele oma töökirje. Km, km-hüvitis ja lisakulu jäävad ainult lisajale (muidu läheks
    // km kliendile topelt arvele). Kui kaaslasel on samal ajal juba kirje, jäetakse ta vahele.
    const kaaslased = await lisaKaaslasteKirjed(req, {
      id: kirjeId, ettevote_id, objekt_id, kuupaev, algus, lopp, tunnid, kommentaar, lidl_projekt_id
    }, kaaslasteIdNimekiri(req));

    res.json({ ok: true, tunnid: tunnid.toFixed(2), km_raha: km_raha.toFixed(2), kirjeId, lounaPaus: tyyp === 'cramo' && tunnid < (minutid/60), kaaslased });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
}

// Kustuta töökirje
router.delete('/kustuta/:id', noudaSisslogimist, async (req, res) => {
  try {
    const kirje = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, o.nimi as objekt_nimi
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id=e.id
       LEFT JOIN objektid o ON t.objekt_id=o.id
       WHERE t.id=$1 AND t.worker_id=$2`,
      [req.params.id, req.session.workerId]
    );
    if (!kirje.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    const k = kirje.rows[0];
    if (await onKuuSuletud(k.kuupaev)) return res.json({ ok: false, veateade: SULETUD_TEADE });

    const r = await pool.query(
      `DELETE FROM tookirjed WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (r.rowCount === 0) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });

    // Lidli poe seis (valmis / puudu) märgiti koos töökirjega — kui selle projekti + poe kohta
    // ühtegi kirjet enam pole, eemaldame ka märke, et fotovaade ei näitaks kustutatud tööd valmis/puudu.
    if (k.lidl_projekt_id && k.objekt_id) {
      try {
        await pool.query(
          `DELETE FROM lidl_poe_seis s WHERE s.projekt_id=$1 AND s.objekt_id=$2
             AND NOT EXISTS (SELECT 1 FROM tookirjed t WHERE t.lidl_projekt_id=$1 AND t.objekt_id=$2)`,
          [k.lidl_projekt_id, k.objekt_id]);
      } catch (e) { /* tabelit pole veel */ }
    }

    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'KUSTUTA_TOOKIRJE', JSON.stringify({
        kirje_id: req.params.id, ettevote: k.ettevote_nimi,
        objekt: k.objekt_nimi, kuupaev: k.kuupaev,
        algus: k.algus, lopp: k.lopp, tunnid: k.tunnid
      }), req.ip]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kuu kokkuvõte
router.get('/kokkuvote', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  const wid = req.session.workerId;
  try {
    await kaaslasteVeerud;
    const kirjed = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp as ettevote_tyyp,
              COALESCE(o.nimi, '') as objekt_nimi,
              COALESCE(t.muu_tunnitasu, we.tunnitasu, 0) as tunnitasu,
              COALESCE(t.kilomeetrid, 0) as kilomeetrid,
              COALESCE(t.km_raha, 0) as km_raha,
              COALESCE(t.lisakulu_summa, 0) as lisakulu_summa,
              COALESCE(t.lisakulu_selgitus, '') as lisakulu_selgitus,
              lp.nimi as lidl_projekt_nimi,
              lw.nimi as lisas_nimi,
              (SELECT string_agg(w2.nimi, ', ' ORDER BY w2.nimi) FROM tookirjed t2 JOIN workers w2 ON w2.id = t2.worker_id
                WHERE t2.koos_kirje_id = t.id) as koos_nimed,
              (SELECT array_agg(t3.worker_id) FROM tookirjed t3 WHERE t3.koos_kirje_id = t.id) as koos_idd
       FROM tookirjed t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       LEFT JOIN worker_ettevotted we ON (we.worker_id = t.worker_id AND we.ettevote_id = t.ettevote_id)
       LEFT JOIN lidl_projektid lp ON t.lidl_projekt_id = lp.id
       LEFT JOIN workers lw ON lw.id = t.lisas_worker_id
       WHERE t.worker_id=$1 AND EXTRACT(YEAR FROM t.kuupaev)=$2 AND EXTRACT(MONTH FROM t.kuupaev)=$3
       ORDER BY t.kuupaev, t.algus`,
      [wid, aasta, kuu]
    );

    // Jooksva kuu teenitud summa
    let teenitud = 0;
    kirjed.rows.forEach(k => {
      teenitud += parseFloat(k.tunnid) * parseFloat(k.tunnitasu || 0);
      teenitud += parseFloat(k.km_raha || 0);
      teenitud += parseFloat(k.lisakulu_summa || 0);
    });

    // Jooksva kuu vabad lisakulud
    const lisakulud = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [wid, aasta, kuu]
    );
    lisakulud.rows.forEach(l => {
      teenitud += parseFloat(l.summa);
    });

    // Jooksva kuu EDGF kulud
    const edgfKulud = await pool.query(
      `SELECT * FROM edgf_kulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [wid, aasta, kuu]
    );
    edgfKulud.rows.forEach(e => {
      teenitud += parseFloat(e.summa);
    });

    // Jooksva kuu Rally Estonia ja X-seeria kulud — et "Teenitud" klapiks admini kokkuvõttega
    const muudKulud = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(summa) FROM re_kulud WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3), 0) +
         COALESCE((SELECT SUM(summa) FROM xseeria_omakulud WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3), 0) AS kokku`,
      [wid, aasta, kuu]
    );
    teenitud += parseFloat(muudKulud.rows[0].kokku) || 0;

    const kogutunnid = kirjed.rows.reduce((s, r) => s + parseFloat(r.tunnid), 0);

    // Jooksva kuu maksed (kuvamiseks)
    const maksed = await pool.query(
      `SELECT COALESCE(SUM(summa),0) as kokku FROM maksed
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3`,
      [wid, aasta, kuu]
    );
    const makstud = parseFloat(maksed.rows[0].kokku);

    // ── KUMULATIIVNE SAADA VEEL ──────────────────────────────────
    // Kõik teenitud kuni selle kuu lõpuni (kaasa arvatud)
    const kuupaevPiir = `${aasta}-${String(kuu).padStart(2, '0')}-01`;

    const kogTeenitudRes = await pool.query(
      `SELECT ${kogTeenitudSql('$1', v => `${v} < $2::date + INTERVAL '1 month'`)} AS kokku`,
      [wid, kuupaevPiir]
    );

    // Kõik maksed kuni selle kuu lõpuni (kaasa arvatud)
    const kogMakstudRes = await pool.query(
      `SELECT ${kogMakstudSql('$1', v => `${v} < $2::date + INTERVAL '1 month'`)} AS kokku`,
      [wid, kuupaevPiir]
    );

    const kogTeenitud = parseFloat(kogTeenitudRes.rows[0].kokku) || 0;
    const kogMakstud = parseFloat(kogMakstudRes.rows[0].kokku) || 0;

    res.json({
      ok: true,
      kirjed: kirjed.rows,
      lisakulud: lisakulud.rows,
      edgfKulud: edgfKulud.rows,
      kogutunnid: kogutunnid.toFixed(2),
      teenitud: teenitud.toFixed(2),
      makstud: makstud.toFixed(2),
      saadaVeel: (kogTeenitud - kogMakstud).toFixed(2)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Tulevased tööd
router.get('/tulevased', noudaSisslogimist, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, e.nimi as ettevote_nimi, e.tyyp,
              COALESCE(o.nimi, '') as objekt_nimi
       FROM tulevased_tood t
       JOIN ettevotted e ON t.ettevote_id = e.id
       LEFT JOIN objektid o ON t.objekt_id = o.id
       WHERE t.worker_id=$1 AND t.kuupaev >= CURRENT_DATE
       ORDER BY t.kuupaev, t.algus_kell`,
      [req.session.workerId]
    );

    // Lisa igale tööle teised samale kuupäevale/objektile määratud töötajad
    const kirjed = r.rows;
    for (const kirje of kirjed) {
      const teised = await pool.query(
        `SELECT w.nimi FROM tulevased_tood tt
         JOIN workers w ON tt.worker_id = w.id
         WHERE tt.kuupaev = $1
           AND tt.ettevote_id = $2
           AND (tt.objekt_id IS NULL OR tt.objekt_id = $3)
           AND tt.worker_id != $4
         ORDER BY w.nimi`,
        [kirje.kuupaev, kirje.ettevote_id, kirje.objekt_id || null, req.session.workerId]
      );
      kirje.teised_tootajad = teised.rows.map(w => w.nimi);
    }

    res.json(kirjed);
  } catch (err) {
    res.json([]);
  }
});

// ── VABAD LISAKULUD ─────────────────────────────────────────────
router.post('/lisakulu/lisa', noudaSisslogimist, async (req, res) => {
  const { kuupaev, summa, selgitus } = req.body;
  if (!kuupaev || !summa || !selgitus) {
    return res.json({ ok: false, veateade: 'Täida kõik väljad' });
  }
  const s = parseFloat(summa);
  if (isNaN(s) || s <= 0) {
    return res.json({ ok: false, veateade: 'Summa peab olema positiivne arv' });
  }
  try {
    if (await onKuuSuletud(kuupaev)) return res.json({ ok: false, veateade: SULETUD_TEADE });
    await pool.query(
      `INSERT INTO lisakulud (worker_id, kuupaev, summa, selgitus) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, kuupaev, s, selgitus]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.get('/lisakulu/kuu', noudaSisslogimist, async (req, res) => {
  const { aasta, kuu } = req.query;
  try {
    const r = await pool.query(
      `SELECT * FROM lisakulud
       WHERE worker_id=$1 AND EXTRACT(YEAR FROM kuupaev)=$2 AND EXTRACT(MONTH FROM kuupaev)=$3
       ORDER BY kuupaev DESC`,
      [req.session.workerId, aasta, kuu]
    );
    res.json({ ok: true, kulud: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

router.delete('/lisakulu/:id', noudaSisslogimist, async (req, res) => {
  try {
    const olemas = await pool.query('SELECT kuupaev FROM lisakulud WHERE id=$1 AND worker_id=$2', [req.params.id, req.session.workerId]);
    if (olemas.rows.length && await onKuuSuletud(olemas.rows[0].kuupaev)) return res.json({ ok: false, veateade: SULETUD_TEADE });
    const r = await pool.query(
      `DELETE FROM lisakulud WHERE id=$1 AND worker_id=$2 RETURNING id`,
      [req.params.id, req.session.workerId]
    );
    if (!r.rowCount) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});

// Kuupäev kujul AAAA-KK-PP (DATE tuleb pg-st Date objektina; toISOString võiks ajavööndi tõttu päeva nihutada)
function kpYmd(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Töötaja muudab oma töökirjet
router.put('/kirje/:id', noudaSisslogimist, async (req, res) => {
  const { kuupaev, algus, lopp, kommentaar, kilomeetrid, lisakulu_summa, lisakulu_selgitus, lidl_projekt_id, km_soiduk } = req.body;
  try {
    const vana = await pool.query(
      'SELECT * FROM tookirjed WHERE id=$1 AND worker_id=$2',
      [req.params.id, req.session.workerId]
    );
    if (!vana.rows.length) return res.json({ ok: false, veateade: 'Kirjet ei leitud' });
    // Suletud kuu: ei saa muuta kirjet, mis on suletud kuus, ega tõsta kirjet suletud kuusse
    if (await onKuuSuletud(vana.rows[0].kuupaev) || await onKuuSuletud(kuupaev)) return res.json({ ok: false, veateade: SULETUD_TEADE });

    let { tunnid } = tunnidKellaajast(algus, lopp);
    if (tunnid <= 0) return res.json({ ok: false, veateade: 'Kontrolli kellaaegu' });
    if (tunnid > 16) return res.json({ ok: false, veateade: 'Üle 16 tunni? Kontrolli kellaaegu' });

    // Cramo lõunapaus
    const ettevoteInfo = await pool.query('SELECT tyyp FROM ettevotted WHERE id=$1', [vana.rows[0].ettevote_id]);
    const tyyp = ettevoteInfo.rows[0]?.tyyp || '';
    tunnid = cramoLounapaus(tunnid, tyyp);

    // Sõiduvahend: 'isiklik' (km-hüvitis 12 €/100 km), 'kaubik' (hüvitist pole, km tulu jääb ettevõttele)
    // või 'puudub' (ei kasutanud sõiduvahendit -> km 0). Vanad kliendid ei saada midagi -> isiklik.
    const soiduk = km_soiduk === 'kaubik' ? 'kaubik' : (km_soiduk === 'puudub' ? 'puudub' : 'isiklik');
    const km = soiduk === 'puudub' ? 0 : (parseFloat(kilomeetrid) || 0);
    const km_raha = km > 0 && soiduk === 'isiklik' ? (km / 100 * 12) : 0;
    const lisakulu = parseFloat(lisakulu_summa) || 0;

    await pool.query(
      `UPDATE tookirjed SET kuupaev=$1, algus=$2, lopp=$3, tunnid=$4, kommentaar=$5,
       kilomeetrid=$6, km_raha=$7, lisakulu_summa=$8, lisakulu_selgitus=$9, lidl_projekt_id=$10, km_soiduk=$12, muudetud_tootaja=NOW() WHERE id=$11`,
      [kuupaev, algus, lopp, tunnid, kommentaar || '', km, km_raha, lisakulu, lisakulu_selgitus || '', lidl_projekt_id || null, req.params.id, soiduk]
    );

    // Muudatuste ajalugu (näeb ainult admin): salvestame kõigi muudetavate väljade vana ja uue väärtuse
    const v = vana.rows[0];
    await pool.query(
      `INSERT INTO audit_log (worker_id, tegevus, details, ip_aadress) VALUES ($1, $2, $3, $4)`,
      [req.session.workerId, 'MUUDA_TOOKIRJE', JSON.stringify({
        kirje_id: req.params.id,
        kuupaev, algus, lopp, tunnid: tunnid.toFixed(2),
        kommentaar: kommentaar || '', kilomeetrid: km,
        lisakulu_summa: lisakulu, lisakulu_selgitus: lisakulu_selgitus || '',
        lidl_projekt_id: lidl_projekt_id || null, km_soiduk: soiduk,
        vana_kuupaev: kpYmd(v.kuupaev), vana_algus: v.algus, vana_lopp: v.lopp,
        vana_tunnid: parseFloat(v.tunnid).toFixed(2),
        vana_kommentaar: v.kommentaar || '', vana_kilomeetrid: parseFloat(v.kilomeetrid) || 0,
        vana_lisakulu_summa: parseFloat(v.lisakulu_summa) || 0, vana_lisakulu_selgitus: v.lisakulu_selgitus || '',
        vana_lidl_projekt_id: v.lidl_projekt_id || null, vana_km_soiduk: v.km_soiduk || 'isiklik'
      }), req.ip]
    );

    // Kaaslaste lisamine olemasolevale kirjele (ainult uued — juba lisatud jäävad nagu on).
    // Kirjele, mille keegi teine sinu eest lisas (koos_kirje_id), kaaslasi lisada ei saa.
    let kaaslased = { lisatud: [], vahele: [] };
    const soovitud = kaaslasteIdNimekiri(req);
    if (soovitud.length && !vana.rows[0].koos_kirje_id) {
      await kaaslasteVeerud;
      const olemas = await pool.query('SELECT worker_id FROM tookirjed WHERE koos_kirje_id=$1', [req.params.id]);
      const olemasIdd = olemas.rows.map(r => r.worker_id);
      const uued = soovitud.filter(id => !olemasIdd.includes(id)).slice(0, Math.max(0, 4 - olemasIdd.length));
      kaaslased = await lisaKaaslasteKirjed(req, {
        id: parseInt(req.params.id, 10), ettevote_id: vana.rows[0].ettevote_id, objekt_id: vana.rows[0].objekt_id,
        kuupaev, algus, lopp, tunnid, kommentaar, lidl_projekt_id
      }, uued);
    }

    res.json({ ok: true, tunnid: tunnid.toFixed(2), kaaslased });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, veateade: 'Serveri viga' });
  }
});


// Töökirjete pildid batch
router.get('/pildid-batch', noudaSisslogimist, async (req, res) => {
  const { ids } = req.query;
  if (!ids) return res.json({ ok: true, pildid: [] });
  try {
    const idList = ids.split(',').map(Number).filter(Boolean);
    if (!idList.length) return res.json({ ok: true, pildid: [] });
    const r = await pool.query(
      `SELECT tp.*, t.worker_id FROM tookirje_pildid tp
       JOIN tookirjed t ON tp.tookirje_id = t.id
       WHERE tp.tookirje_id = ANY($1) AND t.worker_id = $2
       ORDER BY tp.loodud ASC`,
      [idList, req.session.workerId]
    );
    res.json({ ok: true, pildid: r.rows });
  } catch (err) {
    console.error('pildid-batch viga:', err.message);
    res.json({ ok: true, pildid: [] });
  }
});

module.exports = router;
