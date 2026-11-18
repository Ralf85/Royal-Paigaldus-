// routes/pokker.js — TELJE POKKER: sõpruskonna pokkeriturniiride haldus.
//
//  * Oma tabelid (pokker_*), luuakse automaatselt esimesel päringul (vt looTabelid).
//  * Õigused:
//      - admin  = Royal Paigalduse peaadmin (req.session.isAdmin) VÕI pokkeri admin-PIN-iga sisse loginu.
//      - mangija = ühise klubi-PIN-iga sisse loginu — näeb kõike, muuta ei saa.
//      - TV-vaade = /pokker-tv?voti=... (salajane TV-võti seadetes) — ainult LIVE andmed, ilma PIN-ita.
//  * Turniirikell elab serveris (pokker_turniirid.kell): { idx, jookseb, lopp (ms), jaak (ms) }.
//    Kõik seadmed arvutavad allesjäänud aja sama "lopp" ajahetke järgi, nii et kell on igal ekraanil sama
//    ja säilib ka lehe värskendamisel / telefoni lukustumisel.
//  * Iga mängijaga seotud tegevus (rebuy, re-entry, add-on, väljalangemine, taastamine) logitakse
//    tabelisse pokker_tegevused — sealt saab viimase tegevuse tagasi võtta.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../db');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { lukusMinuteid, margiVale, margiOige, lukuTeade, valeTeade, turvalineVordlus } = require('../loginkaitse');

const SESSIOON_PAEVI = 365;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Ainult pildifailid!'));
  }
});
function getCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return cloudinary;
}

// ── ALGANDMED ─────────────────────────────────────────────────────────────
const VAIKE_PUNKTID = [10, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1];
const VAIKE_JAOTUS = [50, 30, 20];

const REBUY_SEADED = {
  tyyp: 'rebuy', buyin: 20, bounty: 0, algstack: 8000,
  rebuy_summa: 20, rebuy_stack: 8000,
  reentry_summa: 0, reentry_stack: 0,
  addon_summa: 20, addon_stack: 12000,
  lisaperiood_levelid: 6, hiline_reg_levelid: 6,
  leveli_min: 20, pausi_min: 10
};
const REBUY_STRUKTUUR = [
  [25, 50], [50, 100], [100, 200], [150, 300], [200, 400], [300, 600], 'PAUS_ADDON',
  [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000]
].map(x => x === 'PAUS_ADDON' ? { paus: true, addon: true, min: 10 } : { sb: x[0], bb: x[1], ante: 0, bba: false, min: 20 });

