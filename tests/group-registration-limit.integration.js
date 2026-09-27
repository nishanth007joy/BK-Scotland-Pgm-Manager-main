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
    for (const mode of ['three', 'fourth-leader', 'fourth-participant', 'edit-fourth', 'edit-existing']) {
      const tx = new sql.Transaction(pool);
      let aborted = false;
      tx.on('rollback', () => { aborted = true; });
      await tx.begin();
      try {
        await new sql.Request(tx).query(fs.readFileSync('sql/limit-group-registrations.sql', 'utf8'));
        const person = randomUUID();
        const groupIDs = Array.from({ length: 4 }, () => randomUUID());
        async function add(index, leader, participant) {
          await new sql.Request(tx).input('id', sql.NVarChar(50), groupIDs[index])
            .input('leader', sql.NVarChar(50), leader).input('participant', sql.NVarChar(50), participant)
            .query(`INSERT INTO dbo.GroupContestants
              (ID,GroupName,AgeGroup,Mission,Region,GroupLeader,GroupLeaderID,Participant9,Participant9ID)
              VALUES (@id,'Limit test','11-13','Test mission','Test region','Leader',@leader,'Participant',@participant);`);
        }
        await add(0, person, null);
        await add(1, randomUUID(), person);
        await add(2, randomUUID(), person);
        if (mode === 'three') continue;
        if (mode === 'edit-existing') {
          await new sql.Request(tx).input('id', sql.NVarChar(50), groupIDs[0])
            .query("UPDATE dbo.GroupContestants SET Comments='Still three' WHERE ID=@id;");
          continue;
        }
        let error;
        try {
          if (mode === 'fourth-leader') await add(3, person, null);
          if (mode === 'fourth-participant') await add(3, randomUUID(), person);
          if (mode === 'edit-fourth') {
            await add(3, randomUUID(), null);
            await new sql.Request(tx).input('id', sql.NVarChar(50), groupIDs[3])
              .input('person', sql.NVarChar(50), person)
              .query('UPDATE dbo.GroupContestants SET Participant1ID=@person WHERE ID=@id;');
          }
        } catch (caught) { error = caught; }
        assert.equal(error?.number, 51005, `${mode} must reject a fourth group registration`);
      } finally { if (!aborted) await tx.rollback(); }
    }
    console.log('Group limit checks passed: three allowed, fourth leader/participant rejected, edits enforced (rolled back).');
  } finally { await pool.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
