const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const sql = require('mssql');
process.loadEnvFile('.env');
(async () => {
  const pool = await sql.connect({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'CSMEGB-Scotland', options: { encrypt: false, trustServerCertificate: true } });
  try {
    for (const mode of ['three each', 'fourth', 'edit fourth', 'edit existing', 'bulk fourth']) {
      const tx = new sql.Transaction(pool);
      let aborted = false;
      tx.on('rollback', () => { aborted = true; });
      await tx.begin();
      try {
        await new sql.Request(tx).query(fs.readFileSync('sql/limit-individual-registrations.sql', 'utf8'));
        await new sql.Request(tx).query(fs.readFileSync('sql/limit-group-registrations.sql', 'utf8'));
        const person = randomUUID();
        const ids = Array.from({ length: 5 }, () => randomUUID());
        const request = () => new sql.Request(tx).input('person', sql.NVarChar(50), person);
        async function add(index, contestant = person) {
          await request().input('event', sql.NVarChar(50), ids[index])
            .input('contestant', sql.NVarChar(50), contestant)
            .input('stage', sql.Char(10), index % 2 ? 'OffStage' : 'OnStage')
            .query(`INSERT INTO dbo.EventRegistrations
              (EventID,EventName,EventAgeGroup,IndividualGroup,OnStageOffStage,ContestantID,
               ContestantFirstName,ContestantLastName,ContestantMission,ChestNo)
              VALUES (@event,'Limit test','11-13','Individual',@stage,@contestant,'Test','Person','Test','1');`);
        }
        for (let i = 0; i < 3; i++) {
          await add(i);
          await request().input('id', sql.NVarChar(50), randomUUID()).query(`INSERT INTO dbo.GroupContestants
            (ID,GroupName,AgeGroup,Mission,Region,GroupLeader,GroupLeaderID)
            VALUES (@id,'Limit test','11-13','Test','Test','Test Person',@person);`);
        }
        if (mode === 'three each') {
          const counts = (await request().query(`SELECT
            (SELECT COUNT(*) FROM dbo.EventRegistrations WHERE ContestantID=@person) AS IndividualCount,
            (SELECT COUNT(*) FROM dbo.GroupContestants WHERE GroupLeaderID=@person) AS GroupCount;`)).recordset[0];
          assert.equal(counts.IndividualCount, 3); assert.equal(counts.GroupCount, 3);
        } else if (mode === 'edit existing') {
          await request().query("UPDATE dbo.EventRegistrations SET Comments='Still three' WHERE ContestantID=@person;");
        } else {
          let error;
          try {
            if (mode === 'fourth') await add(3);
            if (mode === 'edit fourth') {
              await add(3, randomUUID());
              await request().input('event', sql.NVarChar(50), ids[3])
                .query('UPDATE dbo.EventRegistrations SET ContestantID=@person WHERE EventID=@event;');
            }
            if (mode === 'bulk fourth') {
              await add(3, randomUUID()); await add(4, randomUUID());
              await request().input('event1', sql.NVarChar(50), ids[3]).input('event2', sql.NVarChar(50), ids[4])
                .query('UPDATE dbo.EventRegistrations SET ContestantID=@person WHERE EventID IN (@event1,@event2);');
            }
          } catch (caught) { error = caught; }
          assert.equal(error?.number, 51004, mode + ' must reject exceeding three individual events');
        }
        console.log('PASS: ' + mode);
      } finally { if (!aborted) await tx.rollback(); }
    }
    console.log('Individual limits and separate group allowance passed. Test records rolled back.');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
