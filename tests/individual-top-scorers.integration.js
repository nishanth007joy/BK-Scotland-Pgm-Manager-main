const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
let handler, query;
const auth = () => {};
require('../results-routes')({
  get(path, middleware, callback) {
    if (path === '/api/reports/individual-top-scorers') {
      assert.equal(middleware, auth); handler = callback;
    }
  }, post() {},
}, { db: { request: () => ({ query: async text => { query = text; return { recordset: [] }; } }) },
  dbReady: Promise.resolve(), sql, authMiddleware: auth, isAdmin: () => false });
(async () => {
  await handler({}, { set(key, value) { assert.equal(value, 'no-store'); },
    json(body) { assert.deepEqual(body, { scorers: [] }); }, status() { throw new Error('Report failed'); } });
  const pool = await sql.connect({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland', options: { encrypt: false, trustServerCertificate: true } });
  try {
    const setup = `CREATE TABLE #PublishedResults (ContestantID nvarchar(50), ContestantFirstName varchar(50),
      ContestantLastName varchar(50), ContestantMission varchar(50), IndividualGroup varchar(15),
      Points int, Score int, OnStageOffStage varchar(10), IsWalkOver bit);
      INSERT INTO #PublishedResults VALUES
      ('a','Same','Name','Mission A','Individual',5,10,'OnStage',0),
      ('a','Same','Name','Mission A','Individual',3,20,'OffStage',0),
      ('b','Other','Person','Mission B',' individual ',8,NULL,'OnStage',1),
      ('c','Same','Name','Mission A','Individual',7,100,'OnStage',0),
      ('d','Third','Person','Mission A','Individual',6,90,'OnStage',0),
      ('e','Fourth','Person','Mission A','Individual',5,80,'OffStage',0),
      ('f','Tied fourth','Person','Mission B','Individual',5,70,'OnStage',0),
      ('z','Fifth','Person','Mission B','Individual',4,99,'OnStage',0),
      ('a','Same','Name','Mission A','Group',100,100,'OnStage',0),
      ('g','Team','Name','Mission A','Group',200,200,'OnStage',0);`;
    const testQuery = query.replaceAll('dbo.PublishedResults', '#PublishedResults');
    const result = await pool.request().query(setup + testQuery +
      '; DELETE FROM #PublishedResults; ' + testQuery);
    assert.deepEqual(result.recordsets[0].map(row => row.ContestantID), ['b', 'a', 'c', 'd', 'e', 'f']);
    assert.deepEqual(result.recordsets[0].map(row => Number(row.Place)), [1, 1, 2, 3, 4, 4]);
    assert.deepEqual(result.recordsets[0].map(row => Number(row.TotalPoints)), [8, 8, 7, 6, 5, 5]);
    assert.equal(result.recordsets[0].find(row => row.ContestantID === 'a').PublishedEvents, 2);
    assert.deepEqual(result.recordsets[1], []);
    await pool.request().query(query);
    console.log('PASS: first four places in order, ties at first and fourth, fifth excluded, combined stages, WalkOver points, group exclusion, empty report, and live read-only query.');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