const REENTRY_SEADED = {
  tyyp: 'reentry', buyin: 40, bounty: 10, algstack: 18000,
  rebuy_summa: 0, rebuy_stack: 0,
  reentry_summa: 40, reentry_stack: 18000,
  addon_summa: 0, addon_stack: 0,
  lisaperiood_levelid: 4, hiline_reg_levelid: 4,
  leveli_min: 30, pausi_min: 10
};
const REENTRY_STRUKTUUR = [
  [100, 200], [200, 400], [300, 600], [400, 800], 'PAUS',
  [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [4000, 8000], [5000, 10000]
].map(x => x === 'PAUS' ? { paus: true, addon: false, min: 10 } : { sb: x[0], bb: x[1], ante: 0, bba: false, min: 30 });

// 2026. aasta edetabel Excelist (seis enne rakenduse kasutuselevõttu).
const ALGNE_EDETABEL_2026 = [
  ['Liis Rogov', 74], ['Gerli Rüüberg', 73], ['Andrus Aavik', 61], ['Ralf Rogov', 53], ['Raivo Nõmmik', 53],
  ['Dmitri Smirnov', 48], ['Kaspar Sale', 32], ['Maarja Kaalep', 29], ['Kaarel Kirikal', 22], ['Kert Rang', 21],
  ['Allar Lauring', 19], ['Andres Krjukov', 1]
];

// ── TABELID ───────────────────────────────────────────────────────────────
async function looTabelid() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pokker_seaded (
      id INTEGER PRIMARY KEY,
      klubi_pin VARCHAR(20),
      admin_pin VARCHAR(20),
      tv_voti VARCHAR(40),
      punktid JSONB,
      auhinnajaotus JSONB,
      helid BOOLEAN NOT NULL DEFAULT true,
      versioon INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pokker_sessions (
      id SERIAL PRIMARY KEY,
      token VARCHAR(100) NOT NULL UNIQUE,
      roll VARCHAR(10) NOT NULL,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_mangijad (
      id SERIAL PRIMARY KEY,
      nimi VARCHAR(100) NOT NULL,
      foto_url TEXT,
      foto_public_id TEXT,
      arhiveeritud BOOLEAN NOT NULL DEFAULT false,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_formaadid (
      id SERIAL PRIMARY KEY,
      nimi VARCHAR(100) NOT NULL,
      seaded JSONB NOT NULL,
      struktuur JSONB NOT NULL,
      jrk INTEGER NOT NULL DEFAULT 0,
      arhiveeritud BOOLEAN NOT NULL DEFAULT false,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_hooajad (
      id SERIAL PRIMARY KEY,
      nimi VARCHAR(100) NOT NULL,
      algus DATE NOT NULL,
      lopp DATE NOT NULL,
      punktid JSONB NOT NULL,
      lopetatud BOOLEAN NOT NULL DEFAULT false,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_korrektsioonid (
      id SERIAL PRIMARY KEY,
      hooaeg_id INTEGER NOT NULL REFERENCES pokker_hooajad(id) ON DELETE CASCADE,
      mangija_id INTEGER NOT NULL REFERENCES pokker_mangijad(id) ON DELETE CASCADE,
      punktid DECIMAL(10,2) NOT NULL DEFAULT 0,
      turniire INTEGER NOT NULL DEFAULT 0,
      voite INTEGER NOT NULL DEFAULT 0,
      markus TEXT,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_turniirid (
      id SERIAL PRIMARY KEY,
      nimi VARCHAR(150) NOT NULL,
      kuupaev DATE NOT NULL,
      formaat_id INTEGER REFERENCES pokker_formaadid(id) ON DELETE SET NULL,
      formaadi_nimi VARCHAR(100),
      seaded JSONB NOT NULL,
      struktuur JSONB NOT NULL,
      hooaeg_id INTEGER REFERENCES pokker_hooajad(id) ON DELETE SET NULL,
      punktiturniir BOOLEAN NOT NULL DEFAULT true,
      staatus VARCHAR(12) NOT NULL DEFAULT 'ootel',
      kell JSONB,
      alustatud TIMESTAMP,
      lopetatud TIMESTAMP,
      ajalooline BOOLEAN NOT NULL DEFAULT false,
      markus TEXT,
      loodud TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pokker_osalejad (
      id SERIAL PRIMARY KEY,
      turniir_id INTEGER NOT NULL REFERENCES pokker_turniirid(id) ON DELETE CASCADE,
      mangija_id INTEGER NOT NULL REFERENCES pokker_mangijad(id) ON DELETE CASCADE,
      rebuyd INTEGER NOT NULL DEFAULT 0,
      reentryd INTEGER NOT NULL DEFAULT 0,
      addonid INTEGER NOT NULL DEFAULT 0,
      valjas BOOLEAN NOT NULL DEFAULT false,
      valja_jrk INTEGER,
      valja_loi INTEGER,
      koht INTEGER,
      punktid DECIMAL(10,2) NOT NULL DEFAULT 0,
      bounty_arv INTEGER NOT NULL DEFAULT 0,
      bounty_eur DECIMAL(10,2) NOT NULL DEFAULT 0,
      auhind DECIMAL(10,2) NOT NULL DEFAULT 0,
      makstud BOOLEAN NOT NULL DEFAULT false,
      loodud TIMESTAMP DEFAULT NOW(),
      UNIQUE (turniir_id, mangija_id)
    );
    CREATE INDEX IF NOT EXISTS pokker_osalejad_turniir_idx ON pokker_osalejad(turniir_id);
    CREATE INDEX IF NOT EXISTS pokker_osalejad_mangija_idx ON pokker_osalejad(mangija_id);
    CREATE TABLE IF NOT EXISTS pokker_tegevused (
      id SERIAL PRIMARY KEY,
      turniir_id INTEGER NOT NULL REFERENCES pokker_turniirid(id) ON DELETE CASCADE,
      tyyp VARCHAR(20) NOT NULL,
      andmed JSONB NOT NULL DEFAULT '{}'::jsonb,
      tagasi BOOLEAN NOT NULL DEFAULT false,
      aeg TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(
    `INSERT INTO pokker_seaded (id, punktid, auhinnajaotus, tv_voti) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(VAIKE_PUNKTID), JSON.stringify(VAIKE_JAOTUS), crypto.randomBytes(12).toString('hex')]
  );
  const v = (await pool.query(`SELECT versioon FROM pokker_seaded WHERE id=1`)).rows[0].versioon;
  // Ühekordne algseadistus: kaks DONKFEST formaati, hooaeg 2026, mängijad ja nende senised punktid.
  if (v < 1) {
    const f = await pool.query(`SELECT COUNT(*)::int AS n FROM pokker_formaadid`);
    if (!f.rows[0].n) {
      await pool.query(`INSERT INTO pokker_formaadid (nimi, seaded, struktuur, jrk) VALUES ($1,$2,$3,1), ($4,$5,$6,2)`, [
        'DONKFEST REBUY', JSON.stringify(REBUY_SEADED), JSON.stringify(REBUY_STRUKTUUR),
        'DONKFEST RE-ENTRY', JSON.stringify(REENTRY_SEADED), JSON.stringify(REENTRY_STRUKTUUR)
      ]);
    }
    const h = await pool.query(`SELECT id FROM pokker_hooajad WHERE nimi='Hooaeg 2026'`);
    let hooaegId = h.rows[0] && h.rows[0].id;
    if (!hooaegId) {
      hooaegId = (await pool.query(
        `INSERT INTO pokker_hooajad (nimi, algus, lopp, punktid) VALUES ('Hooaeg 2026','2026-01-01','2026-12-31',$1) RETURNING id`,
        [JSON.stringify(VAIKE_PUNKTID)]
      )).rows[0].id;
    }
    for (const [nimi, punktid] of ALGNE_EDETABEL_2026) {
      let m = await pool.query(`SELECT id FROM pokker_mangijad WHERE nimi=$1`, [nimi]);
      const mid = m.rows[0] ? m.rows[0].id : (await pool.query(`INSERT INTO pokker_mangijad (nimi) VALUES ($1) RETURNING id`, [nimi])).rows[0].id;
      await pool.query(
        `INSERT INTO pokker_korrektsioonid (hooaeg_id, mangija_id, punktid, markus) VALUES ($1,$2,$3,'Excelist üle toodud (seis 18.11.2026)')`,
        [hooaegId, mid, punktid]
      );
    }
    await pool.query(`UPDATE pokker_seaded SET versioon=1 WHERE id=1`);
  }
  await pool.query(`DELETE FROM pokker_sessions WHERE loodud < NOW() - INTERVAL '${SESSIOON_PAEVI} days'`);
}
let valmisLubadus = null;
function valmis() {
  if (!valmisLubadus) {
    valmisLubadus = looTabelid().catch((err) => { valmisLubadus = null; throw err; });
  }
  return valmisLubadus;
}
router.use(async (req, res, next) => {
  try { await valmis(); next(); } catch (err) { next(err); }
});

// ── ÕIGUSED ───────────────────────────────────────────────────────────────
async function leiaRoll(req) {
  if (req.session && req.session.isAdmin) return 'admin';
  const token = req.sessionToken;
  if (!token) return null;
  const r = await pool.query(
    `SELECT roll FROM pokker_sessions WHERE token=$1 AND loodud > NOW() - INTERVAL '${SESSIOON_PAEVI} days'`, [token]
  );
  return r.rows.length ? r.rows[0].roll : null;
}
async function noudaVaatajat(req, res, next) {
  req.pokkerRoll = await leiaRoll(req);
  if (!req.pokkerRoll) return res.status(401).json({ ok: false, veateade: 'Palun logi sisse' });
  next();
}
async function noudaAdmin(req, res, next) {
  req.pokkerRoll = await leiaRoll(req);
  if (req.pokkerRoll !== 'admin') return res.status(403).json({ ok: false, veateade: 'Ainult administraator' });
  next();
}

// ── ABIFUNKTSIOONID ───────────────────────────────────────────────────────
const nr = (x, vaike = 0) => { const n = parseFloat(x); return Number.isFinite(n) ? n : vaike; };
const ts = (x, vaike = 0) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : vaike; };
const r2 = (x) => Math.round(x * 100) / 100;
const puhasNimi = (x, max = 100) => String(x == null ? '' : x).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const onKuupaev = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

function puhastaSeaded(s) {
  s = s || {};
  const tyyp = ['rebuy', 'reentry', 'freezeout'].includes(s.tyyp) ? s.tyyp : 'freezeout';
  return {
    tyyp,
    buyin: Math.max(0, nr(s.buyin)), bounty: Math.max(0, nr(s.bounty)), algstack: Math.max(0, ts(s.algstack)),
    rebuy_summa: Math.max(0, nr(s.rebuy_summa)), rebuy_stack: Math.max(0, ts(s.rebuy_stack)),
    reentry_summa: Math.max(0, nr(s.reentry_summa)), reentry_stack: Math.max(0, ts(s.reentry_stack)),
    addon_summa: Math.max(0, nr(s.addon_summa)), addon_stack: Math.max(0, ts(s.addon_stack)),
    lisaperiood_levelid: Math.max(0, ts(s.lisaperiood_levelid)),
    hiline_reg_levelid: Math.max(0, ts(s.hiline_reg_levelid)),
    leveli_min: Math.max(1, nr(s.leveli_min, 20)), pausi_min: Math.max(1, nr(s.pausi_min, 10))
  };
}
function puhastaStruktuur(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 80).map(x => x && x.paus
    ? { paus: true, addon: !!x.addon, min: Math.max(0.5, nr(x.min, 10)) }
    : Object.assign({ sb: Math.max(0, ts(x && x.sb)), bb: Math.max(0, ts(x && x.bb)), ante: Math.max(0, ts(x && x.ante)), bba: !!(x && x.bba), min: Math.max(0.5, nr(x && x.min, 20)) },
        x && x.jatk ? { jatk: true } : {}));
}
function puhastaPunktid(arr) {
  if (!Array.isArray(arr)) return VAIKE_PUNKTID.slice();
  const p = arr.slice(0, 50).map(x => Math.max(0, nr(x)));
  return p.length ? p : VAIKE_PUNKTID.slice();
}
function punktidKohale(tabel, koht) {
  if (!koht || koht < 1 || !tabel.length) return 0;
  return koht <= tabel.length ? tabel[koht - 1] : tabel[tabel.length - 1];
}

// ── TURNIIRIKELL ──────────────────────────────────────────────────────────
function kestus(el, s) { return Math.round((nr(el && el.min) || (el && el.paus ? s.pausi_min : s.leveli_min)) * 60000); }
function algKell(struktuur, s) { return { idx: 0, jookseb: false, jaak: kestus(struktuur[0], s), lopp: null }; }
// Kui kell on vahepeal edasi jooksnud (level läbi), viime selle õigesse kohta.
function normaliseeri(kell, struktuur, s, nuud) {
  const k = Object.assign({}, kell || algKell(struktuur, s));
  if (!struktuur.length) return k;
  if (k.idx >= struktuur.length) k.idx = struktuur.length - 1;
  if (!k.jookseb) return k;
  let kaitse = 0;
  while (nuud >= k.lopp && kaitse++ < 200) {
    if (k.idx >= struktuur.length - 1) { k.jookseb = false; k.jaak = 0; k.lopp = null; break; }
    k.idx += 1;
    k.lopp += kestus(struktuur[k.idx], s);
  }
  return k;
}
function jaak(k, nuud) { return k.jookseb ? Math.max(0, k.lopp - nuud) : Math.max(0, k.jaak || 0); }
function seaJaak(k, ms, nuud) { if (k.jookseb) k.lopp = nuud + ms; else k.jaak = ms; }
// "jatk" = sama level jätkub pärast vahele pandud pausi (vt kaivita_paus) — seda ei loeta uueks leveliks.
const onUusLevel = (el) => el && !el.paus && !el.jatk;
function leveliNumber(struktuur, idx) { let n = 0; for (let i = 0; i <= idx && i < struktuur.length; i++) if (onUusLevel(struktuur[i])) n++; return n; }

// Kõik kellast tuletatud näitajad TV-vaate ja juhtpuldi jaoks.
function kellaInfo(t, nuud) {
  const s = t.seaded, st = t.struktuur;
  const k = normaliseeri(t.kell, st, s, nuud);
  const el = st[k.idx] || null;
  const j = jaak(k, nuud);
  let jargmineLevel = null;
  for (let i = k.idx + 1; i < st.length; i++) {
    if (st[i].paus) continue;
    if (st[i].jatk && !(el && el.paus)) continue; // pooleli level jätkub pärast pausi — järgmised blindid on päris järgmine level
    jargmineLevel = st[i]; break;
  }
  let pausini = null;
  if (el && !el.paus) {
    let summa = j, leitud = false;
    for (let i = k.idx + 1; i < st.length; i++) { if (st[i].paus) { leitud = true; break; } summa += kestus(st[i], s); }
    pausini = leitud ? summa : null;
  }
  const levelNr = leveliNumber(st, k.idx);
  const N = s.lisaperiood_levelid || 0;
  const lisaTyyp = s.tyyp === 'rebuy' ? 'rebuy' : s.tyyp === 'reentry' ? 're-entry' : null;
  let periood = { tyyp: lisaTyyp, avatud: false, jaak: null };
  if (lisaTyyp && N > 0 && el) {
    const avatud = el.paus ? levelNr < N : levelNr <= N;
    let lopuni = null;
    if (avatud) {
      lopuni = j; let n = levelNr;
      // Liidame järgnevate elementide kestused kuni level N lõpuni (k.a selle pausi järel jätkuv osa).
      for (let i = k.idx + 1; i < st.length; i++) {
        if (onUusLevel(st[i])) { if (n >= N) break; n++; }
        else if (st[i].paus && n >= N) break;
        lopuni += kestus(st[i], s);
      }
    }
    periood = { tyyp: lisaTyyp, avatud, jaak: lopuni };
  }
  const hiline = s.hiline_reg_levelid > 0 ? (el && (el.paus ? levelNr < s.hiline_reg_levelid : levelNr <= s.hiline_reg_levelid)) : true;
  return {
    kell: k, jaak: j, element: el, level_nr: levelNr, jargmine: jargmineLevel, pausini,
    periood, hiline_reg: !!hiline, addon_aeg: !!(el && el.paus && el.addon), viimane: k.idx >= st.length - 1
  };
}

// ── STATISTIKA ARVUTUS ÜHE TURNIIRI KOHTA ─────────────────────────────────
function mangijaKulu(o, s) {
  return r2(s.buyin + s.bounty + o.rebuyd * s.rebuy_summa + o.reentryd * (s.reentry_summa + s.bounty) + o.addonid * s.addon_summa);
}
function turniiriSummad(t, osalejad) {
  const s = t.seaded;
  const n = osalejad.length;
  const sum = (v) => osalejad.reduce((a, o) => a + (o[v] || 0), 0);
  const rebuyd = sum('rebuyd'), reentryd = sum('reentryd'), addonid = sum('addonid');
  const aktiivseid = osalejad.filter(o => !o.valjas).length;
  const zetoonid = n * s.algstack + rebuyd * s.rebuy_stack + reentryd * s.reentry_stack + addonid * s.addon_stack;
  const buyinid = r2(n * s.buyin), rebuySum = r2(rebuyd * s.rebuy_summa), reentrySum = r2(reentryd * s.reentry_summa), addonSum = r2(addonid * s.addon_summa);
  return {
    mangijaid: n, aktiivseid, rebuyd, reentryd, addonid, zetoonid,
    keskmine_stack: aktiivseid ? Math.round(zetoonid / aktiivseid) : 0,
    buyinid, rebuy_summa: rebuySum, reentry_summa: reentrySum, addon_summa: addonSum,
    auhinnafond: r2(buyinid + rebuySum + reentrySum + addonSum),
    bountyfond: r2((n + reentryd) * s.bounty),
    kogusumma: r2(buyinid + rebuySum + reentrySum + addonSum + (n + reentryd) * s.bounty)
  };
}
function vormistaOsaleja(o, s) {
  const x = {
    id: o.id, mangija_id: o.mangija_id, nimi: o.nimi, foto_url: o.foto_url,
    rebuyd: o.rebuyd, reentryd: o.reentryd, addonid: o.addonid,
    valjas: o.valjas, valja_jrk: o.valja_jrk, valja_loi: o.valja_loi, koht: o.koht,
    punktid: nr(o.punktid), bounty_arv: o.bounty_arv, bounty_eur: nr(o.bounty_eur),
    auhind: nr(o.auhind), makstud: o.makstud
  };
  x.lisatud_zetoone = o.rebuyd * s.rebuy_stack + o.reentryd * s.reentry_stack + o.addonid * s.addon_stack;
  x.kulu = mangijaKulu(o, s);
  return x;
}
// Nimekirja järjekord: aktiivsed üleval (tähestikus), väljalangenud all — viimasena välja langenu kõige ülemine.
function jarjestaOsalejad(list) {
  return list.slice().sort((a, b) => {
    if (a.valjas !== b.valjas) return a.valjas ? 1 : -1;
    if (a.koht && b.koht) return a.koht - b.koht;
    if (a.valjas) return (b.valja_jrk || 0) - (a.valja_jrk || 0);
    return a.nimi.localeCompare(b.nimi, 'et');
  });
}

async function laeTurniir(id) {
  const r = await pool.query(
    `SELECT t.*, h.nimi AS hooaja_nimi FROM pokker_turniirid t LEFT JOIN pokker_hooajad h ON h.id=t.hooaeg_id WHERE t.id=$1`, [id]
  );
  if (!r.rows.length) return null;
  const t = r.rows[0];
  t.seaded = puhastaSeaded(t.seaded);
  t.struktuur = puhastaStruktuur(t.struktuur);
  return t;
}
async function laeOsalejad(turniirId) {
  const r = await pool.query(
    `SELECT o.*, m.nimi, m.foto_url FROM pokker_osalejad o JOIN pokker_mangijad m ON m.id=o.mangija_id WHERE o.turniir_id=$1`, [turniirId]
  );
  return r.rows;
}
async function turniiriTaisinfo(t, nuud) {
  const osalejad = await laeOsalejad(t.id);
  const summad = turniiriSummad(t, osalejad);
  const list = jarjestaOsalejad(osalejad.map(o => vormistaOsaleja(o, t.seaded)));
  const nimed = {}; list.forEach(o => { nimed[o.id] = o.nimi; });
  list.forEach(o => { o.valja_loi_nimi = o.valja_loi ? (nimed[o.valja_loi] || null) : null; });
  const info = (t.staatus === 'ootel' || t.staatus === 'kaib') ? kellaInfo(t, nuud) : null;
  return {
    turniir: {
      id: t.id, nimi: t.nimi, kuupaev: kpStr(t.kuupaev), formaat_id: t.formaat_id, formaadi_nimi: t.formaadi_nimi,
      seaded: t.seaded, struktuur: t.struktuur, hooaeg_id: t.hooaeg_id, hooaja_nimi: t.hooaja_nimi,
      punktiturniir: t.punktiturniir, staatus: t.staatus, ajalooline: t.ajalooline, markus: t.markus,
      alustatud: t.alustatud, lopetatud: t.lopetatud
    },
    kell: info, osalejad: list, summad, nuud
  };
}
function kpStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
async function salvestaKell(t, k) {
  await pool.query(`UPDATE pokker_turniirid SET kell=$1 WHERE id=$2`, [JSON.stringify(k), t.id]);
}
async function logi(turniirId, tyyp, andmed) {
  await pool.query(`INSERT INTO pokker_tegevused (turniir_id, tyyp, andmed) VALUES ($1,$2,$3)`, [turniirId, tyyp, JSON.stringify(andmed || {})]);
}
async function punktiTabel(t) {
  if (t.hooaeg_id) {
    const h = await pool.query(`SELECT punktid FROM pokker_hooajad WHERE id=$1`, [t.hooaeg_id]);
    if (h.rows.length) return puhastaPunktid(h.rows[0].punktid);
  }
  const s = await pool.query(`SELECT punktid FROM pokker_seaded WHERE id=1`);
  return puhastaPunktid(s.rows[0].punktid);
}
// Lõppjärjestus väljalangemise järjekorra põhjal: aktiivsed (tavaliselt 1 = võitja) saavad kõrgemad kohad.
async function maaraKohad(t) {
  const os = await laeOsalejad(t.id);
  const aktiivsed = os.filter(o => !o.valjas).sort((a, b) => a.nimi.localeCompare(b.nimi, 'et'));
  const valjas = os.filter(o => o.valjas).sort((a, b) => (b.valja_jrk || 0) - (a.valja_jrk || 0));
  let koht = 1;
  for (const o of aktiivsed.concat(valjas)) {
    await pool.query(`UPDATE pokker_osalejad SET koht=$1 WHERE id=$2`, [koht++, o.id]);
  }
}
async function arvutaPunktid(t) {
  const tabel = await punktiTabel(t);
  const os = await laeOsalejad(t.id);
  for (const o of os) {
    const p = t.punktiturniir ? punktidKohale(tabel, o.koht) : 0;
    await pool.query(`UPDATE pokker_osalejad SET punktid=$1 WHERE id=$2`, [p, o.id]);
  }
}
async function leiaHooaegKuupaevaks(kp) {
  const r = await pool.query(`SELECT id FROM pokker_hooajad WHERE algus <= $1 AND lopp >= $1 ORDER BY lopetatud, algus DESC LIMIT 1`, [kp]);
  return r.rows[0] ? r.rows[0].id : null;
}

// ── SISSELOGIMINE ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const pin = req.body && typeof req.body.pin === 'string' ? req.body.pin.trim() : '';
  const lukus = await lukusMinuteid(req, 'pokker');
  if (lukus) return res.json({ ok: false, veateade: lukuTeade(lukus), lukus: true });
  if (!pin) return res.json({ ok: false, veateade: 'Sisesta PIN-kood' });
  const s = (await pool.query(`SELECT klubi_pin, admin_pin FROM pokker_seaded WHERE id=1`)).rows[0];
  let roll = null;
  if (turvalineVordlus(pin, s.admin_pin || '')) roll = 'admin';
  else if (turvalineVordlus(pin, s.klubi_pin || '')) roll = 'mangija';
  if (!roll) {
    const alles = await margiVale(req, 'pokker');
    return res.json({ ok: false, veateade: valeTeade('Vale PIN-kood', alles) });
  }
  await margiOige(req, 'pokker');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO pokker_sessions (token, roll) VALUES ($1,$2)`, [token, roll]);
  res.json({ ok: true, token, roll });
});
router.post('/logout', async (req, res) => {
  if (req.sessionToken) await pool.query(`DELETE FROM pokker_sessions WHERE token=$1`, [req.sessionToken]);
  res.json({ ok: true });
});
router.get('/sessioon', async (req, res) => {
  res.json({ ok: true, roll: await leiaRoll(req) });
});

// ── LIVE (TV + kõik vaatajad) ─────────────────────────────────────────────
// TV pääseb ligi salajase võtmega (?voti=...), ülejäänud oma sessiooniga.
async function liveLigipaas(req, res, next) {
  const voti = typeof req.query.voti === 'string' ? req.query.voti : '';
  if (voti) {
    const s = await pool.query(`SELECT tv_voti FROM pokker_seaded WHERE id=1`);
    if (turvalineVordlus(voti, s.rows[0].tv_voti || '')) return next();
    return res.status(401).json({ ok: false, veateade: 'Vale TV-link' });
  }
  return noudaVaatajat(req, res, next);
}
router.get('/live', liveLigipaas, async (req, res) => {
  const nuud = Date.now();
  let id = ts(req.query.turniir_id, 0);
  if (!id) {
    const r = await pool.query(
      `SELECT id FROM pokker_turniirid WHERE staatus IN ('kaib','ootel') AND ajalooline=false
       ORDER BY (staatus='kaib') DESC, kuupaev ASC, id DESC LIMIT 1`
    );
    if (!r.rows.length) {
      // Pole käimasolevat — näitame viimati lõppenud turniiri tulemusi (kui see oli täna/eile).
      const l = await pool.query(
        `SELECT id FROM pokker_turniirid WHERE staatus IN ('lopetatud','kinnitatud') AND ajalooline=false AND lopetatud > NOW() - INTERVAL '18 hours'
         ORDER BY lopetatud DESC LIMIT 1`
      );
      if (!l.rows.length) return res.json({ ok: true, turniir: null, nuud });
      id = l.rows[0].id;
    } else id = r.rows[0].id;
  }
  const t = await laeTurniir(id);
  if (!t) return res.json({ ok: true, turniir: null, nuud });
  const s = await pool.query(`SELECT helid FROM pokker_seaded WHERE id=1`);
  res.json(Object.assign({ ok: true, helid: s.rows[0].helid }, await turniiriTaisinfo(t, nuud)));
});

// ── AVALEHT ───────────────────────────────────────────────────────────────
router.get('/avaleht', noudaVaatajat, async (req, res) => {
  const jargmine = await pool.query(
    `SELECT id, nimi, kuupaev, formaadi_nimi, staatus FROM pokker_turniirid WHERE staatus IN ('ootel','kaib') AND ajalooline=false
     ORDER BY (staatus='kaib') DESC, kuupaev ASC LIMIT 1`
  );
  const viimane = await pool.query(
    `SELECT t.id, t.nimi, t.kuupaev, t.formaadi_nimi,
       (SELECT m.nimi FROM pokker_osalejad o JOIN pokker_mangijad m ON m.id=o.mangija_id WHERE o.turniir_id=t.id AND o.koht=1 LIMIT 1) AS voitja
     FROM pokker_turniirid t WHERE t.staatus IN ('lopetatud','kinnitatud') ORDER BY t.kuupaev DESC, t.id DESC LIMIT 1`
  );
  const hooaeg = await pool.query(`SELECT id, nimi FROM pokker_hooajad WHERE lopetatud=false ORDER BY algus DESC LIMIT 1`);
  let top = [];
  if (hooaeg.rows.length) top = (await edetabel(hooaeg.rows[0].id)).read.slice(0, 5);
  const kokku = await pool.query(
    `SELECT COUNT(*)::int AS turniire, (SELECT COUNT(*)::int FROM pokker_mangijad WHERE arhiveeritud=false) AS mangijaid
     FROM pokker_turniirid WHERE staatus IN ('lopetatud','kinnitatud')`
  );
  const jt = jargmine.rows[0];
  res.json({
    ok: true, roll: req.pokkerRoll,
    jargmine: jt ? Object.assign({}, jt, { kuupaev: kpStr(jt.kuupaev) }) : null,
    viimane: viimane.rows[0] ? Object.assign({}, viimane.rows[0], { kuupaev: kpStr(viimane.rows[0].kuupaev) }) : null,
    hooaeg: hooaeg.rows[0] || null, top, kokku: kokku.rows[0]
  });
});

// ── MÄNGIJAD ──────────────────────────────────────────────────────────────
router.get('/mangijad', noudaVaatajat, async (req, res) => {
  const r = await pool.query(
    `SELECT m.id, m.nimi, m.foto_url, m.arhiveeritud,
       COUNT(o.id) FILTER (WHERE t.staatus IN ('lopetatud','kinnitatud'))::int AS turniire,
       COUNT(o.id) FILTER (WHERE o.koht=1 AND t.staatus IN ('lopetatud','kinnitatud'))::int AS voite
     FROM pokker_mangijad m
     LEFT JOIN pokker_osalejad o ON o.mangija_id=m.id
     LEFT JOIN pokker_turniirid t ON t.id=o.turniir_id
     GROUP BY m.id ORDER BY m.arhiveeritud, m.nimi`
  );
  res.json({ ok: true, mangijad: r.rows });
});
router.post('/mangijad', noudaAdmin, async (req, res) => {
  const nimi = puhasNimi(req.body.nimi);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta nimi' });
  const olemas = await pool.query(`SELECT id FROM pokker_mangijad WHERE LOWER(nimi)=LOWER($1)`, [nimi]);
  if (olemas.rows.length) return res.json({ ok: false, veateade: 'Selle nimega mängija on juba olemas' });
  const r = await pool.query(`INSERT INTO pokker_mangijad (nimi) VALUES ($1) RETURNING id`, [nimi]);
  res.json({ ok: true, id: r.rows[0].id });
});
router.put('/mangijad/:id', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const nimi = puhasNimi(req.body.nimi);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta nimi' });
  await pool.query(`UPDATE pokker_mangijad SET nimi=$1, arhiveeritud=$2 WHERE id=$3`, [nimi, !!req.body.arhiveeritud, id]);
  res.json({ ok: true });
});
router.post('/mangijad/:id/foto', noudaAdmin, upload.single('foto'), async (req, res) => {
  const id = ts(req.params.id);
  if (!req.file) return res.json({ ok: false, veateade: 'Pilt puudub' });
  const cl = getCloudinary();
  const tulemus = await new Promise((resolve, reject) => {
    cl.uploader.upload_stream(
      { folder: 'pokker', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }] },
      (err, r) => err ? reject(err) : resolve(r)
    ).end(req.file.buffer);
  });
  const vana = await pool.query(`SELECT foto_public_id FROM pokker_mangijad WHERE id=$1`, [id]);
  await pool.query(`UPDATE pokker_mangijad SET foto_url=$1, foto_public_id=$2 WHERE id=$3`, [tulemus.secure_url, tulemus.public_id, id]);
  if (vana.rows[0] && vana.rows[0].foto_public_id) cl.uploader.destroy(vana.rows[0].foto_public_id).catch(() => {});
  res.json({ ok: true, foto_url: tulemus.secure_url });
});
router.delete('/mangijad/:id/foto', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const vana = await pool.query(`SELECT foto_public_id FROM pokker_mangijad WHERE id=$1`, [id]);
  await pool.query(`UPDATE pokker_mangijad SET foto_url=NULL, foto_public_id=NULL WHERE id=$1`, [id]);
  if (vana.rows[0] && vana.rows[0].foto_public_id) getCloudinary().uploader.destroy(vana.rows[0].foto_public_id).catch(() => {});
  res.json({ ok: true });
});

// Mängija profiil + statistika
router.get('/mangijad/:id', noudaVaatajat, async (req, res) => {
  const id = ts(req.params.id);
  const m = await pool.query(`SELECT id, nimi, foto_url, arhiveeritud FROM pokker_mangijad WHERE id=$1`, [id]);
  if (!m.rows.length) return res.json({ ok: false, veateade: 'Mängijat ei leitud' });
  const r = await pool.query(
    `SELECT o.*, t.nimi AS turniir, t.kuupaev, t.formaadi_nimi, t.seaded, t.hooaeg_id, t.punktiturniir, h.nimi AS hooaja_nimi,
       (SELECT COUNT(*)::int FROM pokker_osalejad x WHERE x.turniir_id=t.id) AS osalejaid
     FROM pokker_osalejad o JOIN pokker_turniirid t ON t.id=o.turniir_id LEFT JOIN pokker_hooajad h ON h.id=t.hooaeg_id
     WHERE o.mangija_id=$1 AND t.staatus IN ('lopetatud','kinnitatud') ORDER BY t.kuupaev DESC, t.id DESC`, [id]
  );
  const kor = await pool.query(
    `SELECT k.hooaeg_id, h.nimi AS hooaja_nimi, SUM(k.punktid) AS punktid, SUM(k.turniire)::int AS turniire, SUM(k.voite)::int AS voite
     FROM pokker_korrektsioonid k JOIN pokker_hooajad h ON h.id=k.hooaeg_id WHERE k.mangija_id=$1 GROUP BY k.hooaeg_id, h.nimi`, [id]
  );
  const tulemused = r.rows.map(o => {
    const s = puhastaSeaded(o.seaded);
    return {
      turniir_id: o.turniir_id, turniir: o.turniir, kuupaev: kpStr(o.kuupaev), formaat: o.formaadi_nimi || '—',
      hooaeg_id: o.hooaeg_id, hooaja_nimi: o.hooaja_nimi, punktiturniir: o.punktiturniir,
      koht: o.koht, osalejaid: o.osalejaid, punktid: nr(o.punktid), rebuyd: o.rebuyd, reentryd: o.reentryd, addonid: o.addonid,
      bounty_arv: o.bounty_arv, bounty_eur: nr(o.bounty_eur), auhind: nr(o.auhind), kulu: mangijaKulu(o, s)
    };
  });
  const kokku = koondStatistika(tulemused);
  kokku.punktid = r2(kokku.punktid + kor.rows.reduce((a, k) => a + nr(k.punktid), 0));
  // Hooaegade kaupa
  const hooajad = {};
  tulemused.forEach(x => {
    const v = x.hooaeg_id || 0;
    if (!hooajad[v]) hooajad[v] = { hooaeg_id: x.hooaeg_id, nimi: x.hooaja_nimi || 'Hooajata', list: [] };
    hooajad[v].list.push(x);
  });
  kor.rows.forEach(k => { if (!hooajad[k.hooaeg_id]) hooajad[k.hooaeg_id] = { hooaeg_id: k.hooaeg_id, nimi: k.hooaja_nimi, list: [] }; });
  const hooajaStat = [];
  for (const h of Object.values(hooajad)) {
    const st = koondStatistika(h.list);
    const k = kor.rows.find(x => x.hooaeg_id === h.hooaeg_id);
    if (k) { st.punktid = r2(st.punktid + nr(k.punktid)); st.turniire += k.turniire; st.voite += k.voite; st.korrektsioon = nr(k.punktid); }
    let koht = null;
    if (h.hooaeg_id) {
      const et = await edetabel(h.hooaeg_id);
      const rida = et.read.find(x => x.mangija_id === id);
      koht = rida ? rida.koht : null;
    }
    hooajaStat.push(Object.assign({ hooaeg_id: h.hooaeg_id, nimi: h.nimi, koht }, st));
  }
  // Formaatide kaupa
  const formaadid = {};
  tulemused.forEach(x => { (formaadid[x.formaat] = formaadid[x.formaat] || []).push(x); });
  const formaadiStat = Object.entries(formaadid).map(([f, list]) => Object.assign({ formaat: f }, koondStatistika(list)));
  // Praegune hooaeg
  const ph = await pool.query(`SELECT id, nimi FROM pokker_hooajad WHERE lopetatud=false ORDER BY algus DESC LIMIT 1`);
  let praegune = null;
  if (ph.rows.length) {
    const et = await edetabel(ph.rows[0].id);
    const rida = et.read.find(x => x.mangija_id === id);
    praegune = { nimi: ph.rows[0].nimi, punktid: rida ? rida.punktid : 0, koht: rida ? rida.koht : null, mangijaid: et.read.length };
  }
  // Välja löödud = lõpetatud turniiridel tema poolt välja märgitud mängijad + re-entry'd, mille põhjustas tema.
  const valjaLoodud = await pool.query(
    `SELECT (SELECT COUNT(*) FROM pokker_osalejad x JOIN pokker_osalejad o ON o.id = x.valja_loi
              JOIN pokker_turniirid t ON t.id = x.turniir_id
             WHERE o.mangija_id=$1 AND t.staatus IN ('lopetatud','kinnitatud'))
          + (SELECT COUNT(*) FROM pokker_tegevused g JOIN pokker_osalejad o ON o.id = (g.andmed->>'loi')::int
              JOIN pokker_turniirid t ON t.id = g.turniir_id
             WHERE g.tagasi=false AND g.tyyp='reentry' AND o.mangija_id=$1 AND t.staatus IN ('lopetatud','kinnitatud')) AS n`, [id]
  );
  valjaLoodud.rows[0].n = parseInt(valjaLoodud.rows[0].n, 10) || 0;
  kokku.valja_loodud = Math.max(kokku.bounty_arv, valjaLoodud.rows[0].n);
  res.json({ ok: true, mangija: m.rows[0], kokku, praegune, hooajad: hooajaStat, formaadid: formaadiStat, tulemused });
});
function koondStatistika(list) {
  const k = { turniire: list.length, voite: 0, teisi: 0, kolmandaid: 0, top3: 0, punktid: 0, rebuyd: 0, reentryd: 0, addonid: 0,
    bounty_arv: 0, bounty_eur: 0, auhinnad: 0, kulud: 0, parim: null, keskmine_koht: null };
  let kohtadeSumma = 0, kohtadeArv = 0;
  list.forEach(x => {
    if (x.koht === 1) k.voite++;
    if (x.koht === 2) k.teisi++;
    if (x.koht === 3) k.kolmandaid++;
    if (x.koht && x.koht <= 3) k.top3++;
    if (x.koht) { kohtadeSumma += x.koht; kohtadeArv++; if (!k.parim || x.koht < k.parim) k.parim = x.koht; }
    k.punktid += x.punktid; k.rebuyd += x.rebuyd; k.reentryd += x.reentryd; k.addonid += x.addonid;
    k.bounty_arv += x.bounty_arv; k.bounty_eur += x.bounty_eur; k.auhinnad += x.auhind; k.kulud += x.kulu;
  });
  k.punktid = r2(k.punktid); k.bounty_eur = r2(k.bounty_eur); k.auhinnad = r2(k.auhinnad); k.kulud = r2(k.kulud);
  k.saldo = r2(k.auhinnad + k.bounty_eur - k.kulud);
  k.keskmine_koht = kohtadeArv ? Math.round(kohtadeSumma / kohtadeArv * 10) / 10 : null;
  return k;
}

// ── HOOAJA EDETABEL ───────────────────────────────────────────────────────
async function edetabel(hooaegId) {
  const t = await pool.query(
    `SELECT id, nimi, kuupaev, formaadi_nimi FROM pokker_turniirid
     WHERE hooaeg_id=$1 AND punktiturniir=true AND staatus IN ('lopetatud','kinnitatud') ORDER BY kuupaev, id`, [hooaegId]
  );
  const turniirid = t.rows.map(x => ({ id: x.id, nimi: x.nimi, kuupaev: kpStr(x.kuupaev), formaat: x.formaadi_nimi }));
  const o = await pool.query(
    `SELECT o.*, m.nimi, m.foto_url, t.seaded FROM pokker_osalejad o JOIN pokker_mangijad m ON m.id=o.mangija_id
     JOIN pokker_turniirid t ON t.id=o.turniir_id
     WHERE t.hooaeg_id=$1 AND t.punktiturniir=true AND t.staatus IN ('lopetatud','kinnitatud')`, [hooaegId]
  );
  const kor = await pool.query(
    `SELECT k.mangija_id, m.nimi, m.foto_url, SUM(k.punktid) AS punktid, SUM(k.turniire)::int AS turniire, SUM(k.voite)::int AS voite
     FROM pokker_korrektsioonid k JOIN pokker_mangijad m ON m.id=k.mangija_id WHERE k.hooaeg_id=$1 GROUP BY k.mangija_id, m.nimi, m.foto_url`, [hooaegId]
  );
  const m = {};
  const rida = (id, nimi, foto) => m[id] || (m[id] = { mangija_id: id, nimi, foto_url: foto, list: [], tulemused: {}, korrektsioon: 0, kor_turniire: 0, kor_voite: 0 });
  o.rows.forEach(x => {
    const r = rida(x.mangija_id, x.nimi, x.foto_url);
    const y = { koht: x.koht, punktid: nr(x.punktid), rebuyd: x.rebuyd, reentryd: x.reentryd, addonid: x.addonid,
      bounty_arv: x.bounty_arv, bounty_eur: nr(x.bounty_eur), auhind: nr(x.auhind), kulu: mangijaKulu(x, puhastaSeaded(x.seaded)) };
    r.list.push(y);
    r.tulemused[x.turniir_id] = { koht: x.koht, punktid: y.punktid };
  });
  kor.rows.forEach(k => { const r = rida(k.mangija_id, k.nimi, k.foto_url); r.korrektsioon = nr(k.punktid); r.kor_turniire = k.turniire; r.kor_voite = k.voite; });
  const read = Object.values(m).map(r => {
    const st = koondStatistika(r.list);
    return Object.assign({ mangija_id: r.mangija_id, nimi: r.nimi, foto_url: r.foto_url, tulemused: r.tulemused, korrektsioon: r.korrektsioon }, st, {
      punktid: r2(st.punktid + r.korrektsioon), turniire: st.turniire + r.kor_turniire, voite: st.voite + r.kor_voite
    });
  });
  read.sort((a, b) => b.punktid - a.punktid || b.voite - a.voite || b.top3 - a.top3 || (a.keskmine_koht || 99) - (b.keskmine_koht || 99) || a.nimi.localeCompare(b.nimi, 'et'));
  let eelmine = null, koht = 0;
  read.forEach((r, i) => { if (eelmine === null || r.punktid !== eelmine) koht = i + 1; r.koht = koht; eelmine = r.punktid; });
  return { turniirid, read };
}
router.get('/edetabel', noudaVaatajat, async (req, res) => {
  let id = ts(req.query.hooaeg_id, 0);
  if (!id) {
    const h = await pool.query(`SELECT id FROM pokker_hooajad ORDER BY lopetatud, algus DESC LIMIT 1`);
    if (!h.rows.length) return res.json({ ok: true, hooaeg: null, turniirid: [], read: [] });
    id = h.rows[0].id;
  }
  const h = await pool.query(`SELECT * FROM pokker_hooajad WHERE id=$1`, [id]);
  if (!h.rows.length) return res.json({ ok: false, veateade: 'Hooaega ei leitud' });
  const hooaeg = Object.assign({}, h.rows[0], { algus: kpStr(h.rows[0].algus), lopp: kpStr(h.rows[0].lopp) });
  res.json(Object.assign({ ok: true, hooaeg }, await edetabel(id)));
});

// Kõikide aegade edetabel + kuulsuste hall + üldstatistika
router.get('/statistika', noudaVaatajat, async (req, res) => {
  const o = await pool.query(
    `SELECT o.*, m.nimi, m.foto_url, t.seaded, t.formaadi_nimi FROM pokker_osalejad o JOIN pokker_mangijad m ON m.id=o.mangija_id
     JOIN pokker_turniirid t ON t.id=o.turniir_id WHERE t.staatus IN ('lopetatud','kinnitatud')`
  );
  const kor = await pool.query(`SELECT mangija_id, SUM(punktid) AS p, SUM(turniire)::int AS t, SUM(voite)::int AS v FROM pokker_korrektsioonid GROUP BY mangija_id`);
  const mm = await pool.query(`SELECT id, nimi, foto_url FROM pokker_mangijad`);
  const m = {};
  mm.rows.forEach(x => { m[x.id] = { mangija_id: x.id, nimi: x.nimi, foto_url: x.foto_url, list: [], kor: 0, kt: 0, kv: 0 }; });
  o.rows.forEach(x => {
    m[x.mangija_id].list.push({ koht: x.koht, punktid: nr(x.punktid), rebuyd: x.rebuyd, reentryd: x.reentryd, addonid: x.addonid,
      bounty_arv: x.bounty_arv, bounty_eur: nr(x.bounty_eur), auhind: nr(x.auhind), kulu: mangijaKulu(x, puhastaSeaded(x.seaded)) });
  });
  kor.rows.forEach(k => { if (m[k.mangija_id]) { m[k.mangija_id].kor = nr(k.p); m[k.mangija_id].kt = k.t; m[k.mangija_id].kv = k.v; } });
  const koikAjad = Object.values(m).map(x => {
    const st = koondStatistika(x.list);
    return Object.assign({ mangija_id: x.mangija_id, nimi: x.nimi, foto_url: x.foto_url }, st,
      { punktid: r2(st.punktid + x.kor), turniire: st.turniire + x.kt, voite: st.voite + x.kv });
  }).filter(x => x.turniire > 0 || x.punktid > 0).sort((a, b) => b.punktid - a.punktid || b.voite - a.voite);
  koikAjad.forEach((r, i) => { r.koht = i + 1; });
  // Kuulsuste hall: lõpetatud hooaegade võitjad
  const hooajad = await pool.query(`SELECT id, nimi, algus, lopp, lopetatud FROM pokker_hooajad ORDER BY algus DESC`);
  const hall = [];
  for (const h of hooajad.rows) {
    const et = await edetabel(h.id);
    hall.push({ hooaeg_id: h.id, nimi: h.nimi, lopetatud: h.lopetatud, top3: et.read.slice(0, 3).map(r => ({ nimi: r.nimi, punktid: r.punktid, foto_url: r.foto_url, mangija_id: r.mangija_id })) });
  }
  const t = await pool.query(`SELECT * FROM pokker_turniirid WHERE staatus IN ('lopetatud','kinnitatud')`);
  let suurimFond = null, koguFond = 0, osavotte = 0;
  const formaadid = {};
  for (const tr of t.rows) {
    tr.seaded = puhastaSeaded(tr.seaded);
    const os = o.rows.filter(x => x.turniir_id === tr.id);
    const s = turniiriSummad(tr, os);
    koguFond += s.auhinnafond; osavotte += os.length;
    if (!suurimFond || s.auhinnafond > suurimFond.summa) suurimFond = { summa: s.auhinnafond, nimi: tr.nimi, kuupaev: kpStr(tr.kuupaev), id: tr.id };
    const f = tr.formaadi_nimi || '—';
    formaadid[f] = formaadid[f] || { formaat: f, turniire: 0, osalejaid: 0, fond: 0 };
    formaadid[f].turniire++; formaadid[f].osalejaid += os.length; formaadid[f].fond += s.auhinnafond;
  }
  const rekord = (vali) => koikAjad.slice().sort((a, b) => b[vali] - a[vali])[0] || null;
  const algus = await pool.query(`SELECT MIN(kuupaev) AS k FROM pokker_turniirid WHERE staatus IN ('lopetatud','kinnitatud')`);
  res.json({
    ok: true, koik_ajad: koikAjad, hall,
    kokku: { turniire: t.rows.length, osavotte, keskmiselt: t.rows.length ? Math.round(osavotte / t.rows.length * 10) / 10 : 0,
      koguFond: r2(koguFond), suurimFond, esimene: kpStr(algus.rows[0].k), asutatud: 2015, aastaid: new Date().getFullYear() - 2015 },
    formaadid: Object.values(formaadid).map(f => Object.assign(f, { fond: r2(f.fond), keskmiselt: Math.round(f.osalejaid / f.turniire * 10) / 10 })),
    rekordid: {
      voite: rekord('voite'), rebuyd: rekord('rebuyd'), reentryd: rekord('reentryd'), bounty: rekord('bounty_arv'), turniire: rekord('turniire'), saldo: rekord('saldo')
    }
  });
});

// ── HOOAJAD ───────────────────────────────────────────────────────────────
router.get('/hooajad', noudaVaatajat, async (req, res) => {
  const r = await pool.query(
    `SELECT h.*, (SELECT COUNT(*)::int FROM pokker_turniirid t WHERE t.hooaeg_id=h.id AND t.staatus IN ('lopetatud','kinnitatud')) AS turniire
     FROM pokker_hooajad h ORDER BY h.algus DESC`
  );
  const kor = await pool.query(
    `SELECT k.*, m.nimi FROM pokker_korrektsioonid k JOIN pokker_mangijad m ON m.id=k.mangija_id ORDER BY k.hooaeg_id, k.punktid DESC`
  );
  res.json({ ok: true, hooajad: r.rows.map(h => Object.assign({}, h, {
    algus: kpStr(h.algus), lopp: kpStr(h.lopp), korrektsioonid: kor.rows.filter(k => k.hooaeg_id === h.id).map(k => Object.assign({}, k, { punktid: nr(k.punktid) }))
  })) });
});
router.post('/hooajad', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi);
  if (!nimi || !onKuupaev(b.algus) || !onKuupaev(b.lopp)) return res.json({ ok: false, veateade: 'Sisesta nimi, algus- ja lõppkuupäev' });
  if (b.lopp < b.algus) return res.json({ ok: false, veateade: 'Lõpp ei saa olla enne algust' });
  const p = b.punktid ? puhastaPunktid(b.punktid) : puhastaPunktid((await pool.query(`SELECT punktid FROM pokker_seaded WHERE id=1`)).rows[0].punktid);
  const r = await pool.query(`INSERT INTO pokker_hooajad (nimi, algus, lopp, punktid) VALUES ($1,$2,$3,$4) RETURNING id`, [nimi, b.algus, b.lopp, JSON.stringify(p)]);
  res.json({ ok: true, id: r.rows[0].id });
});
router.put('/hooajad/:id', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi);
  if (!nimi || !onKuupaev(b.algus) || !onKuupaev(b.lopp)) return res.json({ ok: false, veateade: 'Sisesta nimi, algus- ja lõppkuupäev' });
  const p = puhastaPunktid(b.punktid);
  await pool.query(`UPDATE pokker_hooajad SET nimi=$1, algus=$2, lopp=$3, punktid=$4, lopetatud=$5 WHERE id=$6`,
    [nimi, b.algus, b.lopp, JSON.stringify(p), !!b.lopetatud, id]);
  // Punktisüsteemi muutus -> hooaja turniiride punktid arvutatakse ümber
  if (b.arvuta_umber) {
    const t = await pool.query(`SELECT * FROM pokker_turniirid WHERE hooaeg_id=$1 AND staatus IN ('lopetatud','kinnitatud')`, [id]);
    for (const tr of t.rows) await arvutaPunktid(tr);
  }
  res.json({ ok: true });
});
router.delete('/hooajad/:id', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const t = await pool.query(`SELECT COUNT(*)::int AS n FROM pokker_turniirid WHERE hooaeg_id=$1`, [id]);
  if (t.rows[0].n) return res.json({ ok: false, veateade: 'Hooajal on turniire — seda ei saa kustutada (saad selle lõpetada)' });
  await pool.query(`DELETE FROM pokker_hooajad WHERE id=$1`, [id]);
  res.json({ ok: true });
});
router.post('/hooajad/:id/korrektsioon', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const b = req.body || {};
  const mid = ts(b.mangija_id);
  if (!mid) return res.json({ ok: false, veateade: 'Vali mängija' });
  await pool.query(`INSERT INTO pokker_korrektsioonid (hooaeg_id, mangija_id, punktid, turniire, voite, markus) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, mid, nr(b.punktid), Math.max(0, ts(b.turniire)), Math.max(0, ts(b.voite)), puhasNimi(b.markus, 200) || null]);
  res.json({ ok: true });
});
router.put('/korrektsioonid/:id', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  await pool.query(`UPDATE pokker_korrektsioonid SET punktid=$1, turniire=$2, voite=$3, markus=$4 WHERE id=$5`,
    [nr(b.punktid), Math.max(0, ts(b.turniire)), Math.max(0, ts(b.voite)), puhasNimi(b.markus, 200) || null, ts(req.params.id)]);
  res.json({ ok: true });
});
router.delete('/korrektsioonid/:id', noudaAdmin, async (req, res) => {
  await pool.query(`DELETE FROM pokker_korrektsioonid WHERE id=$1`, [ts(req.params.id)]);
  res.json({ ok: true });
});

// ── FORMAADID ─────────────────────────────────────────────────────────────
router.get('/formaadid', noudaVaatajat, async (req, res) => {
  const r = await pool.query(`SELECT * FROM pokker_formaadid ORDER BY arhiveeritud, jrk, id`);
  res.json({ ok: true, formaadid: r.rows.map(f => Object.assign({}, f, { seaded: puhastaSeaded(f.seaded), struktuur: puhastaStruktuur(f.struktuur) })) });
});
router.post('/formaadid', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta formaadi nimi' });
  const st = puhastaStruktuur(b.struktuur);
  if (!st.length) return res.json({ ok: false, veateade: 'Blindide struktuur on tühi' });
  const j = await pool.query(`SELECT COALESCE(MAX(jrk),0)+1 AS j FROM pokker_formaadid`);
  const r = await pool.query(`INSERT INTO pokker_formaadid (nimi, seaded, struktuur, jrk) VALUES ($1,$2,$3,$4) RETURNING id`,
    [nimi, JSON.stringify(puhastaSeaded(b.seaded)), JSON.stringify(st), j.rows[0].j]);
  res.json({ ok: true, id: r.rows[0].id });
});
router.put('/formaadid/:id', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta formaadi nimi' });
  const st = puhastaStruktuur(b.struktuur);
  if (!st.length) return res.json({ ok: false, veateade: 'Blindide struktuur on tühi' });
  await pool.query(`UPDATE pokker_formaadid SET nimi=$1, seaded=$2, struktuur=$3, arhiveeritud=$4 WHERE id=$5`,
    [nimi, JSON.stringify(puhastaSeaded(b.seaded)), JSON.stringify(st), !!b.arhiveeritud, ts(req.params.id)]);
  res.json({ ok: true });
});
router.post('/formaadid/:id/kopeeri', noudaAdmin, async (req, res) => {
  const f = await pool.query(`SELECT * FROM pokker_formaadid WHERE id=$1`, [ts(req.params.id)]);
  if (!f.rows.length) return res.json({ ok: false, veateade: 'Formaati ei leitud' });
  const j = await pool.query(`SELECT COALESCE(MAX(jrk),0)+1 AS j FROM pokker_formaadid`);
  const r = await pool.query(`INSERT INTO pokker_formaadid (nimi, seaded, struktuur, jrk) VALUES ($1,$2,$3,$4) RETURNING id`,
    [(f.rows[0].nimi + ' (koopia)').slice(0, 100), JSON.stringify(f.rows[0].seaded), JSON.stringify(f.rows[0].struktuur), j.rows[0].j]);
  res.json({ ok: true, id: r.rows[0].id });
});

// ── TURNIIRID ─────────────────────────────────────────────────────────────
router.get('/turniirid', noudaVaatajat, async (req, res) => {
  const tingimused = [], v = [];
  if (ts(req.query.hooaeg_id)) { v.push(ts(req.query.hooaeg_id)); tingimused.push(`t.hooaeg_id=$${v.length}`); }
  if (req.query.formaat) { v.push(String(req.query.formaat)); tingimused.push(`t.formaadi_nimi=$${v.length}`); }
  if (req.query.staatus === 'lopetatud') tingimused.push(`t.staatus IN ('lopetatud','kinnitatud')`);
  if (req.query.staatus === 'aktiivsed') tingimused.push(`t.staatus IN ('ootel','kaib')`);
  const r = await pool.query(
    `SELECT t.id, t.nimi, t.kuupaev, t.formaadi_nimi, t.staatus, t.punktiturniir, t.ajalooline, t.hooaeg_id, h.nimi AS hooaja_nimi, t.seaded,
       (SELECT COUNT(*)::int FROM pokker_osalejad o WHERE o.turniir_id=t.id) AS osalejaid,
       (SELECT COALESCE(SUM(o.rebuyd),0)::int FROM pokker_osalejad o WHERE o.turniir_id=t.id) AS rebuyd,
       (SELECT COALESCE(SUM(o.reentryd),0)::int FROM pokker_osalejad o WHERE o.turniir_id=t.id) AS reentryd,
       (SELECT COALESCE(SUM(o.addonid),0)::int FROM pokker_osalejad o WHERE o.turniir_id=t.id) AS addonid,
       (SELECT m.nimi FROM pokker_osalejad o JOIN pokker_mangijad m ON m.id=o.mangija_id WHERE o.turniir_id=t.id AND o.koht=1 LIMIT 1) AS voitja
     FROM pokker_turniirid t LEFT JOIN pokker_hooajad h ON h.id=t.hooaeg_id
     ${tingimused.length ? 'WHERE ' + tingimused.join(' AND ') : ''}
     ORDER BY t.kuupaev DESC, t.id DESC`, v
  );
  res.json({ ok: true, turniirid: r.rows.map(t => {
    const s = puhastaSeaded(t.seaded);
    const n = t.osalejaid;
    const fond = r2(n * s.buyin + t.rebuyd * s.rebuy_summa + t.reentryd * s.reentry_summa + t.addonid * s.addon_summa);
    const x = Object.assign({}, t, { kuupaev: kpStr(t.kuupaev), auhinnafond: fond, bountyfond: r2((n + t.reentryd) * s.bounty) });
    delete x.seaded;
    return x;
  }) });
});
router.get('/turniirid/:id', noudaVaatajat, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const info = await turniiriTaisinfo(t, Date.now());
  if (req.pokkerRoll === 'admin') {
    const g = await pool.query(`SELECT * FROM pokker_tegevused WHERE turniir_id=$1 ORDER BY id DESC LIMIT 30`, [t.id]);
    info.tegevused = g.rows;
  }
  res.json(Object.assign({ ok: true }, info));
});
router.post('/turniirid', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi, 150);
  if (!nimi) return res.json({ ok: false, veateade: 'Sisesta turniiri nimi' });
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  let formaat = null;
  if (ts(b.formaat_id)) formaat = (await pool.query(`SELECT * FROM pokker_formaadid WHERE id=$1`, [ts(b.formaat_id)])).rows[0] || null;
  const seaded = puhastaSeaded(b.seaded || (formaat && formaat.seaded));
  const struktuur = puhastaStruktuur(b.struktuur || (formaat && formaat.struktuur));
  if (!struktuur.length) return res.json({ ok: false, veateade: 'Blindide struktuur puudub' });
  const punktiturniir = b.punktiturniir !== false;
  let hooaegId = ts(b.hooaeg_id) || null;
  if (punktiturniir && !hooaegId) hooaegId = await leiaHooaegKuupaevaks(b.kuupaev);
  const r = await pool.query(
    `INSERT INTO pokker_turniirid (nimi, kuupaev, formaat_id, formaadi_nimi, seaded, struktuur, hooaeg_id, punktiturniir, kell, markus)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [nimi, b.kuupaev, formaat ? formaat.id : null, formaat ? formaat.nimi : 'Kohandatud', JSON.stringify(seaded), JSON.stringify(struktuur),
     hooaegId, punktiturniir, JSON.stringify(algKell(struktuur, seaded)), puhasNimi(b.markus, 500) || null]
  );
  const id = r.rows[0].id;
  const mangijad = Array.isArray(b.mangijad) ? b.mangijad.map(x => ts(x)).filter(Boolean) : [];
  for (const mid of mangijad) {
    await pool.query(`INSERT INTO pokker_osalejad (turniir_id, mangija_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, mid]);
  }
  res.json({ ok: true, id });
});
// Turniiri üldandmete ja seadete muutmine (ka käimasoleval turniiril, nt blindide parandus)
router.put('/turniirid/:id', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi, 150) || t.nimi;
  const kp = onKuupaev(b.kuupaev) ? b.kuupaev : kpStr(t.kuupaev);
  const seaded = b.seaded ? puhastaSeaded(b.seaded) : t.seaded;
  const struktuur = b.struktuur ? puhastaStruktuur(b.struktuur) : t.struktuur;
  if (!struktuur.length) return res.json({ ok: false, veateade: 'Blindide struktuur on tühi' });
  const punktiturniir = b.punktiturniir === undefined ? t.punktiturniir : !!b.punktiturniir;
  let hooaegId = b.hooaeg_id === undefined ? t.hooaeg_id : (ts(b.hooaeg_id) || null);
  if (punktiturniir && !hooaegId) hooaegId = await leiaHooaegKuupaevaks(kp);
  // Kell: kui struktuur lühenes, hoiame indeksi piires; ootel turniiril võtame uue algkella.
  let kell = normaliseeri(t.kell, struktuur, seaded, Date.now());
  if (t.staatus === 'ootel' && !kell.jookseb && kell.idx === 0) kell = algKell(struktuur, seaded);
  await pool.query(
    `UPDATE pokker_turniirid SET nimi=$1, kuupaev=$2, seaded=$3, struktuur=$4, punktiturniir=$5, hooaeg_id=$6, markus=$7, kell=$8 WHERE id=$9`,
    [nimi, kp, JSON.stringify(seaded), JSON.stringify(struktuur), punktiturniir, hooaegId,
     b.markus === undefined ? t.markus : (puhasNimi(b.markus, 500) || null), JSON.stringify(kell), t.id]
  );
  const uus = await laeTurniir(t.id);
  if (['lopetatud', 'kinnitatud'].includes(uus.staatus)) await arvutaPunktid(uus);
  res.json({ ok: true });
});
router.delete('/turniirid/:id', noudaAdmin, async (req, res) => {
  await pool.query(`DELETE FROM pokker_turniirid WHERE id=$1`, [ts(req.params.id)]);
  res.json({ ok: true });
});

// Kella juhtimine
router.post('/turniirid/:id/kell', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  if (['lopetatud', 'kinnitatud'].includes(t.staatus)) return res.json({ ok: false, veateade: 'Turniir on lõppenud' });
  const nuud = Date.now();
  const st = t.struktuur, s = t.seaded;
  const k = normaliseeri(t.kell, st, s, nuud);
  const tegevus = String(req.body.tegevus || '');
  const sek = nr(req.body.sekundid);
  switch (tegevus) {
    case 'start':
    case 'jatka':
      if (!k.jookseb) { k.lopp = nuud + Math.max(k.jaak || 0, 1000); k.jookseb = true; }
      if (t.staatus === 'ootel') await pool.query(`UPDATE pokker_turniirid SET staatus='kaib', alustatud=COALESCE(alustatud, NOW()) WHERE id=$1`, [t.id]);
      break;
    case 'peata':
      if (k.jookseb) { k.jaak = Math.max(0, k.lopp - nuud); k.jookseb = false; k.lopp = null; }
      break;
    case 'jargmine':
      if (k.idx < st.length - 1) { k.idx++; seaJaak(k, kestus(st[k.idx], s), nuud); }
      break;
    case 'eelmine':
      if (k.idx > 0) { k.idx--; seaJaak(k, kestus(st[k.idx], s), nuud); }
      break;
    case 'level_algusesse':
      seaJaak(k, kestus(st[k.idx], s), nuud);
      break;
    case 'lisa':
      seaJaak(k, Math.max(0, jaak(k, nuud) + sek * 1000), nuud);
      break;
    case 'kaivita_paus': {
      // Kui praegu käib level, lisatakse kohe uus paus (pikkus formaadi järgi) ja hüpatakse sinna.
      if (st[k.idx] && st[k.idx].paus) break;
      const pikkus = Math.max(1, nr(req.body.minutid) || s.pausi_min);
      // Pooleli jäänud leveli aeg jääb alles: level jätkub pärast pausi sealt, kus see pooleli jäi.
      const jaanud = jaak(k, nuud);
      const praegune = Object.assign({}, st[k.idx]);
      st.splice(k.idx + 1, 0, { paus: true, addon: false, min: pikkus }, Object.assign({}, praegune, { jatk: true, min: Math.max(0.5, Math.round(jaanud / 600) / 100) }));
      st[k.idx] = Object.assign({}, praegune, { min: Math.max(0.5, nr(praegune.min || s.leveli_min) - jaanud / 60000) });
      k.idx++;
      seaJaak(k, kestus(st[k.idx], s), nuud);
      await pool.query(`UPDATE pokker_turniirid SET struktuur=$1 WHERE id=$2`, [JSON.stringify(st), t.id]);
      break;
    }
    case 'lopeta_paus':
      if (st[k.idx] && st[k.idx].paus && k.idx < st.length - 1) { k.idx++; seaJaak(k, kestus(st[k.idx], s), nuud); }
      break;
    case 'mine':
      { const i = ts(req.body.idx, -1); if (i >= 0 && i < st.length) { k.idx = i; seaJaak(k, kestus(st[i], s), nuud); } }
      break;
    case 'lahtesta':
      Object.assign(k, algKell(st, s));
      break;
    default:
      return res.json({ ok: false, veateade: 'Tundmatu tegevus' });
  }
  await salvestaKell(t, k);
  res.json({ ok: true });
});
// Käimasoleva leveli blindide muutmine otse juhtpuldist
router.put('/turniirid/:id/level/:idx', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const i = ts(req.params.idx, -1);
  if (i < 0 || i >= t.struktuur.length) return res.json({ ok: false, veateade: 'Levelit ei leitud' });
  const uus = puhastaStruktuur([Object.assign({}, t.struktuur[i], req.body || {})])[0];
  t.struktuur[i] = uus;
  await pool.query(`UPDATE pokker_turniirid SET struktuur=$1 WHERE id=$2`, [JSON.stringify(t.struktuur), t.id]);
  res.json({ ok: true });
});

// Osalejad
router.post('/turniirid/:id/osalejad', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  let mid = ts(req.body.mangija_id);
  const uusNimi = puhasNimi(req.body.uus_nimi);
  if (!mid && uusNimi) {
    const olemas = await pool.query(`SELECT id FROM pokker_mangijad WHERE LOWER(nimi)=LOWER($1)`, [uusNimi]);
    mid = olemas.rows[0] ? olemas.rows[0].id : (await pool.query(`INSERT INTO pokker_mangijad (nimi) VALUES ($1) RETURNING id`, [uusNimi])).rows[0].id;
  }
  if (!mid) return res.json({ ok: false, veateade: 'Vali mängija' });
  const r = await pool.query(`INSERT INTO pokker_osalejad (turniir_id, mangija_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [t.id, mid]);
  if (!r.rows.length) return res.json({ ok: false, veateade: 'Mängija on juba registreeritud' });
  await logi(t.id, 'registreeri', { osaleja: r.rows[0].id });
  res.json({ ok: true, id: r.rows[0].id });
});
router.delete('/osalejad/:id', noudaAdmin, async (req, res) => {
  const o = await pool.query(`SELECT turniir_id FROM pokker_osalejad WHERE id=$1`, [ts(req.params.id)]);
  if (!o.rows.length) return res.json({ ok: false, veateade: 'Ei leitud' });
  // Kui eemaldatav oli kellegi välja löönud, tema bounty jääb alles (parandatakse vajadusel käsitsi).
  await pool.query(`DELETE FROM pokker_osalejad WHERE id=$1`, [ts(req.params.id)]);
  await pool.query(`UPDATE pokker_osalejad SET valja_loi=NULL WHERE valja_loi=$1`, [ts(req.params.id)]);
  res.json({ ok: true });
});
// Mängija tegevus: rebuy / reentry / addon / valja / taasta
router.post('/osalejad/:id/tegevus', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const o = (await pool.query(`SELECT * FROM pokker_osalejad WHERE id=$1`, [id])).rows[0];
  if (!o) return res.json({ ok: false, veateade: 'Osalejat ei leitud' });
  const t = await laeTurniir(o.turniir_id);
  const s = t.seaded;
  const tyyp = String(req.body.tyyp || '');
  const loi = ts(req.body.loi) || null;
  if (loi === id) return res.json({ ok: false, veateade: 'Mängija ei saa ennast ise välja lüüa' });
  const bountyLoojale = async (maar) => {
    if (!loi || !s.bounty) return false;
    await pool.query(`UPDATE pokker_osalejad SET bounty_arv=bounty_arv+$1, bounty_eur=bounty_eur+$2 WHERE id=$3 AND turniir_id=$4`, [maar, maar * s.bounty, loi, t.id]);
    return true;
  };
  if (tyyp === 'rebuy') {
    await pool.query(`UPDATE pokker_osalejad SET rebuyd=rebuyd+1 WHERE id=$1`, [id]);
    await logi(t.id, 'rebuy', { osaleja: id });
  } else if (tyyp === 'addon') {
    await pool.query(`UPDATE pokker_osalejad SET addonid=addonid+1 WHERE id=$1`, [id]);
    await logi(t.id, 'addon', { osaleja: id });
  } else if (tyyp === 'reentry') {
    // Mängija kaotas žetoonid ja ostab uuesti sisse. Kui ta oli juba välja märgitud, tuuakse tagasi mängu.
    await pool.query(`UPDATE pokker_osalejad SET reentryd=reentryd+1, valjas=false, valja_jrk=NULL, valja_loi=NULL, koht=NULL WHERE id=$1`, [id]);
    const b = await bountyLoojale(1);
    await logi(t.id, 'reentry', { osaleja: id, loi, bounty: b, oli_valjas: o.valjas, vana_jrk: o.valja_jrk, vana_loi: o.valja_loi });
  } else if (tyyp === 'valja') {
    if (o.valjas) return res.json({ ok: false, veateade: 'Mängija on juba väljas' });
    const j = await pool.query(`SELECT COALESCE(MAX(valja_jrk),0)+1 AS j FROM pokker_osalejad WHERE turniir_id=$1`, [t.id]);
    await pool.query(`UPDATE pokker_osalejad SET valjas=true, valja_jrk=$1, valja_loi=$2 WHERE id=$3`, [j.rows[0].j, loi, id]);
    const b = await bountyLoojale(1);
    await logi(t.id, 'valja', { osaleja: id, loi, bounty: b });
  } else if (tyyp === 'taasta') {
    if (!o.valjas) return res.json({ ok: false, veateade: 'Mängija on juba mängus' });
    // Kui väljalöömise eest anti bounty, võetakse see tagasi.
    if (o.valja_loi && s.bounty) {
      await pool.query(`UPDATE pokker_osalejad SET bounty_arv=GREATEST(0,bounty_arv-1), bounty_eur=GREATEST(0,bounty_eur-$1) WHERE id=$2`, [s.bounty, o.valja_loi]);
    }
    await pool.query(`UPDATE pokker_osalejad SET valjas=false, valja_jrk=NULL, valja_loi=NULL, koht=NULL WHERE id=$1`, [id]);
    await logi(t.id, 'taasta', { osaleja: id, vana_jrk: o.valja_jrk, vana_loi: o.valja_loi, bounty: !!(o.valja_loi && s.bounty) });
  } else {
    return res.json({ ok: false, veateade: 'Tundmatu tegevus' });
  }
  res.json({ ok: true });
});
// Viimase tegevuse tagasivõtmine
router.post('/turniirid/:id/tagasi', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const g = (await pool.query(`SELECT * FROM pokker_tegevused WHERE turniir_id=$1 AND tagasi=false ORDER BY id DESC LIMIT 1`, [t.id])).rows[0];
  if (!g) return res.json({ ok: false, veateade: 'Pole midagi tagasi võtta' });
  const a = g.andmed || {};
  const s = t.seaded;
  const o = (await pool.query(`SELECT * FROM pokker_osalejad WHERE id=$1`, [a.osaleja])).rows[0];
  const bountyTagasi = async (loi) => {
    if (loi) await pool.query(`UPDATE pokker_osalejad SET bounty_arv=GREATEST(0,bounty_arv-1), bounty_eur=GREATEST(0,bounty_eur-$1) WHERE id=$2`, [s.bounty, loi]);
  };
  let kirjeldus = '';
  if (o) {
    if (g.tyyp === 'rebuy') { await pool.query(`UPDATE pokker_osalejad SET rebuyd=GREATEST(0,rebuyd-1) WHERE id=$1`, [o.id]); kirjeldus = 'rebuy'; }
    if (g.tyyp === 'addon') { await pool.query(`UPDATE pokker_osalejad SET addonid=GREATEST(0,addonid-1) WHERE id=$1`, [o.id]); kirjeldus = 'add-on'; }
    if (g.tyyp === 'reentry') {
      await pool.query(`UPDATE pokker_osalejad SET reentryd=GREATEST(0,reentryd-1) WHERE id=$1`, [o.id]);
      if (a.oli_valjas) await pool.query(`UPDATE pokker_osalejad SET valjas=true, valja_jrk=$1, valja_loi=$2 WHERE id=$3`, [a.vana_jrk, a.vana_loi, o.id]);
      if (a.bounty) await bountyTagasi(a.loi);
      kirjeldus = 're-entry';
    }
    if (g.tyyp === 'valja') {
      await pool.query(`UPDATE pokker_osalejad SET valjas=false, valja_jrk=NULL, valja_loi=NULL, koht=NULL WHERE id=$1`, [o.id]);
      if (a.bounty) await bountyTagasi(a.loi);
      kirjeldus = 'väljalangemine';
    }
    if (g.tyyp === 'taasta') {
      await pool.query(`UPDATE pokker_osalejad SET valjas=true, valja_jrk=$1, valja_loi=$2 WHERE id=$3`, [a.vana_jrk, a.vana_loi, o.id]);
      if (a.bounty && a.vana_loi) await pool.query(`UPDATE pokker_osalejad SET bounty_arv=bounty_arv+1, bounty_eur=bounty_eur+$1 WHERE id=$2`, [s.bounty, a.vana_loi]);
      kirjeldus = 'taastamine';
    }
    if (g.tyyp === 'registreeri') {
      await pool.query(`DELETE FROM pokker_osalejad WHERE id=$1`, [o.id]);
      kirjeldus = 'registreerimine';
    }
  }
  await pool.query(`UPDATE pokker_tegevused SET tagasi=true WHERE id=$1`, [g.id]);
  res.json({ ok: true, kirjeldus: (o ? o.id : '') && kirjeldus });
});
// Käsitsi parandus (loendurid, bounty, auhind, koht, makstud)
router.put('/osalejad/:id', noudaAdmin, async (req, res) => {
  const id = ts(req.params.id);
  const o = (await pool.query(`SELECT * FROM pokker_osalejad WHERE id=$1`, [id])).rows[0];
  if (!o) return res.json({ ok: false, veateade: 'Osalejat ei leitud' });
  const b = req.body || {};
  const v = (k, f) => b[k] === undefined ? o[k] : f(b[k]);
  await pool.query(
    `UPDATE pokker_osalejad SET rebuyd=$1, reentryd=$2, addonid=$3, bounty_arv=$4, bounty_eur=$5, auhind=$6, koht=$7, makstud=$8 WHERE id=$9`,
    [v('rebuyd', x => Math.max(0, ts(x))), v('reentryd', x => Math.max(0, ts(x))), v('addonid', x => Math.max(0, ts(x))),
     v('bounty_arv', x => Math.max(0, ts(x))), v('bounty_eur', x => Math.max(0, nr(x))), v('auhind', x => Math.max(0, nr(x))),
     v('koht', x => ts(x) || null), v('makstud', x => !!x), id]
  );
  const t = await laeTurniir(o.turniir_id);
  if (['lopetatud', 'kinnitatud'].includes(t.staatus) && b.koht !== undefined) await arvutaPunktid(t);
  res.json({ ok: true });
});
// Turniiri lõpetamine: kell seisma, kohad paika
router.post('/turniirid/:id/lopeta', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const nuud = Date.now();
  const k = normaliseeri(t.kell, t.struktuur, t.seaded, nuud);
  if (k.jookseb) { k.jaak = Math.max(0, k.lopp - nuud); k.jookseb = false; k.lopp = null; }
  await pool.query(`UPDATE pokker_turniirid SET staatus='lopetatud', lopetatud=NOW(), kell=$1 WHERE id=$2`, [JSON.stringify(k), t.id]);
  await maaraKohad(t);
  t.staatus = 'lopetatud';
  await arvutaPunktid(t);
  res.json({ ok: true });
});
// Lõpetatud turniiri taasavamine (nt kogemata lõpetatud)
router.post('/turniirid/:id/taasava', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  await pool.query(`UPDATE pokker_turniirid SET staatus='kaib', lopetatud=NULL WHERE id=$1`, [t.id]);
  await pool.query(`UPDATE pokker_osalejad SET koht=NULL, punktid=0 WHERE turniir_id=$1`, [t.id]);
  res.json({ ok: true });
});
// Tulemuste kinnitamine: punktid lõplikult hooaja arvestusse
router.post('/turniirid/:id/kinnita', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  if (t.staatus !== 'lopetatud' && t.staatus !== 'kinnitatud') return res.json({ ok: false, veateade: 'Lõpeta enne turniir' });
  await pool.query(`UPDATE pokker_turniirid SET staatus='kinnitatud' WHERE id=$1`, [t.id]);
  t.staatus = 'kinnitatud';
  await arvutaPunktid(t);
  res.json({ ok: true });
});
// Auhinnafondi jagamine seadetes olevate protsentide järgi (ümardatakse täiseurodeni, jääk võitjale)
router.post('/turniirid/:id/jaota-auhinnad', noudaAdmin, async (req, res) => {
  const t = await laeTurniir(ts(req.params.id));
  if (!t) return res.json({ ok: false, veateade: 'Turniiri ei leitud' });
  const os = await laeOsalejad(t.id);
  const fond = turniiriSummad(t, os).auhinnafond;
  let jaotus = Array.isArray(req.body.jaotus) ? req.body.jaotus.map(x => Math.max(0, nr(x))) : null;
  if (!jaotus) jaotus = (await pool.query(`SELECT auhinnajaotus FROM pokker_seaded WHERE id=1`)).rows[0].auhinnajaotus || VAIKE_JAOTUS;
  const summad = jaotus.map(p => Math.floor(fond * p / 100));
  const jaak2 = r2(fond * jaotus.reduce((a, p) => a + p, 0) / 100 - summad.reduce((a, x) => a + x, 0));
  if (summad.length) summad[0] = r2(summad[0] + jaak2);
  await pool.query(`UPDATE pokker_osalejad SET auhind=0 WHERE turniir_id=$1`, [t.id]);
  for (const o of os) {
    if (o.koht && o.koht <= summad.length) await pool.query(`UPDATE pokker_osalejad SET auhind=$1 WHERE id=$2`, [summad[o.koht - 1], o.id]);
  }
  res.json({ ok: true, summad });
});

