const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
let handler, query;
const auth = () => {};
require('../results-routes')({
  get(path, middleware, callback) {
    if (path === '/api/reports/records-without-score') { assert.equal(middleware, auth); handler = callback; }
  }, post() {},
}, { db: { request: () => ({ query: async text => { query = text; return { recordset: [] }; } }) },
  dbReady: Promise.resolve(), sql, authMiddleware: auth, isAdmin: () => false });
(async () => {
  await handler({}, { set() {}, json() {}, status() { throw new Error('Report failed'); } });
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    const setup = `
      CREATE TABLE #PrePubResults (EventID nvarchar(50), EventName varchar(50), EventAgeGroup nvarchar(50),
        IndividualGroup varchar(10), OnStageOffStage varchar(10), ContestantID nvarchar(50),
        ContestantFirstName varchar(50), ContestantLastName varchar(50), ContestantMission varchar(50),
        ChestNo nchar(10), Score int, EventAttendence varchar(20));
      INSERT INTO #PrePubResults (EventID, ContestantID, IndividualGroup, Score, EventAttendence) VALUES
        ('partial','missing','Individual',NULL,NULL),
        ('partial','scored','Individual',10,'Completed'),
        ('zero','zero','Individual',0,'Completed'),
        ('group','team','Group',NULL,'Present'),
        ('noshow','absent','Individual',NULL,'NoShow'),
        ('wo','walkover','Individual',NULL,'WalkOver'),
        ('gwo','group-walkover','Group',NULL,' WalkOver ');
    `;
    const result = await pool.request().query(setup + query.replace(/dbo\.PrePubResults/g, '#PrePubResults'));
    assert.deepEqual(result.recordset.map(row => row.ContestantID).sort(), ['absent', 'missing', 'team']);
    assert.ok(result.recordset.some(row => row.IndividualGroup === 'Individual'));
    assert.ok(result.recordset.some(row => row.IndividualGroup === 'Group'));
    const live = await pool.request().query(query);
    console.log('PASS: individual and group records without scores, partially scored events, null attendance, NoShow, zero scores, and excluded WalkOvers.');
    console.log('Live read-only query succeeded: ' + live.recordset.length + ' records without score.');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
