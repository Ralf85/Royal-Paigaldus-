const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db');
const { csvFail, csvArv } = require('../csvabi');

// ══════════════════════════════════════════════════════════════════════════
// PANK — pangaväljavõtte võrdlus arvetega (Royal Paigaldus, Swedbank)
//
// Kuidas see töötab:
//  * Admin laeb üles Swedbanki väljavõtte: CSV (internetipanga "Konto väljavõte" → CSV) või
//    ISO XML (camt.053). Rakendus tunneb vormingu ise ära.
//  * Iga pangarida salvestatakse tabelisse pank_read. Sama rida teist korda ei teki — võti on panga
//    arhiveerimistunnus (või selle puudumisel kuupäev + summa + osapool + selgitus).
//    Seega võib kattuvaid perioode julgelt mitu korda üles laadida.
//  * LAEKUMISED (raha sisse) sobitatakse väljastatud arvetega (tabel arved): viitenumber, arve number
//    selgituses, summa ja ostja nimi. VÄLJAMINEKUD sobitatakse sissetulnud kuluarvetega (arve_sisse):
//    summa, kuupäev ja nimi/kirjeldus — ning töötajate maksetega (maksed).
//  * Rakendus AINULT PAKUB vasteid. Admin kinnitab ("Seo"), alles siis märgitakse arve makstuks.
//    "Kinnita kõik kindlad" kinnitab korraga ainult need, kus vaste on üheselt kindel.
//  * Mis jääb sobitamata, on "sisse kandmata": väljamineku saab ühe klikiga lisada kuluarvena
//    (arve_sisse, staatus makstud — tšeki/arve faili saab hiljem Arved vaates juurde lisada).
//  * "Ignoreeri" — oma kontode vahelised ülekanded, pangatasud jms. Linnukesega "alati sellelt
//    osapoolelt" tekib reegel (pank_reeglid) ja järgmistel üleslaadimistel ignoreeritakse need ise.
//  * Ainult Royal Paigalduse arved: arved/kulud, mille müüja on Royal Paigaldus või müüja puudub
//    (vanemad kirjed). Teiste oma firmade (Five Under Series, Throw Far) arveid ei pakuta.
//
// Tabelid luuakse siin (mitte db.js-is), et moodul oleks iseseisev — sama muster mis routes/remont.js.
// ══════════════════════════════════════════════════════════════════════════

function noudaAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) return res.status(401).json({ ok: false, veateade: 'Admin õigused puuduvad' });
  next();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let tabelidValmis = null;
function looTabelid() {
  if (!tabelidValmis) {
    tabelidValmis = pool.query(`
      CREATE TABLE IF NOT EXISTS pank_valjavotted (
        id SERIAL PRIMARY KEY,
        failinimi TEXT,
        vorming VARCHAR(10),
        konto VARCHAR(40),
        algus DATE,
        lopp DATE,
        ridu INTEGER DEFAULT 0,
        uusi INTEGER DEFAULT 0,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pank_read (
        id SERIAL PRIMARY KEY,
        valjavote_id INTEGER REFERENCES pank_valjavotted(id) ON DELETE CASCADE,
        voti VARCHAR(80) NOT NULL UNIQUE,
        konto VARCHAR(40),
        kuupaev DATE NOT NULL,
        summa DECIMAL(12,2) NOT NULL,
        valuuta VARCHAR(5) DEFAULT 'EUR',
        osapool TEXT,
        osapoole_konto VARCHAR(40),
        selgitus TEXT,
        viitenumber VARCHAR(40),
        arhiivitunnus VARCHAR(60),
        tehingu_tyyp VARCHAR(20),
        staatus VARCHAR(15) NOT NULL DEFAULT 'lahtine',
        arve_id INTEGER REFERENCES arved(id) ON DELETE SET NULL,
        arve_sisse_id INTEGER REFERENCES arve_sisse(id) ON DELETE SET NULL,
        makse_id INTEGER REFERENCES maksed(id) ON DELETE SET NULL,
        muutis_staatust BOOLEAN DEFAULT false,
        markus TEXT,
        reegel_id INTEGER,
        lahendatud TIMESTAMP,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pank_read_staatus_idx ON pank_read(staatus);
      CREATE INDEX IF NOT EXISTS pank_read_kuupaev_idx ON pank_read(kuupaev);
      CREATE TABLE IF NOT EXISTS pank_reeglid (
        id SERIAL PRIMARY KEY,
        osapool TEXT,
        osapoole_konto VARCHAR(40),
        suund VARCHAR(5) DEFAULT 'koik',
        pohjus TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `).catch(e => { tabelidValmis = null; throw e; });
  }
  return tabelidValmis;
}
looTabelid().catch(e => console.error('⚠️ Pank tabelite loomine:', e.message));
router.use(async (req, res, next) => {
  try { await looTabelid(); next(); }
  catch (e) { res.status(500).json({ ok: false, veateade: 'Andmebaasi viga: ' + e.message }); }
});

// ── ABIFUNKTSIOONID ─────────────────────────────────────────────────────────

