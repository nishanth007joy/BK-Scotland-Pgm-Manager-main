const assert = require('node:assert/strict');
const sql = require('mssql');
const order = require('../age-category-order');
process.loadEnvFile('.env');
(async () => {
  const db = await sql.connect({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland', options: { encrypt: false, trustServerCertificate: true } });
  try {
    const result = await db.request().query(`SELECT AgeRange FROM (VALUES ('25+'),('11-13'),('8-10'),('0-7'),('18-25'),('14-17'),('All Ages'),('30 and above'),('Under 30')) v(AgeRange) ORDER BY ${order('AgeRange')};`);
    assert.deepEqual(result.recordset.map(r => r.AgeRange), ['0-7','8-10','11-13','14-17','18-25','25+','Under 30','30 and above','All Ages']);
    const routes = new Map();
    require('../results-routes')({ get(path, auth, handler) { routes.set(path, handler); }, post() {} },
      { db, dbReady: Promise.resolve(), sql, authMiddleware() {}, isAdmin() { return false; } });
    for (const path of ['/api/results/options', '/api/results/publish-options', '/api/results/published']) {
      await routes.get(path)({}, { set() {}, json(body) { assert.ok(body); }, status(code) { throw Error(path + ': ' + code); } });
    }
    console.log('PASS: age category ordering and live results selector/published queries.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
