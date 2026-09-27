const ageCategoryOrder = require('./age-category-order');
const { eligible } = require('./public/group-eligibility');

module.exports = function registerGroupContestants(app, { db, dbReady, sql, authMiddleware }) {
  app.get('/api/group-contestants', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const participants = Array.from({ length: 9 }, (_, i) => `Participant${i + 1}, Participant${i + 1}ID`).join(', ');
      const result = await db.request().query(`SELECT ID, GroupName, EventID, EventName,
        AgeGroup, Mission, Region, RTRIM(ChestNo) AS ChestNo, GroupLeader, GroupLeaderID,
        ${participants}, Comments FROM dbo.GroupContestants ORDER BY GroupName, EventName, ID;`);
      return res.json({ groups: result.recordset });
    } catch (error) {
      console.error('List-group-contestants database error:', error);
      return res.status(500).json({ message: 'Unable to load group contestants.' });
    }
  });
  app.get('/api/group-contestant-events', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.request().query(`SELECT EventID, EventName, EventAgeGroup
        FROM dbo.Events WHERE LTRIM(RTRIM(IndividualGroup)) = 'Group'
        ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID;`);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('List-group-events database error:', error);
      return res.status(500).json({ message: 'Unable to load group events.' });
    }
  });
  const saveGroup = async (req, res) => {
    const editing = req.method === 'PUT';
    const original = req.body?.Original;
    if (editing && (!original || typeof original.ID !== 'string' || !original.ID || original.ID.length > 50))
      return res.status(400).json({ message: 'Reload the group registration before editing.' });
    const data = {};
    const required = ['EventID', 'Mission', 'Region', 'GroupLeaderID'];
    const memberFields = ['GroupLeaderID', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}ID`)];
    for (const field of [...required, 'ChestNo', 'Comments', ...memberFields.slice(1)]) {
      const value = req.body?.[field];
      if (value != null && typeof value !== 'string') return res.status(400).json({ message: `${field} must be text.` });
      data[field] = (value || '').trim();
      if ((required.includes(field) && !data[field]) || data[field].length > (field === 'ChestNo' ? 10 : 50)) {
        return res.status(400).json({ message: `Enter a valid ${field}.` });
      }
    }
    const ids = memberFields.map(field => data[field]).filter(Boolean);
    if (new Set(ids).size !== ids.length) return res.status(400).json({ message: 'Select each contestant only once, including the group leader.' });
    try {
      await dbReady;
      const events = (await db.request().input('eventID', sql.NVarChar(50), data.EventID)
        .query("SELECT EventName, EventAgeGroup FROM dbo.Events WHERE EventID=@eventID AND LTRIM(RTRIM(IndividualGroup))='Group';")).recordset;
      if (events.length !== 1) return res.status(400).json({ message: 'Select an existing Group event with a unique ID.' });
      data.AgeGroup = events[0].EventAgeGroup.trim();
      const categories = (await db.request().query('SELECT AgeRange FROM dbo.AgeCategory;')).recordset.map(row => row.AgeRange);
      const lookup = db.request();
      ids.forEach((id, i) => lookup.input(`member${i}`, sql.NVarChar(50), id));
      const members = (await lookup.query(`SELECT ID, [First Name] AS FirstName, [Last Name] AS LastName, Mission, AgeGroup
        FROM dbo.Contestants WHERE ID IN (${ids.map((_, i) => `@member${i}`).join(',')});`)).recordset;
      const leaders = members.filter(member => member.ID === data.GroupLeaderID);
      if (leaders.length !== 1) return res.status(400).json({ message: 'Select an existing contestant with a unique ID as group leader.' });
      data.GroupName = `${leaders[0].FirstName.trim()} ${leaders[0].LastName.trim()} & Team`;
      if (data.GroupName.length > 50) return res.status(400).json({ message: 'The group leader name plus " & Team" exceeds the group name limit of 50 characters.' });
      const request = db.request();
      const columns = ['GroupName', 'AgeGroup', 'Mission', 'Region', 'ChestNo', 'Comments'];
      for (const field of columns) {
        request.input(field, field === 'AgeGroup' ? sql.NVarChar(50) : field === 'ChestNo' ? sql.NChar(10) : sql.VarChar(50), data[field] || null);
      }
      for (const field of memberFields) {
        const matches = members.filter(member => member.ID === data[field]);
        if (data[field] && matches.length !== 1) return res.status(400).json({ message: 'Select existing contestants with unique IDs. Reload the page and try again.' });
        const member = matches[0];
        if (member && !eligible(member, data.Mission, data.AgeGroup, categories, field === 'GroupLeaderID', events[0].EventName)) {
          return res.status(400).json({ message: data.AgeGroup.toLowerCase() === 'all ages'
            ? 'The group leader and participants must belong to the selected mission.'
            : /^margam\s*kali$/i.test(String(events[0].EventName).trim()) && data.AgeGroup.toLowerCase() === 'under 30'
            ? 'Margam Kali Under 30 requires contestants from the selected mission with an age category other than 30 and above.'
            : field === 'GroupLeaderID'
            ? 'The group leader must belong to the selected mission and event age group.'
            : 'Participants must belong to the selected mission and either the event age group or the age group immediately below it.' });
        }
        const name = member ? `${member.FirstName.trim()} ${member.LastName.trim()}` : null;
        if (name && name.length > 50) return res.status(400).json({ message: `The name of contestant ${data[field]} exceeds the group participant limit of 50 characters.` });
        const nameField = field.slice(0, -2);
        columns.push(nameField, field);
        request.input(nameField, sql.VarChar(50), name);
        request.input(field, sql.NVarChar(50), data[field] || null);
      }
      request.input('EventID', sql.NVarChar(50), data.EventID);
      if (editing) {
        request.input('ID', sql.NVarChar(50), original.ID);
        const compareFields = [...columns, 'EventID', 'EventName'];
        for (const field of compareFields) {
          if (original[field] != null && (typeof original[field] !== 'string' || original[field].length > 50))
            return res.status(400).json({ message: 'Reload the group registration before editing.' });
          request.input(`old${field}`, sql.NVarChar(50), original[field] || null);
        }
        await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; BEGIN TRY
          IF EXISTS(SELECT 1 FROM dbo.PrePubResults WITH (UPDLOCK,HOLDLOCK) WHERE ContestantID=@ID)
            OR EXISTS(SELECT 1 FROM dbo.PublishedResults WITH (UPDLOCK,HOLDLOCK) WHERE ContestantID=@ID)
            THROW 51060, 'This group has results and cannot be changed.', 1;
          IF (SELECT COUNT(*) FROM dbo.GroupContestants WITH (UPDLOCK,HOLDLOCK) WHERE ID=@ID)<>1
            THROW 51060, 'Group registration is missing or ambiguous.', 1;
          UPDATE g SET ${columns.map(field => `[${field}]=@${field}`).join(',')}, EventID=e.EventID, EventName=e.EventName
          FROM dbo.GroupContestants g CROSS JOIN dbo.Events e WHERE g.ID=@ID
            AND ${compareFields.map(field => `ISNULL(RTRIM(g.[${field}]),'')=ISNULL(RTRIM(@old${field}),'')`).join(' AND ')}
            AND e.EventID=@EventID AND RTRIM(e.IndividualGroup)='Group' AND e.EventAgeGroup=@AgeGroup
            AND (SELECT COUNT(*) FROM dbo.Events WHERE EventID=@EventID)=1;
          IF @@ROWCOUNT<>1 THROW 51060, 'Group registration changed. Reload before saving.', 1;
          COMMIT TRANSACTION;
        END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; THROW; END CATCH;`);
        return res.json({ message: 'Group event registration updated.', id: original.ID });
      }
      const saved = await request.query(`DECLARE @saved TABLE (ID nvarchar(50));
        INSERT INTO dbo.GroupContestants (${columns.map(column => `[${column}]`).join(',')}, EventID, EventName)
        OUTPUT INSERTED.ID INTO @saved (ID)
        SELECT ${columns.map(column => `@${column}`).join(',')}, e.EventID, e.EventName
        FROM dbo.Events e WHERE e.EventID = @EventID AND LTRIM(RTRIM(e.IndividualGroup)) = 'Group'
          AND e.EventAgeGroup = @AgeGroup
          AND (SELECT COUNT(*) FROM dbo.Events WHERE EventID = @EventID) = 1;
        SELECT ID AS id FROM @saved;`);
      if (saved.recordset.length !== 1) return res.status(400).json({ message: 'Select an existing Group event with a unique ID. Reload the page and try again.' });
      const id = saved.recordset[0].id;
      return res.status(201).json({ message: `Group contestant saved. ID: ${id}.`, id });
    } catch (error) {
      if ([51060, 51063].includes(error.number)) return res.status(409).json({ message: error.message });
      if (error.number === 51005) return res.status(409).json({ message: 'A contestant can register for a maximum of 3 group events, counting both group leader and participant roles.' });
      if ([2601, 2627].includes(error.number)) return res.status(409).json({ message: 'A group contestant with these details already exists.' });
      console.error('Create-group-contestant database error:', error);
      return res.status(500).json({ message: 'Unable to save the group contestant.' });
    }
  };
  app.post('/api/group-contestants', authMiddleware, saveGroup);
  app.put('/api/group-contestants', authMiddleware, saveGroup);
};
