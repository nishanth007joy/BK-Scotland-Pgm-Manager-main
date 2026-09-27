const crypto = require('node:crypto');
const fields = ['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region', 'OnStageChestNo', 'OffStageChestNo', 'Comments'];
const memberFields = ['GroupLeader', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}`)];
const membership = memberFields.map(field => `g.${field}ID=@id`).join(' OR ');
const tables = ['EventRegistrations', 'PrePubResults', 'PublishedResults'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

module.exports = function registerAdminContestants(app, { db, dbReady, sql, requireAdmin }) {
  async function snapshot(request) {
    const result = await request.query(`
      SELECT ID AS ContestantID, [First Name] AS FirstName, [Last Name] AS LastName,
        AgeGroup, Mission, Region, OnStageChestNo, OffStageChestNo, Comments
        FROM dbo.Contestants WITH (UPDLOCK,HOLDLOCK) WHERE ID=@id;
      SELECT g.* FROM dbo.GroupContestants g WITH (UPDLOCK,HOLDLOCK)
        WHERE ${membership} ORDER BY g.ID;
      ${tables.map(table => `SELECT r.* FROM dbo.${table} r WITH (UPDLOCK,HOLDLOCK)
        WHERE (r.ContestantID=@id AND LOWER(RTRIM(r.IndividualGroup))='individual')
          OR (LOWER(RTRIM(r.IndividualGroup))='group' AND EXISTS
            (SELECT 1 FROM dbo.GroupContestants g WITH (UPDLOCK,HOLDLOCK)
             WHERE g.ID=r.ContestantID AND g.EventID=r.EventID AND (${membership})))
        ORDER BY r.EventID, r.EventAgeGroup, r.ContestantID;`).join('\n')}`);
    return { contestant: result.recordsets[0][0], groups: result.recordsets[1],
      registrations: result.recordsets[2], prepubResults: result.recordsets[3], publishedResults: result.recordsets[4] };
  }
  async function handle(req, res, saving) {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid contestant.' });
    const updated = {};
    if (saving) {
      if (req.body?.confirmed !== true || typeof req.body?.token !== 'string')
        return res.status(400).json({ message: 'Review and confirm all affected entries before saving.' });
      for (const field of fields) {
        if (typeof req.body[field] !== 'string') return res.status(400).json({ message: `${field} must be text.` });
        updated[field] = req.body[field].trim();
        if (updated[field].length > (field.endsWith('ChestNo') ? 10 : 50))
          return res.status(400).json({ message: `${field} is too long.` });
      }
      if (fields.slice(0, 5).some(field => !updated[field]))
        return res.status(400).json({ message: 'Name, age group, mission and region are required.' });
    }
    let transaction;
    try {
      await dbReady;
      transaction = new sql.Transaction(db);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const request = () => new sql.Request(transaction).input('id', sql.NVarChar(50), id);
      const data = await snapshot(request());
      if (!data.contestant) {
        await transaction.rollback(); transaction = null;
        return res.status(404).json({ message: 'Contestant not found.' });
      }
      const token = digest(data);
      if (!saving) {
        await transaction.commit(); transaction = null;
        return res.json({ ...data, token });
      }
      if (token !== req.body.token) {
        await transaction.rollback(); transaction = null;
        return res.status(409).json({ message: 'Contestant, registrations or results changed. Review the latest entries and confirm again.' });
      }
      const individualRows = [...data.registrations, ...data.prepubResults, ...data.publishedResults]
        .filter(row => String(row.IndividualGroup).trim().toLowerCase() === 'individual');
      for (const row of individualRows) {
        const stage = String(row.OnStageOffStage).trim().toLowerCase().replace(/[ -]/g, '');
        if (!['onstage', 'offstage'].includes(stage) || !updated[stage === 'onstage' ? 'OnStageChestNo' : 'OffStageChestNo']) {
          const error = new Error(`Event ${row.EventName} requires its stage chest number.`); error.number = 51061; throw error;
        }
      }
      const fullName = `${updated.FirstName} ${updated.LastName}`;
      if (data.groups.length && (fullName.length > 50 ||
        (data.groups.some(g => String(g.GroupLeaderID).trim() === id) && `${fullName} & Team`.length > 50))) {
        const error = new Error('The updated name is too long for the group participant or team name (50 characters).'); error.number = 51061; throw error;
      }
      const update = request();
      for (const field of fields) update.input(field,
        field.endsWith('ChestNo') ? sql.NChar(10) : field === 'AgeGroup' ? sql.NVarChar(50) : sql.VarChar(50), updated[field] || null);
      update.input('fullName', sql.VarChar(50), fullName);
      await update.query(`
        UPDATE dbo.Contestants SET [First Name]=@FirstName, [Last Name]=@LastName,
          AgeGroup=@AgeGroup, Mission=@Mission, Region=@Region, OnStageChestNo=@OnStageChestNo,
          OffStageChestNo=@OffStageChestNo, Comments=@Comments WHERE ID=@id;
        UPDATE g SET ${memberFields.map(field => `${field}=CASE WHEN ${field}ID=@id THEN @fullName ELSE ${field} END`).join(',')},
          GroupName=CASE WHEN GroupLeaderID=@id THEN @fullName+' & Team' ELSE GroupName END
          FROM dbo.GroupContestants g WHERE ${membership};
        ${tables.map(table => `UPDATE dbo.${table} SET ContestantFirstName=@FirstName,
          ContestantLastName=@LastName, ContestantMission=@Mission,
          ChestNo=CASE LOWER(REPLACE(REPLACE(RTRIM(OnStageOffStage),' ',''),'-',''))
            WHEN 'onstage' THEN @OnStageChestNo WHEN 'offstage' THEN @OffStageChestNo END
          WHERE ContestantID=@id AND LOWER(RTRIM(IndividualGroup))='individual';
        UPDATE r SET ContestantFirstName=g.GroupName
          FROM dbo.${table} r JOIN dbo.GroupContestants g ON g.ID=r.ContestantID AND g.EventID=r.EventID
          WHERE g.GroupLeaderID=@id AND LOWER(RTRIM(r.IndividualGroup))='group';`).join('\n')}`);
      await transaction.commit(); transaction = null;
      res.json({ message: 'Contestant details and all linked registration and result entries updated.' });
    } catch (error) {
      if (transaction) { try { await transaction.rollback(); } catch (_) {} }
      if ([51061, 51062, 51002, 51063, 2601, 2627, 1205].includes(error.number))
        return res.status(409).json({ message: error.message });
      console.error('Admin contestant update error:', error);
      res.status(500).json({ message: 'Unable to update contestant details. No changes were saved.' });
    }
  }
  app.get('/api/admin/contestants/:id', requireAdmin, (req, res) => handle(req, res, false));
  app.put('/api/admin/contestants/:id', requireAdmin, (req, res) => handle(req, res, true));
};