// Varasema (ajaloolise) turniiri käsitsi lisamine — kohe lõpetatud, punktid arvutatakse kohtade järgi
router.post('/turniirid/ajalooline', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const nimi = puhasNimi(b.nimi, 150) || 'Turniir';
  if (!onKuupaev(b.kuupaev)) return res.json({ ok: false, veateade: 'Vali kuupäev' });
  const read = Array.isArray(b.osalejad) ? b.osalejad : [];
  if (!read.length) return res.json({ ok: false, veateade: 'Lisa vähemalt üks mängija' });
  let formaat = null;
  if (ts(b.formaat_id)) formaat = (await pool.query(`SELECT * FROM pokker_formaadid WHERE id=$1`, [ts(b.formaat_id)])).rows[0] || null;
  const seaded = puhastaSeaded(formaat ? formaat.seaded : b.seaded);
  const struktuur = puhastaStruktuur(formaat ? formaat.struktuur : [{ sb: 25, bb: 50 }]);
  const punktiturniir = b.punktiturniir !== false;
  let hooaegId = ts(b.hooaeg_id) || null;
  if (punktiturniir && !hooaegId) hooaegId = await leiaHooaegKuupaevaks(b.kuupaev);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO pokker_turniirid (nimi, kuupaev, formaat_id, formaadi_nimi, seaded, struktuur, hooaeg_id, punktiturniir, staatus, ajalooline, lopetatud, markus)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,'kinnitatud',true,$2::date::timestamp,$9) RETURNING id`,
      [nimi, b.kuupaev, formaat ? formaat.id : null, formaat ? formaat.nimi : (puhasNimi(b.formaadi_nimi) || 'Muu'),
       JSON.stringify(seaded), JSON.stringify(struktuur), hooaegId, punktiturniir, puhasNimi(b.markus, 500) || null]
    );
    const tid = r.rows[0].id;
    const nahtud = new Set();
    for (const x of read) {
      let mid = ts(x.mangija_id);
      const nm = puhasNimi(x.nimi);
      if (!mid && nm) {
        const ol = await client.query(`SELECT id FROM pokker_mangijad WHERE LOWER(nimi)=LOWER($1)`, [nm]);
        mid = ol.rows[0] ? ol.rows[0].id : (await client.query(`INSERT INTO pokker_mangijad (nimi) VALUES ($1) RETURNING id`, [nm])).rows[0].id;
      }
      if (!mid || nahtud.has(mid)) continue;
      nahtud.add(mid);
      await client.query(
        `INSERT INTO pokker_osalejad (turniir_id, mangija_id, koht, rebuyd, reentryd, addonid, bounty_arv, bounty_eur, auhind, valjas, makstud)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
        [tid, mid, ts(x.koht) || null, Math.max(0, ts(x.rebuyd)), Math.max(0, ts(x.reentryd)), Math.max(0, ts(x.addonid)),
         Math.max(0, ts(x.bounty_arv)), Math.max(0, ts(x.bounty_arv)) * seaded.bounty, Math.max(0, nr(x.auhind)), ts(x.koht) !== 1]
      );
    }
    await client.query('COMMIT');
    const t = await laeTurniir(tid);
    await arvutaPunktid(t);
    res.json({ ok: true, id: tid });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ── SEADED ────────────────────────────────────────────────────────────────