function dekodeeri(puhver) {
  // UTF-16 (mõni eksport, nt Excelis "Unicode text") — BOM FF FE / FE FF või iga teine bait null
  if ((puhver[0] === 0xFF && puhver[1] === 0xFE) || (puhver.length > 3 && puhver[1] === 0 && puhver[3] === 0)) {
    return puhver.toString('utf16le').replace(/^\uFEFF/, '');
  }
  if (puhver[0] === 0xFE && puhver[1] === 0xFF) {
    const b = Buffer.from(puhver); b.swap16();
    return b.toString('utf16le').replace(/^\uFEFF/, '');
  }
  let s = puhver.toString('utf8');
  if (s.includes('�')) {
    // Vanemad Swedbanki CSV-d on Windows-1257 (Balti) kodeeringus — muidu tulevad õ/ä/ö/ü valesti.
    try { s = new TextDecoder('windows-1257').decode(puhver); }
    catch (e) { s = puhver.toString('latin1'); }
  }
  return s.replace(/^﻿/, '');
}

function normTekst(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(oü|ou|as|mtü|fie|sia|uab|ltd|oy|ab|gmbh)\b/g, ' ')
    .replace(/[^a-z0-9õäöüšž]+/g, ' ').trim();
}
function sonad(s) { return normTekst(s).split(' ').filter(w => w.length >= 3); }
// Kui suur osa lühema nime sõnadest leidub teises tekstis (0..1)
function nimeSarnasus(a, b) {
  const A = sonad(a), B = sonad(b);
  if (!A.length || !B.length) return 0;
  const lyhem = A.length <= B.length ? A : B, pikem = A.length <= B.length ? B : A;
  let leitud = 0;
  for (const w of lyhem) if (pikem.some(p => p === w || (w.length >= 5 && (p.startsWith(w) || w.startsWith(p))))) leitud++;
  return leitud / lyhem.length;
}
function normViide(v) { return String(v || '').replace(/\D/g, '').replace(/^0+/, ''); }
function arv(s) {
  if (s == null) return NaN;
  let t = String(s).replace(/\s| /g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  return parseFloat(t);
}
function isoKp(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function paevadeVahe(a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000); }
function sentides(n) { return Math.round(Math.abs(parseFloat(n) || 0) * 100); }

// ── CSV (Swedbank) ─────────────────────────────────────────────────────────

function loeCsvRead(tekst) {
  // Eraldaja: see märk (; , tab), mida esimestes ridades kõige rohkem on (pealkirjaread ei sega)
  const algus = tekst.split(/\r?\n/).slice(0, 15).join('\n');
  const loe = (m) => (algus.match(m) || []).length;
  const kandidaadid = [[';', loe(/;/g)], [',', loe(/,/g)], ['\t', loe(/\t/g)]].sort((a, b) => b[1] - a[1]);
  const eraldaja = kandidaadid[0][0];
  const read = []; let rida = [], vali = '', jutus = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (jutus) {
      if (c === '"') { if (tekst[i + 1] === '"') { vali += '"'; i++; } else jutus = false; }
      else vali += c;
    } else if (c === '"') jutus = true;
    else if (c === eraldaja) { rida.push(vali); vali = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && tekst[i + 1] === '\n') i++;
      rida.push(vali); vali = '';
      if (rida.some(v => v.trim() !== '')) read.push(rida);
      rida = [];
    } else vali += c;
  }
  rida.push(vali);
  if (rida.some(v => v.trim() !== '')) read.push(rida);
  return read;
}

