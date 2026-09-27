const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
let handler, query;
const auth = () => {};
require('../results-routes')({
  get(path, middleware, callback) {
    if (path === '/api/reports/mission-standings') {
      assert.equal(middleware, auth); handler = callback;
    }
  }, post() {},
}, { db: { request: () => ({ query: async text => { query = text; return { recordset: [] }; } }) },
  dbReady: Promise.resolve(), sql, authMiddleware: auth, isAdmin: () => false });
(async () => {
  await handler({}, { set(key, value) { assert.equal(value, 'no-store'); },
    json(body) { assert.deepEqual(body, { missions: [] }); }, status() { throw new Error('Report failed'); } });
  const pool = await sql.connect({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland', options: { encrypt: false, trustServerCertificate: true } });
  try {
    const setup = `CREATE TABLE #MissionDetails (MissionName varchar(50));
      INSERT INTO #MissionDetails VALUES ('A'), ('B'), ('C'), ('D'), ('A');
      CREATE TABLE #PublishedResults (ContestantMission varchar(50), IndividualGroup varchar(20), Points int, Score int, IsWalkOver bit);
      INSERT INTO #PublishedResults VALUES
      ('A','Individual',5,99,0), (' A ',' group ',10,10,0),
      ('B','Group',15,NULL,1), ('C','Individual',3,100,0),
      ('C','Individual',NULL,100,0), ('C','Other',999,999,0);`;
    const testQuery = query.replaceAll('dbo.PublishedResults', '#PublishedResults').replaceAll('dbo.MissionDetails', '#MissionDetails');
    const result = await pool.request().query(setup + testQuery + '; DELETE FROM #PublishedResults; ' + testQuery);
    assert.deepEqual(result.recordsets[0].map(row => row.Mission), ['A', 'B', 'C', 'D']);
    assert.deepEqual(result.recordsets[0].map(row => Number(row.Place)), [1, 1, 2, 3]);
    assert.deepEqual(result.recordsets[0].map(row => Number(row.TotalPoints)), [15, 15, 3, 0]);
    assert.equal(Number(result.recordsets[0][0].IndividualPoints), 5);
    assert.equal(Number(result.recordsets[0][0].GroupPoints), 10);
    assert.equal(result.recordsets[1].length, 4);
    assert.ok(result.recordsets[1].every(row => Number(row.TotalPoints) === 0 && Number(row.Place) === 1));
    const live = await pool.request().query(query);
    console.log('PASS: combined points, ties, ordering, all missions, zero totals, WalkOver points, trimmed names, and live read-only query (' + live.recordset.length + ' missions).');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
