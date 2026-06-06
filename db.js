const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(100) NOT NULL,
        pin VARCHAR(10) NOT NULL UNIQUE,
        tunnitasu DECIMAL(10,2) NOT NULL DEFAULT 0,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS objektid (
        id SERIAL PRIMARY KEY,
        nimi VARCHAR(200) NOT NULL,
        aktiivne BOOLEAN DEFAULT true,
        loodud TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tookirjed (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        objekt_id INTEGER REFERENCES objektid(id),
        kuupaev DATE NOT NULL,
        algus TIME NOT NULL,
        lopp TIME NOT NULL,
        tunnid DECIMAL(4,2) NOT NULL,
        kommentaar TEXT,
        loodud TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tulevased_tood (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER REFERENCES workers(id),
        firma VARCHAR(20) NOT NULL,
        objekt VARCHAR(200),
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
    console.log('✅ Andmebaas valmis');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