// Päiste nimed eesti ja inglise keelses Swedbanki (ja sarnases) väljavõttes.
// Võrdlus käib normaliseeritud kujul (väiketähed, ilma jutumärkide, sulgude ja kirjavahemärkideta).
const PAISED = {
  konto: ['kliendi konto', 'client account', 'konto', 'account', 'konto number', 'account number'],
  reatyyp: ['reatüüp', 'row type', 'rea tüüp', 'kirje tüüp', 'record type'],
  kuupaev: ['kuupäev', 'date', 'kande kuupäev', 'tehingu kuupäev', 'booking date', 'kandekuupäev', 'transaction date', 'value date', 'väärtuspäev', 'kuupaev'],
  osapool: ['saaja/maksja', 'beneficiary/payer', 'saaja / maksja', 'saaja või maksja nimi', 'counterparty', 'saaja maksja', 'beneficiary payer', 'saaja/maksja nimi', 'payee/payer', 'osapool', 'counterparty name'],
  osapoole_konto: ['saaja/maksja konto', 'beneficiary/payer account', 'saaja või maksja konto', 'vastaspoole konto', 'counterparty account', 'saaja maksja konto', 'beneficiary payer account'],
  selgitus: ['selgitus', 'details', 'makse selgitus', 'description', 'selgitus/kirjeldus', 'kirjeldus', 'payment details'],
  summa: ['summa', 'amount', 'summa eur', 'amount eur', 'tehingu summa', 'transaction amount'],
  valuuta: ['valuuta', 'currency'],
  dk: ['deebet/kreedit', 'debit/credit', 'deebet/kreedit (d/c)', 'd/c', 'd/k', 'deebet kreedit', 'debit credit', 'deebet/kreedit d/c', 'debit/credit d/c'],
  arhiiv: ['arhiveerimistunnus', 'transfer reference', 'archive id', 'arhiivitunnus', 'kande viide', 'archiving code', 'arhiveerimiskood', 'tehingu id', 'transaction id'],
  tyyp: ['tehingu tüüp', 'transaction type', 'tüüp', 'type'],
  viide: ['viitenumber', 'reference number', 'viide', 'reference', 'viite number']
};
function normPais(h) {
  return String(h || '').replace(/^\uFEFF/, '').toLowerCase()
    .replace(/[()"'.:]/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
}
const PAISED_NORM = Object.fromEntries(Object.entries(PAISED).map(([k, nimed]) => [k, nimed.map(normPais)]));
function leiaVeerud(rida) {
  const pais = rida.map(normPais);
  const idx = {};
  for (const [voti, nimed] of Object.entries(PAISED_NORM)) {
    idx[voti] = pais.findIndex(h => nimed.includes(h));
  }
  // Varuvõimalus: "summa"/"kuupäev" sõna päise sees (nt "Summa (EUR)", "Kande kuupäev 2026")
  if (idx.summa < 0) idx.summa = pais.findIndex(h => /^(summa|amount)\b/.test(h));
  if (idx.kuupaev < 0) idx.kuupaev = pais.findIndex(h => /kuupäev|kuupaev|\bdate\b/.test(h));
  return { idx, pais };
}

function parsiCsv(tekst) {
  const read = loeCsvRead(tekst);
  if (read.length < 2) throw new Error('Fail on tühi või pole CSV');
  // Päiserida ei pruugi olla esimene (mõnel ekspordil on enne pealkirja-/kontoread) — otsi esimesest 15 reast
  let paiseRida = -1, idx = null, esimenePais = null;
  for (let i = 0; i < Math.min(read.length, 15); i++) {
    const l = leiaVeerud(read[i]);
    if (!esimenePais) esimenePais = l.pais;
    if (l.idx.kuupaev >= 0 && l.idx.summa >= 0) { paiseRida = i; idx = l.idx; break; }
  }
  if (paiseRida < 0) {
    const naide = (esimenePais || []).filter(Boolean).slice(0, 12).join(' | ');
    throw new Error('Ei tundnud väljavõtet ära (puudub kuupäeva või summa veerg). Faili esimese rea veerud: ' + (naide || '—') + '. Lae Swedbanki internetipangast "Konto väljavõte" CSV või XML vormingus.');
  }
  read.splice(0, paiseRida);
  const v = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] || '').trim() : '');
  const tulem = [];
  for (const r of read.slice(1)) {
    const reatyyp = v(r, 'reatyyp');
    // Swedbank: 10 = algsaldo, 20 = tehing, 82 = käive, 86 = lõppsaldo, 900 = intress. Võtame ainult tehingud.
    if (reatyyp && reatyyp !== '20') continue;
    const osapool = v(r, 'osapool');
    if (!reatyyp && /^(algsaldo|lõppsaldo|käive|opening balance|closing balance|turnover)/i.test(osapool || v(r, 'selgitus'))) continue;
    const kuupaev = isoKp(v(r, 'kuupaev'));
    let summa = arv(v(r, 'summa'));
    if (!kuupaev || !Number.isFinite(summa) || summa === 0) continue;
    const dk = v(r, 'dk').toUpperCase();
    if (dk === 'D') summa = -Math.abs(summa);
    else if (dk === 'K' || dk === 'C') summa = Math.abs(summa);
    tulem.push({
      konto: v(r, 'konto').replace(/\s/g, ''),
      kuupaev, summa,
      valuuta: v(r, 'valuuta') || 'EUR',
      osapool,
      osapoole_konto: v(r, 'osapoole_konto').replace(/\s/g, ''),
      selgitus: v(r, 'selgitus'),
      viitenumber: v(r, 'viide'),
      arhiivitunnus: v(r, 'arhiiv'),
      tehingu_tyyp: v(r, 'tyyp')
    });
  }
  return tulem;
}

// ── XML (ISO 20022 camt.053 / camt.052) ───────────────────────────────────

function xmlVali(xml, tee) {
  // tee: ['Cdtr','Nm'] — leiab esimese järjestikku pesastatud sildi sisu (nimeruumi eesliidet arvestamata)
  let osa = xml;
  for (const silt of tee) {
    const m = osa.match(new RegExp(`<(?:\\w+:)?${silt}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${silt}>`));
    if (!m) return '';
    osa = m[1];
  }
  return osa.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function parsiXml(xml) {
  const konto = xmlVali(xml, ['Stmt', 'Acct', 'Id', 'IBAN']) || xmlVali(xml, ['Rpt', 'Acct', 'Id', 'IBAN']);
  const kirjed = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) || [];
  if (!kirjed.length && !/<(?:\w+:)?(Stmt|Rpt)>/.test(xml)) throw new Error('XML-fail pole pangaväljavõte (camt.053)');
  const tulem = [];
  for (const k of kirjed) {
    const summaM = k.match(/<(?:\w+:)?Amt[^>]*Ccy="(\w+)"[^>]*>([\d.,-]+)</);
    if (!summaM) continue;
    const deebet = xmlVali(k, ['CdtDbtInd']) === 'DBIT';
    let summa = Math.abs(arv(summaM[2]));
    if (deebet) summa = -summa;
    const kuupaev = isoKp(xmlVali(k, ['BookgDt', 'Dt']) || xmlVali(k, ['BookgDt', 'DtTm']) || xmlVali(k, ['ValDt', 'Dt']));
    if (!kuupaev || !summa) continue;
    const pool = deebet ? 'Cdtr' : 'Dbtr';
    const osapool = xmlVali(k, ['RltdPties', pool, 'Nm']) || xmlVali(k, ['RltdPties', pool, 'Pty', 'Nm']);
    const osapooleKonto = xmlVali(k, ['RltdPties', pool + 'Acct', 'Id', 'IBAN']);
    const selgitus = (k.match(/<(?:\w+:)?Ustrd>([\s\S]*?)<\/(?:\w+:)?Ustrd>/g) || [])
      .map(u => u.replace(/<[^>]+>/g, '').trim()).join(' ') || xmlVali(k, ['AddtlNtryInf']);
    tulem.push({
      konto: konto.replace(/\s/g, ''),
      kuupaev, summa,
      valuuta: summaM[1] || 'EUR',
      osapool,
      osapoole_konto: osapooleKonto.replace(/\s/g, ''),
      selgitus,
      viitenumber: xmlVali(k, ['CdtrRefInf', 'Ref']),
      arhiivitunnus: xmlVali(k, ['AcctSvcrRef']),
      tehingu_tyyp: xmlVali(k, ['BkTxCd', 'Prtry', 'Cd']) || ''
    });
  }
  return tulem;
}