router.get('/seaded', noudaAdmin, async (req, res) => {
  const s = (await pool.query(`SELECT * FROM pokker_seaded WHERE id=1`)).rows[0];
  res.json({ ok: true, seaded: {
    klubi_pin: s.klubi_pin || '', admin_pin: s.admin_pin || '', tv_voti: s.tv_voti,
    punktid: puhastaPunktid(s.punktid), auhinnajaotus: s.auhinnajaotus || VAIKE_JAOTUS, helid: s.helid,
    royal_admin: !!(req.session && req.session.isAdmin)
  } });
});
router.put('/seaded', noudaAdmin, async (req, res) => {
  const b = req.body || {};
  const vana = (await pool.query(`SELECT * FROM pokker_seaded WHERE id=1`)).rows[0];
  const klubi = String(b.klubi_pin == null ? '' : b.klubi_pin).trim();
  const admin = String(b.admin_pin == null ? '' : b.admin_pin).trim();
  for (const p of [klubi, admin]) if (p && (p.length < 4 || p.length > 20)) return res.json({ ok: false, veateade: 'PIN peab olema 4–20 märki' });
  if (klubi && admin && klubi === admin) return res.json({ ok: false, veateade: 'Klubi-PIN ja admin-PIN peavad olema erinevad' });
  // Pokkeri admin ei saa admin-PIN-i tühjaks teha (muidu lukustaks ennast välja); Royali admin saab.
  if (!admin && !(req.session && req.session.isAdmin)) return res.json({ ok: false, veateade: 'Admin-PIN ei saa olla tühi' });
  const jaotus = Array.isArray(b.auhinnajaotus) ? b.auhinnajaotus.map(x => Math.max(0, nr(x))).filter(x => x > 0).slice(0, 20) : VAIKE_JAOTUS;
  await pool.query(`UPDATE pokker_seaded SET klubi_pin=$1, admin_pin=$2, punktid=$3, auhinnajaotus=$4, helid=$5 WHERE id=1`,
    [klubi || null, admin || null, JSON.stringify(puhastaPunktid(b.punktid)), JSON.stringify(jaotus), b.helid !== false]);
  // PIN-i vahetus logib selle rolliga seadmed välja
  if ((vana.klubi_pin || '') !== klubi) await pool.query(`DELETE FROM pokker_sessions WHERE roll='mangija'`);
  if ((vana.admin_pin || '') !== admin) await pool.query(`DELETE FROM pokker_sessions WHERE roll='admin' AND token<>$1`, [req.sessionToken || '']);
  res.json({ ok: true });
});
router.post('/seaded/uus-tv-voti', noudaAdmin, async (req, res) => {
  const v = crypto.randomBytes(12).toString('hex');
  await pool.query(`UPDATE pokker_seaded SET tv_voti=$1 WHERE id=1`, [v]);
  res.json({ ok: true, tv_voti: v });
});

