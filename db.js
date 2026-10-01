const { Pool } = require('pg');

if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD must be set before starting the server.');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'pgrm_user',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'bk_scotland',
});

// Convert @name placeholders to $1, $2, ... positional params.
// Each unique name gets one slot; repeated names reuse the same slot.
function buildQuery(sql, params = {}) {
  const values = [];
  const indices = {};
  let counter = 0;
  const text = sql.replace(/@([a-zA-Z_]\w*)/g, (_, name) => {
    if (!(name in indices)) {
      indices[name] = ++counter;
      values.push(params[name] ?? null);
    }
    return `$${indices[name]}`;
  });
  return { text, values };
}

async function query(sql, params = {}) {
  const q = buildQuery(sql, params);
  const result = await pool.query(q);
  return { recordset: result.rows, rowCount: result.rowCount };
}

async function withTransaction(fn, isolationLevel) {
  const client = await pool.connect();
  try {
    await client.query(isolationLevel ? `BEGIN ISOLATION LEVEL ${isolationLevel}` : 'BEGIN');
    const tq = (sql, params = {}) => {
      const q = buildQuery(sql, params);
      return client.query(q).then(r => ({ recordset: r.rows, rowCount: r.rowCount }));
    };
    const result = await fn(tq, client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// Extract custom app error numbers from '[51001] message' format raised by PL/pgSQL triggers
function getCustomError(error) {
  const match = (error.message || '').match(/^\[(\d+)\] ([\s\S]*)/);
  return match ? { number: parseInt(match[1], 10), message: match[2].trim() } : null;
}

// Map pg error codes / custom app codes to the numeric codes used in route catch blocks
function errorNumber(error) {
  const custom = getCustomError(error);
  if (custom) return custom.number;
  if (error.code === '23505') return 23505; // unique_violation (replaces 2601/2627)
  if (error.code === '23503') return 547;   // foreign_key_violation
  if (error.code === '40001') return 1205;  // deadlock_detected
  return null;
}

module.exports = { pool, query, withTransaction, getCustomError, errorNumber };