function parsiValjavote(puhver, failinimi) {
  const tekst = dekodeeri(puhver);
  const onXml = /^\s*<\?xml|<Document[\s>]/i.test(tekst.slice(0, 500)) || /\.xml$/i.test(failinimi || '');
  return { vorming: onXml ? 'xml' : 'csv', read: onXml ? parsiXml(tekst) : parsiCsv(tekst) };
}

function reaVoti(r) {
  if (r.arhiivitunnus) return ('a:' + r.konto + ':' + r.arhiivitunnus).slice(0, 80);
  const h = crypto.createHash('sha1')
    .update([r.konto, r.kuupaev, r.summa.toFixed(2), normTekst(r.osapool), normTekst(r.selgitus)].join('|'))
    .digest('hex');
  return 'h:' + h;
}

// ── SOBITAMINE ─────────────────────────────────────────────────────────────

async function royalMuujaId() {
  const r = await pool.query(`SELECT id FROM arve_muujad
    ORDER BY (ettevote_nimi ILIKE '%royal%') DESC, vaikimisi DESC, id LIMIT 1`);
  return r.rows[0] ? r.rows[0].id : null;
}

// Laeb kõik sobitamise kandidaadid ühe korraga (mitte iga pangarea kohta eraldi päringut)
async function laadiKandidaadid() {
  const royal = await royalMuujaId();
  const muujaTingimus = royal ? `(x.muuja_id IS NULL OR x.muuja_id = ${parseInt(royal, 10)})` : 'TRUE';
  const [arved, sisse, maksed] = await Promise.all([
    pool.query(`SELECT x.id, x.number, to_char(x.kuupaev,'YYYY-MM-DD') AS kuupaev, x.viitenumber, x.ostja_nimi,
                       x.kokku, x.staatus, e.nimi AS ettevote_nimi
                FROM arved x LEFT JOIN ettevotted e ON e.id = x.ettevote_id
                WHERE ${muujaTingimus} AND x.kokku > 0
                  AND NOT EXISTS (SELECT 1 FROM pank_read p WHERE p.arve_id = x.id)
                  AND NOT EXISTS (SELECT 1 FROM arved k WHERE k.kreedit_algne_arve_id = x.id)`),
    pool.query(`SELECT x.id, to_char(x.kuupaev,'YYYY-MM-DD') AS kuupaev, x.kirjeldus, x.summa, x.staatus, e.nimi AS ettevote_nimi
                FROM arve_sisse x LEFT JOIN ettevotted e ON e.id = x.ettevote_id
                WHERE ${muujaTingimus} AND x.summa > 0
                  AND NOT EXISTS (SELECT 1 FROM pank_read p WHERE p.arve_sisse_id = x.id)
                  -- Isikliku kaardiga makstud tšekid ei ole firma pangaväljavõttel (need hüvitatakse omanikule)
                  AND NOT EXISTS (SELECT 1 FROM maksekaardid mk WHERE mk.id = x.kaart_id AND mk.tyyp = 'isiklik')`),
    pool.query(`SELECT m.id, to_char(m.kuupaev,'YYYY-MM-DD') AS kuupaev, m.summa, m.kommentaar, w.nimi AS tootaja
                FROM maksed m LEFT JOIN workers w ON w.id = m.worker_id
                WHERE m.summa > 0 AND NOT EXISTS (SELECT 1 FROM pank_read p WHERE p.makse_id = m.id)`)
  ]);
  return { arved: arved.rows, sisse: sisse.rows, maksed: maksed.rows };
}

