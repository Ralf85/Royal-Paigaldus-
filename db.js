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

    console.log('✅ Andmebaas valmis');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
