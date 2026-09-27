// Run after sql/prepub-results-entry.sql: node tests/results-entry.integration.js
// Uses temporary fixtures in transactions; no test records are committed.
const assert = require('node:assert/strict');
const crypto = require('crypto');
const sql = require('mssql');
process.loadEnvFile('.env');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    for (const scenario of ['group source', 'save', 'no show', 'stale', 'approved', 'missing', 'approval constraint', 'duplicate',
      'approve and publish', 'individual points', 'scorer approval blocked', 'last editor approval blocked',
      'reviewed self approval blocked', 'stale review blocked',
      'missing scorer rejected', 'missing points rule']) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      let rolledBack = false;
      tx.on('rollback', () => { rolledBack = true; });
      try {
        await new sql.Request(tx).query(require('fs').readFileSync('sql/decimal-result-scores.sql', 'utf8'));
        await new sql.Request(tx).query(require('fs').readFileSync('sql/decimal-result-scores.sql', 'utf8'));
        await new sql.Request(tx).query(require('fs').readFileSync('sql/walkover-results.sql', 'utf8'));
        await new sql.Request(tx).query(require('fs').readFileSync('sql/result-score-comments.sql', 'utf8'));
        const prefix = 'result-test-' + crypto.randomUUID();
        const request = () => new sql.Request(tx).input('prefix', sql.NVarChar(50), prefix);
        const itemType = scenario === 'individual points' ? 'Individual' : 'Group';
        const stage = scenario === 'missing points rule' ? 'OffStage' : 'OnStage';
        await request().input('itemType', sql.Char(10), itemType)
          .input('stage', sql.Char(10), stage).query(`INSERT INTO dbo.EventRegistrations
          (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
           ContestantFirstName,ContestantLastName,ContestantMission,ChestNo)
          VALUES (@prefix,'Test event','Test age',@itemType,@stage,@prefix+'a','Same','Name','Test','1'),
          (@prefix,'Test event','Test age',@itemType,@stage,@prefix+'b','Same','Name','Test','2'),
          (@prefix+'x','Other event','Other age','Group','OffStage',@prefix+'c','Other','Name','Test','3');`);
        if (scenario === 'group source') {
          await request().query(`DELETE FROM dbo.EventRegistrations WHERE EventID=@prefix;
            INSERT INTO dbo.Events (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage)
            VALUES (@prefix,'Test group event','Test age','Group','OnStage');
            INSERT INTO dbo.GroupContestants (ID,GroupName,EventID,EventName,AgeGroup,Mission,Region,ChestNo,GroupLeader,GroupLeaderID)
            VALUES (@prefix+'a','Same',@prefix,'Test group event','Test age','Test','Test','1','Test leader',@prefix+'c'),
              (@prefix+'b','Same',@prefix,'Test group event','Test age','Test','Test','2','Other leader',@prefix+'d');`);
        }
        const routes = new Map();
        const auth = () => {};
        const add = (method) => (path, middleware, handler) => { assert.equal(middleware, auth); routes.set(method + path, handler); };
        require('../results-routes')({ get: add('GET'), post: add('POST') }, {
          db: { request: () => new sql.Request(tx) }, dbReady: Promise.resolve(), sql, authMiddleware: auth, isAdmin: () => false,
        });
        async function call(method, path, body = {}, username = 'First tester', query = {}) {
          const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
          await routes.get(method + path)({ body, query, session: { username } }, res);
          return res;
        }
        const body = { EventID: prefix, EventAgeGroup: 'Test age', ContestantID: prefix + 'a',
          EventAttendence: 'Completed', OriginalAttendence: null, Score: 0, OriginalScore: null,
          CheckedApproved: 'approved', ContestantFirstName: 'Forged name' };
        for (const invalid of ['', null, -1, 1.001, 2147483648]) {
          assert.equal((await call('POST', '/api/results', { ...body, Score: invalid })).code, 400);
        }
        assert.equal((await call('POST', '/api/results', { ...body, EventAttendence: 'NoShow', Score: 0 })).code, 400);
        assert.equal((await call('POST', '/api/results', { ...body, EventAttendence: 'Absent' })).code, 400);
        const options = await call('GET', '/api/results/options');
        assert.ok(options.body.events.some((e) => e.EventID === prefix));
        const filter = { EventID: prefix, EventAgeGroup: 'Test age' };
        const list = await call('GET', '/api/results/participants', {}, 'First tester', filter);
        assert.equal(list.body.participants.length, 2);
        assert.notEqual(list.body.participants[0].ContestantID, list.body.participants[1].ContestantID);
        assert.ok(list.body.participants.every((r) => r.ResultExists === 0 && r.EventAttendence === null));
        const first = await call('POST', '/api/results', body);
        assert.equal(first.code, 200);
        assert.equal(first.body.result.Score, 0);
        assert.equal(first.body.result.CheckedApproved, 'not approved');
        assert.equal(first.body.result.ScoreLastEditedBy, 'First tester');
        const stored = (await request().query('SELECT * FROM dbo.PrePubResults WHERE EventID=@prefix')).recordset[0];
        assert.equal(stored.ContestantFirstName, 'Same'); assert.equal(stored.CheckedApprovedby, null);
        assert.equal(stored.ScoreLastEditedBy, 'First tester');
        assert.equal(stored.EventAttendence.trim(), 'Completed');
        const partiallyEntered = await call('GET', '/api/results/options');
        assert.ok(partiallyEntered.body.events.some(e => e.EventID === prefix));
        const publishOptions = await call('GET', '/api/results/publish-options');
        assert.ok(publishOptions.body.events.some((row) => row.EventID === prefix));
        if (scenario === 'save') {
          await request().query("UPDATE dbo.PrePubResults SET Comments='Existing comment' WHERE EventID=@prefix");
          const revised = await call('POST', '/api/results', { ...body, Score: 42.75, OriginalScore: 0, OriginalAttendence: 'Completed' }, 'Second tester');
          assert.equal(revised.code, 200); assert.equal(revised.body.result.Score, 42.75);
          assert.equal(revised.body.result.Comments, 'Existing comment\r\nOld score: 0.00, New score: 42.75');
          const reloaded = await call('GET', '/api/results/participants', {}, 'Second tester', filter);
          assert.equal(reloaded.body.participants.find((r) => r.ContestantID === body.ContestantID).Score, 42.75);
          assert.equal(reloaded.body.participants.find((r) => r.ContestantID === body.ContestantID).ScoreLastEditedBy, 'Second tester');
          const decimalEdit = await call('POST', '/api/results', { ...body, Score: 43.25,
            OriginalScore: 42.75, OriginalAttendence: 'Completed' });
          assert.equal(decimalEdit.code, 200);
          assert.equal(decimalEdit.body.result.Score, 43.25);
          assert.equal(decimalEdit.body.result.Comments, 'Existing comment\r\nOld score: 0.00, New score: 42.75\r\nOld score: 42.75, New score: 43.25');
          assert.equal((await call('POST', '/api/results', { ...body, Score: 44.25,
            OriginalScore: 43.24, OriginalAttendence: 'Completed' })).code, 409);
        } else if (scenario === 'no show') {
          const newNoShow = await call('POST', '/api/results', { ...body, ContestantID: prefix + 'b',
            EventAttendence: 'NoShow', Score: null });
          assert.equal(newNoShow.code, 200);
          assert.equal(newNoShow.body.result.EventAttendence, 'NoShow');
          assert.equal(newNoShow.body.result.Score, null);
          const noShow = await call('POST', '/api/results', { ...body, EventAttendence: 'NoShow', Score: null,
            OriginalScore: 0, OriginalAttendence: 'Completed' });
          assert.equal(noShow.code, 200);
          assert.equal(noShow.body.result.EventAttendence, 'NoShow');
          assert.equal(noShow.body.result.Score, null);
          const reloaded = await call('GET', '/api/results/participants', {}, 'First tester', filter);
          const participant = reloaded.body.participants.find((r) => r.ContestantID === body.ContestantID);
          assert.equal(participant.EventAttendence.trim(), 'NoShow'); assert.equal(participant.Score, null);
          const pendingAfter = await call('GET', '/api/results/options');
          assert.ok(!pendingAfter.body.events.some(e => e.EventID === prefix));
          assert.ok(pendingAfter.body.events.some(e => e.EventID === prefix + 'x'));
          const completed = await call('POST', '/api/results', { ...body, Score: 9, OriginalScore: null,
            OriginalAttendence: 'NoShow' });
          assert.equal(completed.code, 200); assert.equal(completed.body.result.Score, 9);
          assert.equal((await call('POST', '/api/results', { ...body, Score: 9, OriginalScore: null,
            OriginalAttendence: 'NoShow' })).code, 409);
        } else if (scenario === 'stale') {
          assert.equal((await call('POST', '/api/results', { ...body, Score: 9, OriginalAttendence: 'Completed' })).code, 409);
        } else if (scenario === 'approved') {
          await request().query("UPDATE dbo.PrePubResults SET CheckedApproved='approved' WHERE EventID=@prefix");
          assert.equal((await call('POST', '/api/results', { ...body, Score: 9, OriginalScore: 0,
            OriginalAttendence: 'Completed' })).code, 403);
        } else if (scenario === 'missing') {
          assert.equal((await call('POST', '/api/results', { ...body, ContestantID: prefix + 'z' })).code, 409);
        } else if (scenario === 'approval constraint') {
          await assert.rejects(() => request().query("UPDATE dbo.PrePubResults SET CheckedApproved='pending' WHERE EventID=@prefix"), (error) => error.number === 547);
        } else if (['group source', 'approve and publish', 'individual points'].includes(scenario)) {
          await request().input('itemType', sql.Char(10), itemType).query(`INSERT INTO dbo.EventRegistrations
            (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
             ContestantFirstName,ContestantLastName,ContestantMission,ChestNo)
            VALUES (@prefix,'Test event','Test age',@itemType,'OnStage',@prefix+'c','Third','Name','Test','3'),
              (@prefix,'Test event','Test age',@itemType,'OnStage',@prefix+'d','Fourth','Name','Test','4');`);
          const scores = [17.25, 25.75, 17.5];
          for (let i = 0; i < 3; i++) {
            assert.equal((await call('POST', '/api/results', { ...body,
              ContestantID: prefix + 'bcd'[i], Score: scores[i] })).code, 200);
          }
          const approval = await call('POST', '/api/results/approve', { ...filter,
            ReviewedResults: [['a', 0], ['b', 17.25], ['c', 25.75], ['d', 17.5]].map(([id, score]) => ({
              ContestantID: prefix + id, Score: score, EventAttendence: 'Completed',
            })) }, 'Approver');
          assert.equal(approval.code, 200, approval.body.message);
          assert.equal(approval.body.publishedCount, 3);
          const published = (await request().query(`SELECT ContestantID,Score,Place,Points,
            ApprovedBy,ScoreLastEditedBy,CertificatePrinted FROM dbo.PublishedResults
            WHERE EventID=@prefix ORDER BY Score DESC,ContestantID`)).recordset;
          assert.deepEqual(published.map((row) => row.Place), ['First', 'Second', 'Third']);
          assert.deepEqual(published.map((row) => row.Score), [25.75, 17.5, 17.25]);
          assert.deepEqual(published.map((row) => row.Points),
            itemType === 'Group' ? [10, 7, 5] : [5, 3, 1]);
          assert.ok(published.every((row) => row.ApprovedBy === 'Approver'
            && row.ScoreLastEditedBy === 'First tester' && row.CertificatePrinted === 'No'));
          const approved = (await request().query(`SELECT DISTINCT CheckedApprovedby
            FROM dbo.PrePubResults WHERE EventID=@prefix`)).recordset;
          assert.deepEqual(approved.map((row) => row.CheckedApprovedby), ['Approver']);
        } else if (scenario === 'scorer approval blocked' || scenario === 'last editor approval blocked') {
          assert.equal((await call('POST', '/api/results', { ...body,
            ContestantID: prefix + 'b', Score: 12 })).code, 200);
          if (scenario === 'last editor approval blocked') {
            assert.equal((await call('POST', '/api/results', { ...body, Score: 1,
              OriginalScore: 0, OriginalAttendence: 'Completed' }, 'Editor')).code, 200);
          }
          const review = [['a', scenario === 'last editor approval blocked' ? 1 : 0], ['b', 12]]
            .map(([id, score]) => ({ ContestantID: prefix + id, Score: score,
              EventAttendence: 'Completed' }));
          assert.equal((await call('POST', '/api/results/approve', { ...filter,
            ReviewedResults: review }, scenario === 'scorer approval blocked'
            ? 'First tester' : 'Editor')).code, 409);
        } else if (scenario === 'reviewed self approval blocked' || scenario === 'stale review blocked') {
          assert.equal((await call('POST', '/api/results', { ...body,
            ContestantID: prefix + 'b', Score: 12 })).code, 200);
          const review = [['a', scenario === 'stale review blocked' ? 99 : 0], ['b', 12]]
            .map(([id, score]) => ({ ContestantID: prefix + id,
              Score: score, EventAttendence: 'Completed' }));
          assert.equal((await call('POST', '/api/results/approve', { ...filter,
            ReviewedResults: review }, scenario === 'reviewed self approval blocked'
            ? 'First tester' : 'Approver')).code, 409);
        } else if (scenario === 'missing scorer rejected') {
          await assert.rejects(() => request().query(`UPDATE dbo.PrePubResults
            SET ScoreLastEditedBy=NULL WHERE EventID=@prefix`), (error) => error.number === 547);
        } else if (scenario === 'missing points rule') {
          assert.equal((await call('POST', '/api/results', { ...body,
            ContestantID: prefix + 'b', Score: 12 })).code, 200);
          const review = [['a', 0], ['b', 12]].map(([id, score]) => ({
            ContestantID: prefix + id, Score: score, EventAttendence: 'Completed',
          }));
          const approval = await call('POST', '/api/results/approve', { ...filter,
            ReviewedResults: review }, 'Approver');
          assert.equal(approval.code, 409);
          assert.match(approval.body.message, /matching points rule/);
        } else {
          await assert.rejects(() => request().query('INSERT INTO dbo.PrePubResults SELECT * FROM dbo.PrePubResults WHERE EventID=@prefix'), (error) => [2601, 2627].includes(error.number));
        }
        console.log('PASS: ' + scenario);
      } finally { if (!rolledBack) await tx.rollback(); }
    }
  } finally { await pool.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