// Tagastab pangareale kuni 4 kandidaati, parim esimesena: { tyyp, id, silt, skoor, kindlus, pohjused }
function leiaVasted(rida, k) {
  const summa = parseFloat(rida.summa);
  const sent = sentides(summa);
  const tekst = (rida.selgitus || '') + ' ' + (rida.osapool || '');
  const tekstNorm = tekst.toLowerCase().replace(/[\s-]/g, '');
  const vasted = [];

  if (summa > 0) {
    const viide = normViide(rida.viitenumber) || '';
    // Viitenumber võib olla ka selgituse sees (kui maksja pani selle selgitusse)
    const selgViited = (String(rida.selgitus || '').match(/\d{5,20}/g) || []).map(normViide);
    for (const a of k.arved) {
      let skoor = 0; const pohjused = [];
      const av = normViide(a.viitenumber);
      if (av && (av === viide || selgViited.includes(av))) { skoor += 60; pohjused.push('viitenumber'); }
      const nr = String(a.number || '').toLowerCase().replace(/[\s-]/g, '');
      if (nr.length >= 3 && tekstNorm.includes(nr)) { skoor += 50; pohjused.push('arve nr selgituses'); }
      const summaKlapib = sentides(a.kokku) === sent;
      if (summaKlapib) { skoor += 40; pohjused.push('summa'); }
      const nimi = Math.max(nimeSarnasus(a.ostja_nimi, rida.osapool), nimeSarnasus(a.ettevote_nimi, rida.osapool));
      if (nimi >= 0.5) { skoor += Math.round(20 * nimi); pohjused.push('maksja nimi'); }
      if (a.kuupaev && paevadeVahe(rida.kuupaev, a.kuupaev) < -5) skoor -= 40; // makse enne arvet — ebatõenäoline
      if (a.staatus === 'makstud') skoor -= 5; // juba käsitsi makstuks märgitud — ikka sobib, aga vähem tõenäoline
      if (skoor < 40 || (!summaKlapib && skoor < 60)) continue;
      vasted.push({
        tyyp: 'arve', id: a.id, skoor, pohjused, summaKlapib,
        silt: `Arve ${a.number} · ${a.ostja_nimi || a.ettevote_nimi || ''} · ${eur(a.kokku)}${a.staatus === 'makstud' ? ' (juba makstud)' : ''}`,
        kuupaev: a.kuupaev, staatus: a.staatus
      });
    }
  } else {
    for (const s of k.sisse) {
      if (sentides(s.summa) !== sent) continue;
      let skoor = 50; const pohjused = ['summa'];
      const vahe = s.kuupaev ? Math.abs(paevadeVahe(rida.kuupaev, s.kuupaev)) : 999;
      if (vahe <= 3) { skoor += 25; pohjused.push('kuupäev'); }
      else if (vahe <= 14) { skoor += 15; pohjused.push('kuupäev ±2 näd'); }
      else if (vahe <= 45) skoor += 5;
      else skoor -= 20;
      const nimi = Math.max(nimeSarnasus(s.kirjeldus, tekst), nimeSarnasus(s.ettevote_nimi, tekst));
      if (nimi >= 0.5) { skoor += Math.round(25 * nimi); pohjused.push('nimi'); }
      vasted.push({
        tyyp: 'sisse', id: s.id, skoor, pohjused, summaKlapib: true,
        silt: `Kulu: ${(s.kirjeldus || s.ettevote_nimi || 'kirjelduseta').slice(0, 60)} · ${kp(s.kuupaev)} · ${eur(s.summa)}`,
        kuupaev: s.kuupaev, staatus: s.staatus
      });
    }
    for (const m of k.maksed) {
      if (sentides(m.summa) !== sent) continue;
      const vahe = m.kuupaev ? Math.abs(paevadeVahe(rida.kuupaev, m.kuupaev)) : 999;
      if (vahe > 10) continue;
      let skoor = 45 + (vahe <= 2 ? 20 : 5); const pohjused = ['summa', 'kuupäev'];
      if (nimeSarnasus(m.tootaja, rida.osapool) >= 0.5) { skoor += 25; pohjused.push('töötaja nimi'); }
      vasted.push({
        tyyp: 'makse', id: m.id, skoor, pohjused, summaKlapib: true,
        silt: `Töötaja makse: ${m.tootaja || '?'} · ${kp(m.kuupaev)} · ${eur(m.summa)}`,
        kuupaev: m.kuupaev
      });
    }
  }
  vasted.sort((a, b) => b.skoor - a.skoor);
  // Kindel = kõrge skoor, summa klapib ja järgmine kandidaat jääb selgelt maha
  vasted.forEach((v, i) => {
    const jargmine = vasted[i + 1] ? vasted[i + 1].skoor : 0;
    v.kindlus = v.skoor >= 85 && v.summaKlapib && (i > 0 || v.skoor - jargmine >= 20) ? 'kindel'
      : v.skoor >= 60 ? 'tõenäoline' : 'võimalik';
    if (i > 0 && v.kindlus === 'kindel') v.kindlus = 'tõenäoline';
  });
  return vasted.slice(0, 4);
}

