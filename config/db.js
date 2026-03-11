require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 Attempting DB connection to:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@'));

const pool = new Pool({
  connectionString : process.env.DATABASE_URL,
  ssl              : { rejectUnauthorized: false },
  max              : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed!');
    console.error('❌ Error code:', err.code);
    console.error('❌ Error message:', err.message);
    return;
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      console.error('❌ Database query failed:', err.message);
    } else {
      console.log('  ✅  Database    : Connected to Supabase PostgreSQL');
      console.log('  🕐  DB Time     :', result.rows[0].now);
    }
  });
});

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };