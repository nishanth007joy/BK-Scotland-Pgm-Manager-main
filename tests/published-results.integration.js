// Exercise the actual save query using temporary SQL tables only.
const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
const routes = {};
let query, inputs;
require('../results-routes')({
  get() {},
  post(path, middleware, handler) { routes[path] = handler; },
}, {
  dbReady: Promise.resolve(), sql, authMiddleware() {},
  isAdmin: req => req.session.username === 'admin',
  db: { request() {
    inputs = [];
    return {
      input(...args) { inputs.push(args); return this; },
      async query(text) { query = text; return { recordset: [{}] }; },
    };
  } },
});
const columns = 'EventID, EventName, EventAgeGroup, IndividualGroup, OnStageOffStage, ContestantID, ContestantFirstName, ContestantLastName, ContestantMission, ChestNo';
const setup = [
  'SELECT TOP (0) ' + columns + ' INTO #EventRegistrations FROM dbo.EventRegistrations;',
  'SELECT TOP (0) ' + columns + ', EventAttendence, Score, CheckedApproved, CheckedApprovedby, ScoreLastEditedBy, CAST(NULL AS varchar(6)) AS Place, CAST(NULL AS int) AS Points, CAST(NULL AS nvarchar(max)) AS Comments INTO #PrePubResults FROM dbo.PrePubResults;',
  'SELECT TOP (0) ' + columns + ', Score, Place, Points, ScoreLastEditedBy, ApprovedBy, ApprovedAt, CAST(0 AS bit) AS IsWalkOver INTO #PublishedResults FROM dbo.PublishedResults;',
  'CREATE TABLE #EventPoints (IndividualGroup varchar(10), OnStageOffStage varchar(10), FirstPlace int, SecondPlace int, ThirdPlace int, WalkOver int);',
  "INSERT INTO #EventPoints VALUES ('Individual','OnStage',5,3,1,5);",
  "INSERT INTO #EventRegistrations VALUES ('test-event','Test','8-10','Individual','OnStage','one','One','Test','Mission','1'), ('test-event','Test','8-10','Individual','OnStage','two','Two','Test','Mission','2');",
  'INSERT INTO #PrePubResults SELECT ' + columns + ", 'Completed', CASE ContestantID WHEN 'one' THEN 10 ELSE 20 END, 'approved', 'reviewer', 'scorer', NULL, NULL, NULL FROM #EventRegistrations;",
].join('\n');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    for (const [username, attendance, score, originalScore, expectedError] of [
      ['user', 'Completed', 30, 10, 51021],
      ['admin', 'Completed', 30, 10, null],
      ['admin', 'NoShow', null, 10, null],
      ['admin', 'Completed', 30, 9, 51022],
    ]) {
      await routes['/api/results']({
        session: { username }, body: {
          EventID: 'test-event', EventAgeGroup: '8-10', ContestantID: 'one',
          EventAttendence: attendance, Score: score, OriginalScore: originalScore,
          OriginalAttendence: 'Completed', isAdmin: true,
        },
      }, { json() {}, status() { return this; } });
      assert.equal(inputs.find(row => row[0] === 'isAdmin')[2], username === 'admin');
      const request = pool.request();
      for (const args of inputs) request.input(...args);
      const isolated = query.replace(/dbo\.(EventRegistrations|PrePubResults|PublishedResults|EventPoints)/g, '#$1');
      try {
        const result = await request.query(setup + isolated + '\nSELECT ContestantID, Place, Points, ApprovedBy FROM #PublishedResults ORDER BY Points DESC;');
        assert.equal(expectedError, null, 'Expected save to be rejected');
        const winners = result.recordsets.at(-1);
        assert.equal(winners[0].ContestantID, attendance === 'NoShow' ? 'two' : 'one');
        assert.equal(winners[0].Points, 5);
        assert.equal(winners[0].ApprovedBy, 'admin');
        assert.equal(winners.length, attendance === 'NoShow' ? 1 : 2);
      } catch (error) {
        if (!expectedError) throw error;
        assert.equal(error.number, expectedError);
      }
    }
    console.log('PASS: non-admin rejected despite posted admin flag; admin score and NoShow corrections recalculate places; stale edits rejected.');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