// ── EKSPORT / VARUKOOPIA ──────────────────────────────────────────────────
router.get('/eksport/excel', noudaVaatajat, async (req, res) => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const kuld = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9A84C' } };
  const pais = (ws) => { ws.getRow(1).font = { bold: true }; ws.getRow(1).eachCell(c => { c.fill = kuld; }); };
  const hooajad = await pool.query(`SELECT id, nimi FROM pokker_hooajad ORDER BY algus DESC`);
  const valitud = ts(req.query.hooaeg_id) ? hooajad.rows.filter(h => h.id === ts(req.query.hooaeg_id)) : hooajad.rows;
  for (const h of valitud) {
    const et = await edetabel(h.id);
    const ws = wb.addWorksheet(h.nimi.slice(0, 30).replace(/[\\/*?:[\]]/g, ''));
    const veerud = ['Koht', 'Mängija', 'Punktid', 'Turniire', 'Võite', 'TOP 3', 'Kesk. koht', 'Rebuy', 'Re-entry', 'Add-on', 'Bounty €']
      .concat(et.turniirid.map(t => t.kuupaev.slice(5).split('-').reverse().join('.')));
    ws.addRow(veerud);
    et.read.forEach(r => ws.addRow([r.koht, r.nimi, r.punktid, r.turniire, r.voite, r.top3, r.keskmine_koht, r.rebuyd, r.reentryd, r.addonid, r.bounty_eur]
      .concat(et.turniirid.map(t => r.tulemused[t.id] ? r.tulemused[t.id].punktid : ''))));
    pais(ws); ws.getColumn(2).width = 22;
  }
  const t = await pool.query(
    `SELECT t.id, t.kuupaev, t.nimi, t.formaadi_nimi, h.nimi AS hooaeg, t.punktiturniir, m.nimi AS mangija, o.koht, o.punktid, o.rebuyd, o.reentryd, o.addonid, o.bounty_arv, o.bounty_eur, o.auhind
     FROM pokker_osalejad o JOIN pokker_turniirid t ON t.id=o.turniir_id JOIN pokker_mangijad m ON m.id=o.mangija_id LEFT JOIN pokker_hooajad h ON h.id=t.hooaeg_id
     WHERE t.staatus IN ('lopetatud','kinnitatud') ORDER BY t.kuupaev DESC, t.id, o.koht`
  );
  const ws = wb.addWorksheet('Kõik tulemused');
  ws.addRow(['Kuupäev', 'Turniir', 'Formaat', 'Hooaeg', 'Punktiturniir', 'Mängija', 'Koht', 'Punktid', 'Rebuy', 'Re-entry', 'Add-on', 'Bounty arv', 'Bounty €', 'Auhind €']);
  t.rows.forEach(x => ws.addRow([kpStr(x.kuupaev), x.nimi, x.formaadi_nimi, x.hooaeg || '', x.punktiturniir ? 'jah' : 'ei', x.mangija, x.koht, nr(x.punktid),
    x.rebuyd, x.reentryd, x.addonid, x.bounty_arv, nr(x.bounty_eur), nr(x.auhind)]));
  pais(ws); ws.getColumn(2).width = 24; ws.getColumn(6).width = 22;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="telje-pokker-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
router.get('/eksport/varukoopia', noudaAdmin, async (req, res) => {
  const tabelid = ['pokker_mangijad', 'pokker_formaadid', 'pokker_hooajad', 'pokker_korrektsioonid', 'pokker_turniirid', 'pokker_osalejad', 'pokker_tegevused'];
  const andmed = { versioon: 1, aeg: new Date().toISOString() };
  for (const t of tabelid) andmed[t] = (await pool.query(`SELECT * FROM ${t} ORDER BY id`)).rows;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="telje-pokker-varukoopia-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(andmed, null, 1));
});

module.exports = router;
