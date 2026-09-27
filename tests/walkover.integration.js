// All schema and fixture changes are rolled back; no test records are committed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const sql = require('mssql');
process.loadEnvFile('.env');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    for (const scenario of ['individual', 'group', 'multiple', 'duplicate', 'self approval',
      'stale review', 'added registration', 'missing points', 'zero points', 'normal score',
      'published lock', 'admin correction', 'stale entry']) {
      const tx = new sql.Transaction(pool);
      let rolledBack = false;
      tx.on('rollback', () => { rolledBack = true; });
      await tx.begin();
      try {
        const migration = fs.readFileSync('sql/walkover-results.sql', 'utf8');
        await new sql.Request(tx).query(migration);
        await new sql.Request(tx).query(migration); // Repeat startup is safe.
        const id = 'wo-' + crypto.randomUUID();
        const type = scenario === 'group' ? 'Group' : 'Individual';
        const stage = scenario === 'missing points' ? 'Unknown' : 'OnStage';
        const points = scenario === 'zero points' ? 0 : type === 'Group' ? 13 : 6;
        const request = () => new sql.Request(tx).input('id', sql.NVarChar(50), id);
        // Distinct from FirstPlace, proving the WalkOver column is used.
        await new sql.Request(tx).input('type', sql.NVarChar(50), type).input('points', sql.Int, points)
          .query("UPDATE dbo.EventPoints SET WalkOver=@points WHERE IndividualGroup=@type AND LOWER(OnStageOffStage)='onstage';");
        const addRegistration = async suffix => request().input('contestant', sql.NVarChar(50), id + suffix)
          .input('type', sql.Char(10), type).input('stage', sql.Char(10), stage)
          .query(`INSERT INTO dbo.EventRegistrations
            (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
             ContestantFirstName,ContestantLastName,ContestantMission,ChestNo)
            VALUES (@id,'WalkOver test','Test age',@type,@stage,@contestant,'Test','Contestant','Test','1');`);
        await addRegistration('a');
        if (scenario === 'multiple') await addRegistration('b');
        if (scenario === 'duplicate') {
          // Simulate ambiguous registrations via a second source row in the query,
          // without disabling database duplicate protection.
          await addRegistration('b');
        }
        const routes = new Map();
        const auth = () => {};
        const add = method => (path, middleware, handler) => {
          assert.equal(middleware, auth); routes.set(method + path, handler);
        };
        require('../results-routes')({ get: add('GET'), post: add('POST') }, {
          db: { request: () => new sql.Request(tx) }, dbReady: Promise.resolve(), sql,
          authMiddleware: auth, isAdmin: req => req.session.username === 'admin',
        });
        async function call(method, path, body = {}, username = 'entry-user', query = {}) {
          const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
          await routes.get(method + path)({ body, query, session: { username } }, res);
          return res;
        }
        const body = { EventID: id, EventAgeGroup: 'Test age', ContestantID: id + 'a',
          EventAttendence: 'WalkOver', Score: null, OriginalScore: null, OriginalAttendence: null,
          Place: 'Third', Points: 999, ScoreLastEditedBy: 'forged-user' };
        assert.equal((await call('POST', '/api/results', { ...body, Score: 1 })).code, 400);
        const saved = await call('POST', '/api/results', body);
        if (['multiple', 'duplicate', 'missing points'].includes(scenario)) {
          assert.equal(saved.code, 409, JSON.stringify(saved.data));
          continue;
        }
        assert.equal(saved.code, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.result.Score, null);
        assert.equal(saved.data.result.EventAttendence, 'WalkOver');
        assert.equal(saved.data.result.Place, 'First');
        assert.equal(saved.data.result.Points, points);
        assert.equal(saved.data.result.ScoreLastEditedBy, 'entry-user');
        assert.equal(saved.data.result.CheckedApproved, 'not approved');
        const options = await call('GET', '/api/results/publish-options');
        assert(options.data.events.some(row => row.EventID === id));
        const participants = await call('GET', '/api/results/participants', {}, 'reviewer', { EventID: id, EventAgeGroup: 'Test age' });
        assert.equal(participants.data.participants[0].Points, points);
        if (scenario === 'stale entry') {
          assert.equal((await call('POST', '/api/results', body)).code, 409);
          continue;
        }
        if (scenario === 'normal score') {
          const changed = await call('POST', '/api/results', { ...body, EventAttendence: 'Completed', Score: 0, OriginalAttendence: 'WalkOver' });
          assert.equal(changed.code, 200, JSON.stringify(changed.data));
          assert.equal(changed.data.result.Place, null);
          assert.equal(changed.data.result.Points, null);
          continue;
        }
        if (scenario === 'added registration') await addRegistration('b');
        const review = { EventID: id, EventAgeGroup: 'Test age', ReviewedResults: [{
          ContestantID: id + 'a', EventAttendence: 'WalkOver', Score: null, Place: 'First',
          Points: scenario === 'stale review' ? points + 1 : points,
        }] };
        const published = await call('POST', '/api/results/approve', review, scenario === 'self approval' ? 'entry-user' : 'reviewer');
        if (['self approval', 'stale review', 'added registration'].includes(scenario)) {
          assert.equal(published.code, 409, JSON.stringify(published.data));
          continue;
        }
        assert.equal(published.code, 200, JSON.stringify(published.data));
        const row = (await request().query('SELECT * FROM dbo.PublishedResults WHERE EventID=@id')).recordset[0];
        assert.equal(row.Score, null); assert.equal(row.Place, 'First'); assert.equal(row.Points, points);
        assert.equal(row.IsWalkOver, true); assert.equal(row.ScoreLastEditedBy, 'entry-user');
        assert.equal(row.ApprovedBy, 'reviewer'); assert.equal(row.CertificatePrinted, 'No');
        if (['published lock', 'admin correction'].includes(scenario)) {
          const updated = await call('POST', '/api/results', {
            ...body, EventAttendence: 'Completed', Score: 12, OriginalAttendence: 'WalkOver',
          }, scenario === 'admin correction' ? 'admin' : 'entry-user');
          assert.equal(updated.code, scenario === 'admin correction' ? 200 : 403, JSON.stringify(updated.data));
          if (scenario === 'admin correction') {
            const corrected = (await request().query('SELECT * FROM dbo.PublishedResults WHERE EventID=@id')).recordset[0];
            assert.equal(corrected.Score, 12); assert.equal(corrected.IsWalkOver, false);
            assert.equal(corrected.Points, 5);
          }
        }
      } finally { if (!rolledBack) await tx.rollback(); }
      console.log('PASS: ' + scenario);
    }
    console.log('PASS: WalkOver entry, eligibility, points, review, publication, and permissions. All changes rolled back.');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
