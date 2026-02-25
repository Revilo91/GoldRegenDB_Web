require('dotenv').config();
const db = require('./src/config/db');

async function run() {
  try {
    const res = await db.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'Schmuckstück\'');
    console.log("Schmuckstück columns:", res.rows);
    const res2 = await db.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'Lieferschein\'');
    console.log("Lieferschein columns:", res2.rows);

    const l = await db.query('SELECT * FROM "Lieferschein" LIMIT 1');
    console.log("Lieferschein sample:", l.rows[0]);

    const s = await db.query('SELECT * FROM "Schmuckstück" LIMIT 1');
    console.log("Schmuckstück sample:", s.rows[0]);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
