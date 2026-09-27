// Executes the edit route's SQL in a transaction and rolls the change back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const sql = require('mssql');
process.loadEnvFile('.env');

(async () => {
  const source = fs.readFileSync('Server.js', 'utf8');
  const route = source.slice(source.indexOf("app.put('/api/contestants/:id'"));
  const match = route.match(/await request\.query\(`([\s\S]*?)`\);/);
  assert.ok(match, 'Contestant edit query is present');
  const pool = await sql.connect({
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland',
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const row = (await new sql.Request(tx).query(`SELECT TOP (1) ID AS ContestantID,
        [First Name] AS FirstName, [Last Name] AS LastName, AgeGroup, Mission, Region,
        RTRIM(OnStageChestNo) AS OnStageChestNo, RTRIM(OffStageChestNo) AS OffStageChestNo,
        Comments FROM dbo.Contestants
        WHERE NULLIF(RTRIM(OnStageChestNo),'') IS NOT NULL ORDER BY ID;`)).recordset[0];
      assert.ok(row, 'At least one contestant is available');
      const eventId = 'edit-' + crypto.randomUUID();
      await new sql.Request(tx).input('id', sql.NVarChar(50), row.ContestantID)
        .input('eventId', sql.NVarChar(50), eventId).query(`INSERT INTO dbo.EventRegistrations
          (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
           ContestantFirstName,ContestantLastName,ContestantMission,ChestNo)
          SELECT @eventId,'Edit test','Test age','Group','OnStage',ID,
            [First Name],[Last Name],Mission,OnStageChestNo FROM dbo.Contestants WHERE ID=@id;
          INSERT INTO dbo.PrePubResults
          (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
           ContestantFirstName,ContestantLastName,ContestantMission,ChestNo,
           EventAttendence,Score,ScoreLastEditedBy)
          SELECT EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
            ContestantFirstName,ContestantLastName,ContestantMission,ChestNo,
            'Completed',1,'Edit tester' FROM dbo.EventRegistrations WHERE EventID=@eventId;`);
      const updated = { ...row, FirstName: row.FirstName.slice(0, 35) + '-EditTest',
        Region: row.Region.slice(0, 38) + '-EditTest' };
      const types = { FirstName: sql.VarChar(50), LastName: sql.VarChar(50),
        AgeGroup: sql.NVarChar(50), Mission: sql.VarChar(50), Region: sql.VarChar(50),
        OnStageChestNo: sql.NChar(10), OffStageChestNo: sql.NChar(10), Comments: sql.VarChar(50) };
      const request = new sql.Request(tx).input('id', sql.NVarChar(50), row.ContestantID);
      for (const field of Object.keys(types)) {
        request.input(field, types[field], updated[field] || null);
        request.input(`original${field}`, types[field], row[field] || null);
      }
      await request.query(match[1]);
      const saved = (await new sql.Request(tx).input('id', sql.NVarChar(50), row.ContestantID)
        .query('SELECT Region FROM dbo.Contestants WHERE ID=@id')).recordset[0];
      assert.equal(saved.Region, updated.Region);
      const copied = await new sql.Request(tx).input('eventId', sql.NVarChar(50), eventId)
        .query(`SELECT ContestantFirstName FROM dbo.EventRegistrations WHERE EventID=@eventId;
          SELECT ContestantFirstName FROM dbo.PrePubResults WHERE EventID=@eventId;`);
      assert.equal(copied.recordsets[0][0].ContestantFirstName, updated.FirstName);
      assert.equal(copied.recordsets[1][0].ContestantFirstName, updated.FirstName);
      console.log('PASS: contestant edit query');
    } finally { await tx.rollback(); }
  } finally { await pool.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
