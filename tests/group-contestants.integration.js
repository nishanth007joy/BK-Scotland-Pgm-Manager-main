// Verify group saves against the existing schema, rolling back all test data.
const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await new sql.Request(tx).query(require('node:fs').readFileSync('sql/auto-number-group-contestants.sql', 'utf8'));
    let handler, listEvents, listGroups, editGroup;
    const auth = () => {};
    require('../group-contestant-routes')({ put(path, middleware, route) { editGroup = route; }, get(path, middleware, route) {
      if (path === '/api/group-contestants') { assert.equal(middleware, auth); listGroups = route; return; }
      assert.equal(path, '/api/group-contestant-events');
      assert.equal(middleware, auth);
      listEvents = route;
    }, post(path, middleware, route) {
      assert.equal(path, '/api/group-contestants');
      assert.equal(middleware, auth);
      handler = route;
    } }, { db: { request: () => new sql.Request(tx) }, dbReady: Promise.resolve(), sql, authMiddleware: auth });
    const members = (await new sql.Request(tx).query(`SELECT TOP (2) ID,
      [First Name] AS FirstName, [Last Name] AS LastName, AgeGroup, Mission, Region
      FROM dbo.Contestants c WHERE LEN(RTRIM([First Name])) + LEN(RTRIM([Last Name])) <= 42
      AND EXISTS (SELECT 1 FROM dbo.Contestants c2 WHERE c2.ID<>c.ID AND c2.Mission=c.Mission AND c2.AgeGroup=c.AgeGroup
        AND LEN(RTRIM(c2.[First Name])) + LEN(RTRIM(c2.[Last Name])) <= 42)
      ORDER BY Mission, AgeGroup, ID;`)).recordset;
    assert.equal(members.length, 2, 'Two existing contestants are needed for this test');
    const eventIDs = ['group-', 'individual-'].map(prefix => prefix + require('node:crypto').randomUUID());
    await new sql.Request(tx).input('groupID', sql.NVarChar(50), eventIDs[0])
      .input('individualID', sql.NVarChar(50), eventIDs[1]).input('age', sql.NVarChar(50), members[0].AgeGroup).query(`
        INSERT INTO dbo.Events (EventID, EventName, EventAgeGroup, IndividualGroup, OnStageOffStage)
        VALUES (@groupID, 'Group test ' + RIGHT(@groupID, 8), @age, 'Group', 'OnStage'),
          (@individualID, 'Individual test ' + RIGHT(@individualID, 8), 'Test', 'Individual', 'OnStage');`);
    let options;
    await listEvents({}, { json(body) { options = body.events; } });
    assert.ok(options.some(event => event.EventID === eventIDs[0]));
    assert.ok(!options.some(event => event.EventID === eventIDs[1]));
    const data = { GroupName: 'Group entry integration test', AgeGroup: members[0].AgeGroup,
      Mission: members[0].Mission, Region: members[0].Region, GroupLeaderID: members[0].ID,
      Participant1ID: members[1].ID, ChestNo: 'TEST-GRP', Comments: 'Rolled back', EventID: eventIDs[0], EventName: 'Untrusted name' };
    async function submit(body) {
      const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ body }, response);
      return response;
    }
    assert.equal((await submit({ ...data, GroupLeaderID: '' })).code, 400);
    assert.equal((await submit({ ...data, EventID: '' })).code, 400);
    assert.equal((await submit({ ...data, EventID: eventIDs[1] })).code, 400);
    assert.equal((await submit({ ...data, EventID: 'missing-event' })).code, 400);
    assert.equal((await submit({ ...data, ChestNo: '12345678901' })).code, 400);
    assert.equal((await submit({ ...data, Participant1ID: data.GroupLeaderID })).code, 400);
    assert.equal((await submit({ ...data, GroupLeaderID: 'missing-' + require('node:crypto').randomUUID() })).code, 400);
    assert.equal((await submit({ ...data, Mission: 'Invalid mission' })).code, 400);
    const saved = await submit({ ...data, AgeGroup: 'Untrusted age' });
    assert.equal(saved.code, 201, JSON.stringify(saved.body));
    assert.match(saved.body.id, /^G\d+$/);
    assert.ok(Number(saved.body.id.slice(1)) >= 100);
    const row = (await new sql.Request(tx).input('id', sql.NVarChar(50), saved.body.id)
      .query('SELECT * FROM dbo.GroupContestants WHERE ID=@id')).recordset[0];
    assert.equal(row.GroupName, `${members[0].FirstName.trim()} ${members[0].LastName.trim()} & Team`);
    assert.equal(row.AgeGroup, members[0].AgeGroup);
    assert.equal(row.EventID, eventIDs[0]);
    assert.equal(row.EventName, options.find(event => event.EventID === eventIDs[0]).EventName);
    assert.equal(row.GroupLeaderID, data.GroupLeaderID);
    assert.equal(row.GroupLeader, `${members[0].FirstName.trim()} ${members[0].LastName.trim()}`);
    assert.equal(row.Participant1ID, data.Participant1ID);
    assert.equal(row.Participant1, `${members[1].FirstName.trim()} ${members[1].LastName.trim()}`);
    assert.equal(row.Participant9ID, null);
    assert.equal(row.Participant9, null);
    let listed;
    await listGroups({}, { json(body) { listed = body.groups; } });
    const listedGroup = listed.find(group => group.ID === saved.body.id);
    assert.ok(listedGroup);
    assert.equal(listedGroup.EventName, row.EventName);
    assert.equal(listedGroup.Participant1ID, data.Participant1ID);
    const edited = { code: 200, status(code) { this.code=code; return this; }, json(body) { this.body=body; } };
    await editGroup({ method: 'PUT', body: { ...data, Original: listedGroup, Comments: 'Edited group' } }, edited);
    assert.equal(edited.code, 200, JSON.stringify(edited.body));
    const changed = (await new sql.Request(tx).input('id', sql.NVarChar(50), saved.body.id).query('SELECT Comments FROM dbo.GroupContestants WHERE ID=@id')).recordset[0];
    assert.equal(changed.Comments, 'Edited group');
    let editRegistration;
    require('../event-registration-edit-routes')({ get() {}, put(path, middleware, route) { assert.equal(middleware, auth); editRegistration = route; } }, { db: { request: () => new sql.Request(tx) }, dbReady: Promise.resolve(), sql, authMiddleware: auth });
    const sourceMember = (await new sql.Request(tx).query("SELECT TOP (1) ID FROM dbo.Contestants WHERE NULLIF(RTRIM(OnStageChestNo),'') IS NOT NULL ORDER BY ID")).recordset[0];
    assert.ok(sourceMember);
    await new sql.Request(tx).input('event', sql.NVarChar(50), eventIDs[0]).input('member', sql.NVarChar(50), sourceMember.ID).query(
      "INSERT INTO dbo.EventRegistrations (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,ContestantFirstName,ContestantLastName,ContestantMission,ChestNo) SELECT e.EventID,e.EventName,e.EventAgeGroup,e.IndividualGroup,e.OnStageOffStage,c.ID,c.[First Name],c.[Last Name],c.Mission,c.OnStageChestNo FROM dbo.Events e CROSS JOIN dbo.Contestants c WHERE e.EventID=@event AND c.ID=@member");
    const registration = (await new sql.Request(tx).input('event', sql.NVarChar(50), eventIDs[0]).query('SELECT * FROM dbo.EventRegistrations WHERE EventID=@event')).recordset[0];
    const response = { code: 200, status(code) { this.code=code; return this; }, json(body) { this.body=body; } };
    await editRegistration({ body: { EventID: registration.EventID, ContestantID: registration.ContestantID, Comments: 'Edited registration', Original: registration } }, response);
    assert.equal(response.code, 200, JSON.stringify(response.body));
    const updatedRegistration = (await new sql.Request(tx).input('event', sql.NVarChar(50), eventIDs[0]).query('SELECT Comments FROM dbo.EventRegistrations WHERE EventID=@event')).recordset[0];
    assert.equal(updatedRegistration.Comments, 'Edited registration');
    console.log('Group and individual registration save/edit checks passed (rolled back).');
  } finally {
    try { await tx.rollback(); } finally { await pool.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