function eur(n) { return (Math.round((parseFloat(n) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }
function kp(s) { const o = String(s || '').split('-'); return o.length === 3 ? `${o[2]}.${o[1]}.${o[0]}` : (s || ''); }

async function rakendaReeglid(ainultLahtised = true) {
  // Märgib ignoreerituks read, mis vastavad mõnele "ignoreeri alati" reeglile
  const r = await pool.query(`
    UPDATE pank_read p SET staatus='ignoreeritud', reegel_id=g.id, markus=COALESCE(g.pohjus,'Reegel'), lahendatud=NOW()
    FROM pank_reeglid g
    WHERE p.staatus='lahtine' ${ainultLahtised ? '' : ''}
      AND ( (g.osapoole_konto IS NOT NULL AND g.osapoole_konto <> '' AND p.osapoole_konto = g.osapoole_konto)
         OR (g.osapool IS NOT NULL AND g.osapool <> '' AND LOWER(TRIM(p.osapool)) = g.osapool) )
      AND (g.suund='koik' OR (g.suund='sisse' AND p.summa > 0) OR (g.suund='valja' AND p.summa < 0))
  `);
  return r.rowCount;
}

const REA_VALJAD = `p.id, to_char(p.kuupaev,'YYYY-MM-DD') AS kuupaev, p.summa, p.valuuta, p.osapool, p.osapoole_konto,
  p.selgitus, p.viitenumber, p.arhiivitunnus, p.konto, p.staatus, p.arve_id, p.arve_sisse_id, p.makse_id,
  p.markus, p.reegel_id, p.muutis_staatust,
  a.number AS arve_number, a.ostja_nimi AS arve_ostja, a.kokku AS arve_kokku,
  s.kirjeldus AS sisse_kirjeldus, s.summa AS sisse_summa,
  w.nimi AS makse_tootaja`;
const REA_JOIN = `FROM pank_read p
  LEFT JOIN arved a ON a.id = p.arve_id
  LEFT JOIN arve_sisse s ON s.id = p.arve_sisse_id
  LEFT JOIN maksed m ON m.id = p.makse_id
  LEFT JOIN workers w ON w.id = m.worker_id`;

// ── API ────────────────────────────────────────────────────────────────────

// Lae väljavõte üles (CSV või XML)
router.post('/laadi', noudaAdmin, upload.single('fail'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, veateade: 'Vali fail' });
  let tulem;
  try { tulem = parsiValjavote(req.file.buffer, req.file.originalname); }
  catch (e) { return res.json({ ok: false, veateade: e.message }); }
  if (!tulem.read.length) return res.json({ ok: false, veateade: 'Failist ei leitud ühtegi tehingut' });

  const kuupaevad = tulem.read.map(r => r.kuupaev).sort();
  const kontod = [...new Set(tulem.read.map(r => r.konto).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = await client.query(
      `INSERT INTO pank_valjavotted (failinimi, vorming, konto, algus, lopp, ridu) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.file.originalname || '', tulem.vorming, kontod.join(', ').slice(0, 40), kuupaevad[0], kuupaevad[kuupaevad.length - 1], tulem.read.length]
    );
    const vId = v.rows[0].id;
    let uusi = 0;
    for (const r of tulem.read) {
      const ins = await client.query(
        `INSERT INTO pank_read (valjavote_id, voti, konto, kuupaev, summa, valuuta, osapool, osapoole_konto, selgitus, viitenumber, arhiivitunnus, tehingu_tyyp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (voti) DO NOTHING RETURNING id`,
        [vId, reaVoti(r), r.konto.slice(0, 40), r.kuupaev, r.summa.toFixed(2), (r.valuuta || 'EUR').slice(0, 5),
          r.osapool || '', (r.osapoole_konto || '').slice(0, 40), r.selgitus || '', (r.viitenumber || '').slice(0, 40),
          (r.arhiivitunnus || '').slice(0, 60), (r.tehingu_tyyp || '').slice(0, 20)]
      );
      if (ins.rows.length) uusi++;
    }
    await client.query('UPDATE pank_valjavotted SET uusi=$1 WHERE id=$2', [uusi, vId]);
    await client.query('COMMIT');
    const ignoreeritud = await rakendaReeglid();
    res.json({
      ok: true, vorming: tulem.vorming, ridu: tulem.read.length, uusi, juba_olemas: tulem.read.length - uusi,
      ignoreeritud, algus: kuupaevad[0], lopp: kuupaevad[kuupaevad.length - 1], konto: kontod.join(', ')
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ ok: false, veateade: e.message });
  } finally { client.release(); }
});

// Pangaread koos vastetega. Filtrid: staatus (lahtine|seotud|ignoreeritud|koik), suund (sisse|valja), algus, lopp
router.get('/read', noudaAdmin, async (req, res) => {
  try {
    const { staatus = 'lahtine', suund, algus, lopp } = req.query;
    const params = []; const tingimused = [];
    if (['lahtine', 'seotud', 'ignoreeritud'].includes(staatus)) { params.push(staatus); tingimused.push(`p.staatus=$${params.length}`); }
    if (suund === 'sisse') tingimused.push('p.summa > 0');
    if (suund === 'valja') tingimused.push('p.summa < 0');
    if (algus) { params.push(algus); tingimused.push(`p.kuupaev >= $${params.length}`); }
    if (lopp) { params.push(lopp); tingimused.push(`p.kuupaev <= $${params.length}`); }
    const r = await pool.query(
      `SELECT ${REA_VALJAD} ${REA_JOIN} ${tingimused.length ? 'WHERE ' + tingimused.join(' AND ') : ''}
       ORDER BY p.kuupaev DESC, p.id DESC LIMIT 1000`, params);
    const lahtised = r.rows.filter(x => x.staatus === 'lahtine');
    if (lahtised.length) {
      const k = await laadiKandidaadid();
      for (const x of lahtised) x.vasted = leiaVasted(x, k);
    }
    res.json({ ok: true, read: r.rows });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

router.get('/kokkuvote', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT staatus, (summa > 0) AS sisse, COUNT(*)::int AS arv, COALESCE(SUM(summa),0) AS summa,
             to_char(MIN(kuupaev),'YYYY-MM-DD') AS algus, to_char(MAX(kuupaev),'YYYY-MM-DD') AS lopp
      FROM pank_read GROUP BY staatus, (summa > 0)`);
    const v = await pool.query(`SELECT id, failinimi, vorming, konto, to_char(algus,'YYYY-MM-DD') AS algus,
      to_char(lopp,'YYYY-MM-DD') AS lopp, ridu, uusi, to_char(loodud,'YYYY-MM-DD HH24:MI') AS loodud
      FROM pank_valjavotted ORDER BY id DESC LIMIT 30`);
    const g = await pool.query(`SELECT id, osapool, osapoole_konto, suund, pohjus FROM pank_reeglid ORDER BY id DESC`);
    res.json({ ok: true, grupid: r.rows, valjavotted: v.rows, reeglid: g.rows });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

// Seo pangarida arve / kulu / töötaja maksega. Väljastatud arve märgitakse makstuks, kulu makstuks.
async function seo(client, ridaId, tyyp, id) {
  const p = await client.query('SELECT id, summa, staatus FROM pank_read WHERE id=$1 FOR UPDATE', [ridaId]);
  if (!p.rows.length) throw new Error('Pangarida ei leitud');
  if (p.rows[0].staatus === 'seotud') throw new Error('Rida on juba seotud');
  const summa = parseFloat(p.rows[0].summa);
  let muutis = false;
  if (tyyp === 'arve') {
    if (summa <= 0) throw new Error('Väljaminekut ei saa siduda väljastatud arvega');
    const a = await client.query('SELECT staatus FROM arved WHERE id=$1', [id]);
    if (!a.rows.length) throw new Error('Arvet ei leitud');
    if ((await client.query('SELECT 1 FROM pank_read WHERE arve_id=$1', [id])).rows.length) throw new Error('See arve on juba teise pangareaga seotud');
    if (a.rows[0].staatus !== 'makstud') { await client.query(`UPDATE arved SET staatus='makstud' WHERE id=$1`, [id]); muutis = true; }
    await client.query(`UPDATE pank_read SET staatus='seotud', arve_id=$1, muutis_staatust=$2, lahendatud=NOW() WHERE id=$3`, [id, muutis, ridaId]);
  } else if (tyyp === 'sisse') {
    if (summa >= 0) throw new Error('Laekumist ei saa siduda kuluarvega');
    const s = await client.query('SELECT staatus FROM arve_sisse WHERE id=$1', [id]);
    if (!s.rows.length) throw new Error('Kulu ei leitud');
    if ((await client.query('SELECT 1 FROM pank_read WHERE arve_sisse_id=$1', [id])).rows.length) throw new Error('See kulu on juba teise pangareaga seotud');
    if (s.rows[0].staatus !== 'makstud') { await client.query(`UPDATE arve_sisse SET staatus='makstud' WHERE id=$1`, [id]); muutis = true; }
    await client.query(`UPDATE pank_read SET staatus='seotud', arve_sisse_id=$1, muutis_staatust=$2, lahendatud=NOW() WHERE id=$3`, [id, muutis, ridaId]);
  } else if (tyyp === 'makse') {
    if ((await client.query('SELECT 1 FROM pank_read WHERE makse_id=$1', [id])).rows.length) throw new Error('See makse on juba teise pangareaga seotud');
    await client.query(`UPDATE pank_read SET staatus='seotud', makse_id=$1, lahendatud=NOW() WHERE id=$2`, [id, ridaId]);
  } else throw new Error('Vale tüüp');
}

router.post('/seo', noudaAdmin, async (req, res) => {
  const { rida_id, tyyp, id } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seo(client, parseInt(rida_id, 10), tyyp, parseInt(id, 10));
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.json({ ok: false, veateade: e.message });
  } finally { client.release(); }
});

// Kinnita korraga kõik "kindel" vasted (arvutatakse serveris uuesti, et vahepeal muutunud andmed ei segaks)
router.post('/seo-kindlad', noudaAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, to_char(kuupaev,'YYYY-MM-DD') AS kuupaev, summa, osapool, selgitus, viitenumber
                                FROM pank_read WHERE staatus='lahtine'`);
    const k = await laadiKandidaadid();
    const kasutatud = new Set();
    let seotud = 0; const vead = [];
    for (const rida of r.rows) {
      const v = leiaVasted(rida, k)[0];
      if (!v || v.kindlus !== 'kindel') continue;
      const voti = v.tyyp + ':' + v.id;
      if (kasutatud.has(voti)) continue; // kaks pangarida ei saa sama arvet võtta
      kasutatud.add(voti);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await seo(client, rida.id, v.tyyp, v.id);
        await client.query('COMMIT');
        seotud++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        vead.push(e.message);
      } finally { client.release(); }
    }
    res.json({ ok: true, seotud, vead });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

// Võta sidumine/ignoreerimine tagasi. Kui sidumine märkis arve makstuks, pannakse see tagasi maksmata/ootel.
router.post('/tagasi', noudaAdmin, async (req, res) => {
  const ridaId = parseInt((req.body || {}).rida_id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query('SELECT * FROM pank_read WHERE id=$1 FOR UPDATE', [ridaId]);
    if (!p.rows.length) throw new Error('Pangarida ei leitud');
    const x = p.rows[0];
    if (x.muutis_staatust && x.arve_id) await client.query(`UPDATE arved SET staatus='maksmata' WHERE id=$1`, [x.arve_id]);
    if (x.muutis_staatust && x.arve_sisse_id) await client.query(`UPDATE arve_sisse SET staatus='ootel' WHERE id=$1`, [x.arve_sisse_id]);
    await client.query(`UPDATE pank_read SET staatus='lahtine', arve_id=NULL, arve_sisse_id=NULL, makse_id=NULL,
      muutis_staatust=false, markus=NULL, reegel_id=NULL, lahendatud=NULL WHERE id=$1`, [ridaId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.json({ ok: false, veateade: e.message });
  } finally { client.release(); }
});

// Ignoreeri rida (nt oma kontode vaheline ülekanne). reegel=true → ignoreeri alati sellelt osapoolelt.
router.post('/ignoreeri', noudaAdmin, async (req, res) => {
  const { rida_id, pohjus, reegel } = req.body || {};
  try {
    const p = await pool.query('SELECT osapool, osapoole_konto, summa FROM pank_read WHERE id=$1', [parseInt(rida_id, 10)]);
    if (!p.rows.length) return res.json({ ok: false, veateade: 'Pangarida ei leitud' });
    const x = p.rows[0];
    let reegelId = null, lisaks = 0;
    if (reegel) {
      const osapool = String(x.osapool || '').trim().toLowerCase();
      if (!osapool && !x.osapoole_konto) return res.json({ ok: false, veateade: 'Real pole osapoolt — reeglit ei saa teha' });
      const g = await pool.query(`INSERT INTO pank_reeglid (osapool, osapoole_konto, suund, pohjus) VALUES ($1,$2,$3,$4) RETURNING id`,
        [osapool || null, x.osapoole_konto || null, parseFloat(x.summa) > 0 ? 'sisse' : 'valja', (pohjus || '').trim() || 'Ignoreeri alati']);
      reegelId = g.rows[0].id;
    }
    await pool.query(`UPDATE pank_read SET staatus='ignoreeritud', markus=$1, reegel_id=$2, lahendatud=NOW() WHERE id=$3`,
      [(pohjus || '').trim() || 'Ignoreeritud', reegelId, parseInt(rida_id, 10)]);
    if (reegel) lisaks = await rakendaReeglid();
    res.json({ ok: true, lisaks });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

router.delete('/reeglid/:id', noudaAdmin, async (req, res) => {
  try {
    // Reegli kustutamisel jäävad varem ignoreeritud read ignoreerituks (neid saab ükshaaval tagasi võtta)
    await pool.query('UPDATE pank_read SET reegel_id=NULL WHERE reegel_id=$1', [req.params.id]);
    await pool.query('DELETE FROM pank_reeglid WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

// Lisa väljaminek kuluarvena (arve_sisse) ja seo kohe pangareaga
router.post('/lisa-kulu', noudaAdmin, async (req, res) => {
  const { rida_id, kirjeldus, kaibemaks, ettevote_id } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(`SELECT id, to_char(kuupaev,'YYYY-MM-DD') AS kuupaev, summa, staatus FROM pank_read WHERE id=$1 FOR UPDATE`, [parseInt(rida_id, 10)]);
    if (!p.rows.length) throw new Error('Pangarida ei leitud');
    const x = p.rows[0];
    if (x.staatus === 'seotud') throw new Error('Rida on juba seotud');
    const summa = Math.abs(parseFloat(x.summa));
    if (parseFloat(x.summa) >= 0) throw new Error('Kuluna saab lisada ainult väljamineku');
    const km = Math.max(0, Math.min(summa, parseFloat(String(kaibemaks || '0').replace(',', '.')) || 0));
    const royal = await royalMuujaId();
    const s = await client.query(
      `INSERT INTO arve_sisse (kuupaev, tahtaeg, ettevote_id, kirjeldus, summa, kaibemaks, staatus, muuja_id)
       VALUES ($1,$1,$2,$3,$4,$5,'makstud',$6) RETURNING id`,
      [x.kuupaev, parseInt(ettevote_id, 10) || null, (kirjeldus || '').trim() || 'Pangast', summa.toFixed(2), km.toFixed(2), royal]
    );
    await client.query(`UPDATE pank_read SET staatus='seotud', arve_sisse_id=$1, muutis_staatust=false, lahendatud=NOW(),
      markus='Lisatud kuluna pangast' WHERE id=$2`, [s.rows[0].id, x.id]);
    await client.query('COMMIT');
    res.json({ ok: true, arve_sisse_id: s.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.json({ ok: false, veateade: e.message });
  } finally { client.release(); }
});

// Kustuta üleslaetud väljavõte (nt vale fail). Selle read kaovad; seotud arvete staatust ei muudeta.
router.delete('/valjavotted/:id', noudaAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM pank_valjavotted WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

// Sisse kandmata read CSV-na (semikoolon + BOM eestikeelse Exceli jaoks)
router.get('/eksport', noudaAdmin, async (req, res) => {
  try {
    const { staatus = 'lahtine' } = req.query;
    const params = []; let where = '';
    if (['lahtine', 'seotud', 'ignoreeritud'].includes(staatus)) { params.push(staatus); where = 'WHERE p.staatus=$1'; }
    const r = await pool.query(`SELECT ${REA_VALJAD} ${REA_JOIN} ${where} ORDER BY p.kuupaev, p.id`, params);
    const read = [['Kuupäev', 'Suund', 'Osapool', 'Selgitus', 'Viitenumber', 'Summa', 'Staatus', 'Seotud', 'Märkus']];
    for (const x of r.rows) {
      const seos = x.arve_number ? 'Arve ' + x.arve_number : x.sisse_kirjeldus ? 'Kulu: ' + x.sisse_kirjeldus : x.makse_tootaja ? 'Töötaja makse: ' + x.makse_tootaja : '';
      read.push([kp(x.kuupaev), parseFloat(x.summa) > 0 ? 'Sisse' : 'Välja', x.osapool || '', x.selgitus || '', x.viitenumber || '',
        csvArv(x.summa, 2), x.staatus, seos, x.markus || '']);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pank_${staatus}_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvFail(read));
  } catch (e) { res.status(500).json({ ok: false, veateade: e.message }); }
});

router._test = { parsiCsv, parsiXml, parsiValjavote, leiaVasted, nimeSarnasus };
module.exports = router;
