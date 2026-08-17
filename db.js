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

    console.log('✅ Andmebaas valmis');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
