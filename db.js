const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ettevotted (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(50) NOT NULL UNIQUE,
        tyyp VARCHAR(20) NOT NULL DEFAULT 'muu',
        aktiivne BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(100) NOT NULL,
        pin VARCHAR(10) NOT NULL UNIQUE,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS objektid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL,
        ettevote_id INTEGER REFERENCES ettevotted(id),
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS worker_ettevotted (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        ettevote_id INTEGER REFERENCES ettevotted(id) ON DELETE CASCADE,
        tunnitasu DECIMAL(10,2) NOT NULL DEFAULT 0,
        UNIQUE(worker_id, ettevote_id)
      );
      CREATE TABLE IF NOT EXISTS tookirjed (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        objekt_id INTEGER REFERENCES objektid(id),
        ettevote_id INTEGER REFERENCES ettevotted(id),
        kuupaev DATE NOT NULL,
        algus TIME NOT NULL,
        lopp TIME NOT NULL,
        tunnid DECIMAL(4,2) NOT NULL,
        kommentaar TEXT,
        kilomeetrid DECIMAL(8,1) DEFAULT 0,
        km_raha DECIMAL(8,2) DEFAULT 0,
        loodud TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS kilomeetrid DECIMAL(8,1) DEFAULT 0;
      ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS muudetud_tootaja TIMESTAMP;
      ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS km_raha DECIMAL(8,2) DEFAULT 0;
      CREATE TABLE IF NOT EXISTS tulevased_tood (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        ettevote_id INTEGER REFERENCES ettevotted(id),
        objekt_id INTEGER REFERENCES objektid(id),
        kuupaev DATE NOT NULL,
        algus_kell VARCHAR(5),
        lopp_kell VARCHAR(5),
        kirjeldus TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS maksed (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        summa DECIMAL(10,2) NOT NULL,
        kuupaev DATE NOT NULL,
        kommentaar TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    // Töötaja arhiveerimine — endised töötajad saab peita nimekirjast andmeid kaotamata.
    // Arhiveerimine lülitab automaatselt välja ka aktiivne (sisselogimisõiguse), vt routes/admin.js.
    await client.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS arhiveeritud BOOLEAN DEFAULT false;`);
    // Töötajate e-posti aadress (kasutusel routes/admin.js "Töötajad" haldusvaates).
    await client.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS email VARCHAR(200);`);

    // ── SISSELOGIMISE SESSIOONID + AUDIT LOG ──────────────────────────
    // Neid tabeleid kasutavad server.js (igal päringul, sessiooni kontrollimiseks) ja
    // routes/auth.js, routes/admin.js, routes/tood.js (sisselogimine, väljalogimine, audit).
    // Need on kunagi käsitsi andmebaasi loodud, aga ei olnud siin skeemis kirjas — kui rakendus
    // kunagi tühjale/uuele andmebaasile käivitatakse, ilma selle lisata ebaõnnestuks sisselogimine täielikult.
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(100) NOT NULL UNIQUE,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS worker_sessions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(100) NOT NULL UNIQUE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        worker_nimi VARCHAR(100),
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
        tegevus VARCHAR(100) NOT NULL,
        details TEXT,
        ip_aadress VARCHAR(100),
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);

    // Käsitsi saadetud vabas vormis sõnumid — kuvatakse töötaja pealehel "Sinu teated" all,
    // et sõnum jääks alles ka pärast telefoni teavituse kadumist.
    await client.query(`
      CREATE TABLE IF NOT EXISTS worker_teated (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        pealkiri VARCHAR(200) NOT NULL,
        sonum TEXT NOT NULL,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);

    // ── LIDL PROJEKTID ─────────────────────────────────────────────────
    // Kasutusel routes/tood.js ja routes/kristo.js — struktureeritud projektide nimekiri
    // Lidl töökirjete jaoks (vt tookirjed.lidl_projekt_id allpool). Samuti kunagi käsitsi loodud,
    // aga db.js-is seni kirjas ei olnud.
    await client.query(`
      CREATE TABLE IF NOT EXISTS lidl_projektid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL UNIQUE,
        jrk_nr INTEGER DEFAULT 0,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    // Töökirje seos Lidl projektiga + lisakulu väljad (kasutusel routes/tood.js-is,
    // aga puudusid siin skeemis).
    await client.query(`ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS lidl_projekt_id INTEGER REFERENCES lidl_projektid(id);`);
    await client.query(`ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS lisakulu_summa DECIMAL(10,2) DEFAULT 0;`);
    await client.query(`ALTER TABLE tookirjed ADD COLUMN IF NOT EXISTS lisakulu_selgitus TEXT;`);
    await client.query(`
      INSERT INTO ettevotted (nimi, tyyp) VALUES
        ('EDGF 2026', 'edgf'),
        ('LIDL', 'lidl'),
        ('CRAMO', 'cramo'),
        ('MUU', 'muu'),
        ('MEREKOHVIK', 'muu')
      ON CONFLICT (nimi) DO NOTHING;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tookirje_pildid (
        id SERIAL PRIMARY KEY,
        tookirje_id INTEGER REFERENCES tookirjed(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        public_id TEXT NOT NULL,
        nimi TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE,
        subscription TEXT NOT NULL,
        uuendatud TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS graafik_adminid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(100) NOT NULL,
        pin VARCHAR(10) NOT NULL UNIQUE,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS graafik_admin_sessions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(100) NOT NULL UNIQUE,
        nimi VARCHAR(100) NOT NULL,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS merekohvik_graafik (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        kuupaev DATE NOT NULL,
        algus VARCHAR(5) NOT NULL,
        lopp VARCHAR(5) NOT NULL,
        "märkus" TEXT DEFAULT '',
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS merekohvik_paevad (
        id SERIAL PRIMARY KEY,
        kuupaev DATE NOT NULL UNIQUE,
        staatus VARCHAR(20) DEFAULT 'tavaline',
        "märkus" TEXT DEFAULT '',
        lukustatud BOOLEAN DEFAULT false
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lisakulud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        kuupaev DATE NOT NULL,
        summa DECIMAL(10,2) NOT NULL,
        selgitus TEXT NOT NULL,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS edgf_kulud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        kuupaev DATE NOT NULL,
        summa DECIMAL(10,2) NOT NULL,
        selgitus TEXT NOT NULL,
        foto_url TEXT,
        foto_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS edgf_lubatud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_events (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL,
        kuupaev DATE NOT NULL,
        hooaeg VARCHAR(20) DEFAULT 'suvi',
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_rajad (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        nimi VARCHAR(200) NOT NULL DEFAULT 'Rada',
        jrk_nr INTEGER DEFAULT 0,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_asukohad (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        nimi VARCHAR(200) NOT NULL,
        korvide_arv INTEGER NOT NULL DEFAULT 0,
        viskekohtade_arv INTEGER DEFAULT 0,
        jrk_nr INTEGER DEFAULT 0,
        paigaldus_staatus VARCHAR(20) DEFAULT 'ootel',
        paigaldas_id INTEGER REFERENCES workers(id),
        paigaldas_nimi VARCHAR(100),
        paigaldatud_kell TIMESTAMP,
        puhastus_staatus VARCHAR(20) DEFAULT 'ootel',
        puhastas_id INTEGER REFERENCES workers(id),
        puhastas_nimi VARCHAR(100),
        puhastatud_kell TIMESTAMP,
        markused TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_lubatud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE
      );
    `);
    // X-seeria: terve võistluse ühine rajakaardi link (nt Google Maps/PDF), näidatakse töötaja vaates suure nupuna
    await client.query(`ALTER TABLE xseeria_events ADD COLUMN IF NOT EXISTS rajakaart_url TEXT;`);
    // Võistluse kaanepilt — kuvatakse adminni "Projektid"/X-seeria valikus suure ruudukujulise pildina
    // pelga tekstinupu asemel (nt Tallinna Vanalinna Openi/Tartu foto).
    await client.query(`ALTER TABLE xseeria_events ADD COLUMN IF NOT EXISTS kaas_foto_url TEXT;`);
    await client.query(`ALTER TABLE xseeria_events ADD COLUMN IF NOT EXISTS kaas_foto_public_id TEXT;`);
    // X-seeria: rada tase + korvide (üksikute) tase + rajakaardi foto — lisatud olemasolevale skeemile
    await client.query(`ALTER TABLE xseeria_asukohad ADD COLUMN IF NOT EXISTS rada_id INTEGER REFERENCES xseeria_rajad(id) ON DELETE CASCADE;`);
    await client.query(`ALTER TABLE xseeria_asukohad ADD COLUMN IF NOT EXISTS foto_url TEXT;`);
    await client.query(`ALTER TABLE xseeria_asukohad ADD COLUMN IF NOT EXISTS foto_public_id TEXT;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_korvid (
        id SERIAL PRIMARY KEY,
        asukoht_id INTEGER REFERENCES xseeria_asukohad(id) ON DELETE CASCADE,
        number VARCHAR(20) NOT NULL,
        jrk_nr INTEGER DEFAULT 0,
        paigaldus_staatus VARCHAR(20) DEFAULT 'ootel',
        paigaldas_id INTEGER REFERENCES workers(id),
        paigaldas_nimi VARCHAR(100),
        paigaldatud_kell TIMESTAMP,
        puhastus_staatus VARCHAR(20) DEFAULT 'ootel',
        puhastas_id INTEGER REFERENCES workers(id),
        puhastas_nimi VARCHAR(100),
        puhastatud_kell TIMESTAMP,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    // Rajakaardi foto käib nüüd iga üksiku korvi (raja numbri) kohta, mitte terve pargi kohta
    await client.query(`ALTER TABLE xseeria_korvid ADD COLUMN IF NOT EXISTS foto_url TEXT;`);
    await client.query(`ALTER TABLE xseeria_korvid ADD COLUMN IF NOT EXISTS foto_public_id TEXT;`);
    // Ühekordne migratsioon: varem loodud asukohad (enne rada-taset) said default "Rada" külge
    const orbud = await client.query(`SELECT DISTINCT event_id FROM xseeria_asukohad WHERE rada_id IS NULL AND event_id IS NOT NULL`);
    for (const row of orbud.rows) {
      const uusRada = await client.query(`INSERT INTO xseeria_rajad (event_id, nimi) VALUES ($1, 'Rada') RETURNING id`, [row.event_id]);
      await client.query(`UPDATE xseeria_asukohad SET rada_id=$1 WHERE event_id=$2 AND rada_id IS NULL`, [uusRada.rows[0].id, row.event_id]);
    }
    // Ühekordne migratsioon: asukohtadele, millel on korvide_arv aga veel ühtki korvi-kirjet, luuakse numbritatud korvid (1..N)
    const tyhjad = await client.query(`
      SELECT a.id, a.korvide_arv
      FROM xseeria_asukohad a
      LEFT JOIN xseeria_korvid k ON k.asukoht_id = a.id
      WHERE a.korvide_arv > 0 AND k.id IS NULL
    `);
    for (const a of tyhjad.rows) {
      for (let n = 1; n <= a.korvide_arv; n++) {
        await client.query(`INSERT INTO xseeria_korvid (asukoht_id, number, jrk_nr) VALUES ($1, $2, $3)`, [a.id, String(n), n]);
      }
    }
    // X-seeria: organisatoorne pool — ülesanded (checklist per võistlus) + sponsorid (üldine nimekiri, mis kandub
    // ise iga võistluse alla, kuna sponsorid ei kao, vaid lisanduvad etapp-etapilt)
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_ulesanded (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        tekst TEXT NOT NULL,
        kategooria VARCHAR(100),
        tahtaeg DATE,
        vastutaja_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
        tehtud BOOLEAN NOT NULL DEFAULT false,
        tehtud_kell TIMESTAMP,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_sponsorid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL,
        kontakt VARCHAR(200),
        tooted TEXT,
        markused TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_event_sponsorid (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        sponsor_id INTEGER REFERENCES xseeria_sponsorid(id) ON DELETE CASCADE,
        staatus VARCHAR(20) NOT NULL DEFAULT 'ootel',
        jargi_kp DATE,
        tagastatud_kp DATE,
        markused TEXT,
        uuendatud TIMESTAMP DEFAULT NOW(),
        UNIQUE(event_id, sponsor_id)
      );
    `);
    // Sponsori per-event staatusele lisandub vastutaja (töötaja, kes selle eest vastutab) — nii saab
    // nii admin kui ka määratud töötaja ise oma X-seeria vaates staatust (ootel/käes/tagastatud) märkida.
    await client.query(`ALTER TABLE xseeria_event_sponsorid ADD COLUMN IF NOT EXISTS vastutaja_id INTEGER REFERENCES workers(id) ON DELETE SET NULL;`);

    // Logistilised tegevused (korvide pealelaadimine, bussi toomine, tankimine jne) — kuupäev+kellaaeg,
    // ja mitu inimest saab korraga määrata (paljudele tegevustele on vaja rohkem kui üht töötajat).
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_tegevused (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        tegevus VARCHAR(300) NOT NULL,
        kuupaev DATE,
        kellaaeg TIME,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS xseeria_tegevuse_inimesed (
        id SERIAL PRIMARY KEY,
        tegevus_id INTEGER REFERENCES xseeria_tegevused(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE(tegevus_id, worker_id)
      );
    `);

    // Kulude raport — päris kulud selle võistluse kohta (toode, kogus, hind/tk). Ainult adminnile,
    // et üritusele järgi vaadata, mis tegelikult maksma läks.
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_kulud (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        toode VARCHAR(300) NOT NULL,
        kogus NUMERIC(10,2) NOT NULL DEFAULT 1,
        hind NUMERIC(10,2) NOT NULL DEFAULT 0,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);

    // Pargi vastutajad — mitu töötajat saab korraga määrata ühe pargi eest vastutama
    // (asendab admin.html üksiku pargi vormis endist "Viskekohti" välja, mida keegi ei kasutanud).
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_asukoha_vastutajad (
        id SERIAL PRIMARY KEY,
        asukoht_id INTEGER REFERENCES xseeria_asukohad(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE(asukoht_id, worker_id)
      );
    `);

    // Töötaja ISIKLIKUD kulud (kütus, toit, tööriistad jne) konkreetse X-seeria võistluse kohta —
    // sama põhimõte mis Rally Estonia/EDGF "Minu kulud", aga siin veel eraldi iga võistluse (event) kaupa.
    // Eraldi adminni "xseeria_kulud" (toode/kogus/hind) raportist, mis on adminni enda kuluarvestus.
    await client.query(`
      CREATE TABLE IF NOT EXISTS xseeria_omakulud (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES xseeria_events(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        kuupaev DATE NOT NULL,
        summa DECIMAL(10,2) NOT NULL,
        selgitus TEXT NOT NULL,
        foto_url TEXT,
        foto_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    // ── ARVED (invoice-moodul) ──────────────────────────────────────────
    // Ettevõtete (Lidl/Cramo/...) arvele minevad püsiandmed — aadress, registrikood, KMKR, maksetähtaeg.
    // Ad-hoc (kolmanda osapoole) arvete puhul jäävad need ostja väljad arve enda peal (ettevote_id on siis null).
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_aadress TEXT;`);
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_rg_kood VARCHAR(20);`);
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_kmkr VARCHAR(20);`);
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_maksetahtaeg_paevad INTEGER DEFAULT 14;`);
    // Vabas vormis mall kontaktisiku/lisainfo rea jaoks (nt Lidl: "Kristo Allikas - GK Projekt ...",
    // Cramo: "Osakond: 5002 Tellija - Andres Rammo") — täidetakse arve loomisel käsitsi, siin ainult viimati kasutatud väärtus.
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_kontakt_viimane TEXT;`);
    // Ostja täisnimi arvel (nt "Cramo Estonia AS"), eristub külgmenüü lühinimest ("CRAMO").
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_nimi VARCHAR(200);`);
    // Kliendile ESITATAV tunnihind (nt Cramo 25€/h) — eraldi töötaja enda PALGAMÄÄRAST
    // (worker_ettevotted.tunnitasu). Neid kahte ei tohi arvete koostamisel omavahel segi ajada.
    await client.query(`ALTER TABLE ettevotted ADD COLUMN IF NOT EXISTS arve_tunnihind DECIMAL(10,2);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS arved (
        id SERIAL PRIMARY KEY,
        number VARCHAR(20) NOT NULL UNIQUE,
        kuupaev DATE NOT NULL,
        maksetahtaeg DATE NOT NULL,
        viitenumber VARCHAR(20) NOT NULL,
        ettevote_id INTEGER REFERENCES ettevotted(id),
        ostja_nimi VARCHAR(200) NOT NULL,
        ostja_aadress TEXT,
        ostja_rg_kood VARCHAR(20),
        ostja_kmkr VARCHAR(20),
        kontaktisik TEXT,
        po_number VARCHAR(100),
        algus DATE,
        lopp DATE,
        summa_km_ta DECIMAL(10,2) NOT NULL DEFAULT 0,
        kaibemaks_protsent DECIMAL(5,2) NOT NULL DEFAULT 24,
        kaibemaks DECIMAL(10,2) NOT NULL DEFAULT 0,
        kokku DECIMAL(10,2) NOT NULL DEFAULT 0,
        staatus VARCHAR(20) NOT NULL DEFAULT 'maksmata',
        fail_url TEXT,
        fail_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS arve_read (
        id SERIAL PRIMARY KEY,
        arve_id INTEGER REFERENCES arved(id) ON DELETE CASCADE,
        jrk_nr INTEGER DEFAULT 0,
        kirjeldus TEXT NOT NULL,
        kogus DECIMAL(10,2) NOT NULL DEFAULT 1,
        uhik VARCHAR(20) DEFAULT '',
        hind DECIMAL(10,2) NOT NULL DEFAULT 0,
        summa DECIMAL(10,2) NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS arve_paeva_loendur (
        paev VARCHAR(6) PRIMARY KEY,
        jargmine_jrk INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS arve_valikud (
        id SERIAL PRIMARY KEY,
        ettevote_id INTEGER REFERENCES ettevotted(id),
        tyyp VARCHAR(20) NOT NULL,
        vaartus VARCHAR(300) NOT NULL,
        silt VARCHAR(200),
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS arve_sisse (
        id SERIAL PRIMARY KEY,
        kuupaev DATE NOT NULL,
        tahtaeg DATE,
        ettevote_id INTEGER REFERENCES ettevotted(id),
        kirjeldus TEXT,
        summa DECIMAL(10,2) NOT NULL DEFAULT 0,
        kaibemaks DECIMAL(10,2) NOT NULL DEFAULT 0,
        staatus VARCHAR(20) NOT NULL DEFAULT 'ootel',
        fail_url TEXT,
        fail_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS arve_lubatud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE
      );
    `);
    // Vana deploy võis arve_sisse juba luua ilma nende veergudeta — lisame eraldi, et need kindlasti tekiks.
    await client.query(`ALTER TABLE arve_sisse ADD COLUMN IF NOT EXISTS kaibemaks DECIMAL(10,2) NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE arve_sisse ADD COLUMN IF NOT EXISTS tahtaeg DATE;`);
    await client.query(`ALTER TABLE arve_sisse ADD COLUMN IF NOT EXISTS staatus VARCHAR(20) NOT NULL DEFAULT 'ootel';`);
    // Vanad kirjed, mis loodi enne vaikeväärtuse muutmist, jäävad 'makstud' juurde — see puudutab ainult UUSI kirjeid.
    // Väljaminevate arvete jaoks (tagantjärele üleslaaditud vanad arved, millel pole meie enda arveridu).
    await client.query(`ALTER TABLE arved ADD COLUMN IF NOT EXISTS fail_url TEXT;`);
    await client.query(`ALTER TABLE arved ADD COLUMN IF NOT EXISTS fail_public_id TEXT;`);
    // Cloudinay resource_type ('raw' PDF-idele, 'image' piltidele) — vajalik õigeks kustutamiseks
    // ning selleks, et vältida Cloudinary vaikimisi PDF-delivery piirangut ("tühi leht" viga).
    await client.query(`ALTER TABLE arved ADD COLUMN IF NOT EXISTS fail_resource_type VARCHAR(10);`);
    await client.query(`ALTER TABLE arve_sisse ADD COLUMN IF NOT EXISTS fail_resource_type VARCHAR(10);`);
    // Reg-kood/KMKR väljad olid VARCHAR(20) — liiga kitsas, kui kellegi salvestatud kliendiandmetesse
    // sattus kogemata pikem tekst (nt osakonna nimi reg-koodi asemel). Sellest tuli "value too long"
    // viga arve salvestamisel. Laiendame, et see enam terve arve loomist ei blokeeriks.
    await client.query(`ALTER TABLE arved ALTER COLUMN ostja_rg_kood TYPE VARCHAR(200);`);
    await client.query(`ALTER TABLE arved ALTER COLUMN ostja_kmkr TYPE VARCHAR(200);`);
    await client.query(`ALTER TABLE arve_kliendid ALTER COLUMN rg_kood TYPE VARCHAR(200);`);
    await client.query(`ALTER TABLE arve_kliendid ALTER COLUMN kmkr TYPE VARCHAR(200);`);
    // Kolmandad osapooled (ostjad, kes pole Lidl/Cramo/Merekohvik/Muu) — kord käsitsi sisestatud, jäävad meelde,
    // et Klient rippmenüüst saaks nad tulevikus kiirelt uuesti valida.
    await client.query(`
      CREATE TABLE IF NOT EXISTS arve_kliendid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL UNIQUE,
        aadress TEXT,
        rg_kood VARCHAR(200),
        kmkr VARCHAR(200),
        maksetahtaeg_paevad INTEGER DEFAULT 14,
        kontaktisik TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
    `);
    // Lidl ja Cramo arve baasandmed (registrikoodid/aadressid varasematelt arvetelt) — täidame ainult siis,
    // kui pole veel käsitsi/administ seadistatud (ei kirjuta hiljem tehtud muudatusi üle).
    await client.query(`
      UPDATE ettevotted SET
        arve_aadress = 'A. H. Tammsaare tee 47, Kristiine linnaosa, Tallinn, 11316 Harju maakond',
        arve_rg_kood = '14131773',
        arve_kmkr = 'EE101924962',
        arve_maksetahtaeg_paevad = 21
      WHERE nimi = 'LIDL' AND arve_rg_kood IS NULL;
    `);
    await client.query(`
      UPDATE ettevotted SET
        arve_aadress = 'Kadaka tee 131/4, Mustamäe linnaosa, Tallinn, 12915 Harju maakond',
        arve_rg_kood = '10166658',
        arve_kmkr = 'EE100244326',
        arve_maksetahtaeg_paevad = 14
      WHERE nimi = 'CRAMO' AND arve_rg_kood IS NULL;
    `);
    // Ostja täisnimi (eraldi guard arve_nimi järgi, sest arve_rg_kood võib eelmisest deploy'st juba täidetud olla).
    await client.query(`UPDATE ettevotted SET arve_nimi = 'Lidl Eesti OÜ' WHERE nimi = 'LIDL' AND (arve_nimi IS NULL OR arve_nimi = '');`);
    await client.query(`UPDATE ettevotted SET arve_nimi = 'Cramo Estonia AS' WHERE nimi = 'CRAMO' AND (arve_nimi IS NULL OR arve_nimi = '');`);

    // ── PROJEKTID (üldistatud EDGF/Rally Estonia + tulevased üritused, routes/projektid.js) ──
    // Need tabelid puudusid seni täielikult — moodul oli koodis olemas, aga andmebaasis mitte,
    // mistõttu iga päring (nt "Loo projekt") lõppes veaga.
    await client.query(`
      CREATE TABLE IF NOT EXISTS projektid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL,
        ikoon VARCHAR(10) DEFAULT '📁',
        varv VARCHAR(20) DEFAULT '#7c3aed',
        jrk_nr INTEGER DEFAULT 0,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS projekti_kulud (
        id SERIAL PRIMARY KEY,
        projekt_id INTEGER REFERENCES projektid(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        kuupaev DATE NOT NULL,
        summa DECIMAL(10,2) NOT NULL,
        selgitus TEXT NOT NULL,
        foto_url TEXT,
        foto_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS projekti_lubatud (
        id SERIAL PRIMARY KEY,
        projekt_id INTEGER REFERENCES projektid(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        UNIQUE(projekt_id, worker_id)
      );
    `);

    // ── OMA ARVED (töötaja isiklik arvete moodul, routes/omaarved.js) ──
    // Samuti täiesti puudu olnud tabelid — vt eelmine märkus.
    await client.query(`
      CREATE TABLE IF NOT EXISTS omaarve_muujad (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        ettevote_nimi VARCHAR(200) NOT NULL,
        aadress TEXT,
        rg_kood VARCHAR(20),
        kmkr VARCHAR(20),
        pangakonto VARCHAR(50),
        pank VARCHAR(100),
        telefon VARCHAR(50),
        epost VARCHAR(200),
        km_kohuslane BOOLEAN DEFAULT true,
        vaikimisi BOOLEAN DEFAULT false,
        logo_url TEXT,
        logo_public_id TEXT,
        loodud TIMESTAMP DEFAULT NOW(),
        uuendatud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS omaarve_saajad (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        nimi VARCHAR(200) NOT NULL,
        aadress TEXT,
        rg_kood VARCHAR(20),
        kmkr VARCHAR(20),
        kontaktisik TEXT,
        epost VARCHAR(200),
        maksetahtaeg_paevad INTEGER DEFAULT 14,
        UNIQUE(worker_id, nimi)
      );
      CREATE TABLE IF NOT EXISTS omaarved (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        muuja_id INTEGER REFERENCES omaarve_muujad(id),
        number VARCHAR(20) NOT NULL,
        kuupaev DATE NOT NULL,
        maksetahtaeg DATE NOT NULL,
        saaja_nimi VARCHAR(200) NOT NULL,
        saaja_aadress TEXT,
        saaja_rg_kood VARCHAR(20),
        saaja_kmkr VARCHAR(20),
        saaja_kontaktisik TEXT,
        saaja_epost VARCHAR(200),
        summa_km_ta DECIMAL(10,2) NOT NULL DEFAULT 0,
        kaibemaks_protsent DECIMAL(5,2) NOT NULL DEFAULT 24,
        kaibemaks DECIMAL(10,2) NOT NULL DEFAULT 0,
        kokku DECIMAL(10,2) NOT NULL DEFAULT 0,
        loodud TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS omaarve_read (
        id SERIAL PRIMARY KEY,
        arve_id INTEGER REFERENCES omaarved(id) ON DELETE CASCADE,
        jrk_nr INTEGER DEFAULT 0,
        kirjeldus TEXT NOT NULL,
        kogus DECIMAL(10,2) NOT NULL DEFAULT 1,
        uhik VARCHAR(20) DEFAULT '',
        hind DECIMAL(10,2) NOT NULL DEFAULT 0,
        summa DECIMAL(10,2) NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS omaarve_lubatud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE
      );
      CREATE TABLE IF NOT EXISTS omaarve_paeva_loendur (
        paev VARCHAR(6) PRIMARY KEY,
        jargmine_jrk INTEGER NOT NULL DEFAULT 1
      );
    `);

    // ── PADEL ──────────────────────────────────────────────────────────
    // Kes tohib Padel moodulit näha (sama muster nagu arve_lubatud) —
    // eraldi ligipääsuõigus, nii et mängijad ei näe muid tööalaseid mooduleid.
    await client.query(`
      CREATE TABLE IF NOT EXISTS padel_lubatud (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE UNIQUE
      );
      -- Üks grupp = üks nädalapäev (nt "Esmaspäev", "Kolmapäev") koos oma 4 fikseeritud mängijaga.
      CREATE TABLE IF NOT EXISTS padel_ryhmad (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(100) NOT NULL,
        hind DECIMAL(10,2) NOT NULL DEFAULT 15.50,
        vaikimisi_kellaaeg TIME,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );
      -- Grupi fikseeritud liikmed, jrk_nr määrab paaride rotatsiooni järjekorra (A,B,C,D).
      CREATE TABLE IF NOT EXISTS padel_liikmed (
        id SERIAL PRIMARY KEY,
        ryhm_id INTEGER REFERENCES padel_ryhmad(id) ON DELETE CASCADE,
        worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
        jrk_nr INTEGER NOT NULL DEFAULT 0,
        foto_url TEXT,
        foto_public_id TEXT,
        UNIQUE(ryhm_id, worker_id)
      );
      -- Varem kasutatud asendajate nimed grupi kohta, et need rippmenüüs uuesti pakkuda.
      CREATE TABLE IF NOT EXISTS padel_asendajad (
        id SERIAL PRIMARY KEY,
        ryhm_id INTEGER REFERENCES padel_ryhmad(id) ON DELETE CASCADE,
        nimi VARCHAR(100) NOT NULL,
        UNIQUE(ryhm_id, nimi)
      );
      -- Üks nädala trenn ühe grupi kohta.
      CREATE TABLE IF NOT EXISTS padel_nadalad (
        id SERIAL PRIMARY KEY,
        ryhm_id INTEGER REFERENCES padel_ryhmad(id) ON DELETE CASCADE,
        kuupaev DATE NOT NULL,
        kellaaeg TIME,
        paar1_geimid INTEGER,
        paar2_geimid INTEGER,
        ukse_kood VARCHAR(4),
        uksekoodi_teavitus_saadetud BOOLEAN NOT NULL DEFAULT false,
        tulemus_sisestas INTEGER REFERENCES workers(id) ON DELETE SET NULL,
        loodud TIMESTAMP DEFAULT NOW(),
        UNIQUE(ryhm_id, kuupaev)
      );
      -- Iga fikseeritud liikme "koht" konkreetsel nädalal: osaleb ise või asendaja, millises paaris ja makse.
      -- "paar" (1 või 2) määrab, kumba nädala tulemuse poolt (padel_nadalad.paar1_geimid/paar2_geimid)
      -- see koht saab oma edetabeli-geimid. Geimid lähevad ALATI liige_id (fikseeritud mängija) edetabelisse,
      -- ka siis, kui tegelikult mängis asendaja. Makse kuulub aga sellele, kes TEGELIKULT mängis.
      CREATE TABLE IF NOT EXISTS padel_kohad (
        id SERIAL PRIMARY KEY,
        nadal_id INTEGER REFERENCES padel_nadalad(id) ON DELETE CASCADE,
        liige_id INTEGER REFERENCES padel_liikmed(id) ON DELETE CASCADE,
        paar INTEGER NOT NULL DEFAULT 1 CHECK (paar IN (1,2)),
        osaleb BOOLEAN NOT NULL DEFAULT true,
        kinnitatud BOOLEAN NOT NULL DEFAULT false,
        asendaja_nimi VARCHAR(100),
        makstud BOOLEAN NOT NULL DEFAULT false,
        summa DECIMAL(10,2),
        UNIQUE(nadal_id, liige_id)
      );
      -- Iga trenn võib koosneda mitmest geimist/setist (nt 6:3, 7:5, 1:6) — kokkuvõttes
      -- võrreldakse GEIMIDE SUMMAT: rohkem geime kogunud paar saab trenni eest 2 punkti,
      -- viigi korral mõlemad paarid 1 punkti. Punktid (mitte geimid) on peamine edetabeli näitaja.
      CREATE TABLE IF NOT EXISTS padel_setid (
        id SERIAL PRIMARY KEY,
        nadal_id INTEGER REFERENCES padel_nadalad(id) ON DELETE CASCADE,
        jrk_nr INTEGER NOT NULL DEFAULT 0,
        paar1_geimid INTEGER NOT NULL,
        paar2_geimid INTEGER NOT NULL
      );
    `);
    // Kui padel_kohad on juba varem loodud (ilma kinnitatud veeruta), lisame selle siia.
    await client.query(`ALTER TABLE padel_kohad ADD COLUMN IF NOT EXISTS kinnitatud BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE padel_nadalad ADD COLUMN IF NOT EXISTS ukse_kood VARCHAR(4);`);
    await client.query(`ALTER TABLE padel_liikmed ADD COLUMN IF NOT EXISTS foto_url TEXT;`);
    await client.query(`ALTER TABLE padel_liikmed ADD COLUMN IF NOT EXISTS foto_public_id TEXT;`);
    await client.query(`ALTER TABLE padel_nadalad ADD COLUMN IF NOT EXISTS meeldetuletus_saadetud BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE padel_ryhmad ADD COLUMN IF NOT EXISTS vaikimisi_kellaaeg TIME;`);
    await client.query(`ALTER TABLE padel_nadalad ADD COLUMN IF NOT EXISTS kellaaeg TIME;`);
    await client.query(`ALTER TABLE padel_nadalad ADD COLUMN IF NOT EXISTS uksekoodi_teavitus_saadetud BOOLEAN NOT NULL DEFAULT false;`);

    console.log('✅ Andmebaas valmis');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
