const ageCategoryOrder = require('./age-category-order');
const { eligible } = require('./public/group-eligibility');

module.exports = function registerGroupContestants(app, { db, dbReady, authMiddleware }) {
  app.get('/api/group-contestants', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const participants = Array.from({ length: 9 }, (_, i) =>
        `participant_${i + 1} AS "Participant${i + 1}", participant_${i + 1}_id AS "Participant${i + 1}ID"`
      ).join(', ');
      const result = await db.query(`
        SELECT id AS "ID", group_name AS "GroupName", event_id AS "EventID",
          event_name AS "EventName", age_group AS "AgeGroup", mission AS "Mission",
          region AS "Region", TRIM(chest_no) AS "ChestNo",
          group_leader AS "GroupLeader", group_leader_id AS "GroupLeaderID",
          ${participants}, comments AS "Comments"
        FROM group_contestants ORDER BY group_name, event_name, id
      `);
      return res.json({ groups: result.recordset });
    } catch (error) {
      console.error('List-group-contestants database error:', error);
      return res.status(500).json({ message: 'Unable to load group contestants.' });
    }
  });

  app.get('/api/group-contestant-events', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup"
        FROM events WHERE TRIM(individual_group) = 'Group'
        ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id
      `);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('List-group-events database error:', error);
      return res.status(500).json({ message: 'Unable to load group events.' });
    }
  });

  const memberIdFields = ['GroupLeaderID', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}ID`)];
  const memberNameFields = ['GroupLeader', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}`)];

  const saveGroup = async (req, res) => {
    const editing = req.method === 'PUT';
    const original = req.body?.Original;
    if (editing && (!original || typeof original.ID !== 'string' || !original.ID || original.ID.length > 50))
      return res.status(400).json({ message: 'Reload the group registration before editing.' });

    const data = {};
    const required = ['EventID', 'Mission', 'Region', 'GroupLeaderID'];
    for (const field of [...required, 'ChestNo', 'Comments', ...memberIdFields.slice(1)]) {
      const value = req.body?.[field];
      if (value != null && typeof value !== 'string') return res.status(400).json({ message: `${field} must be text.` });
      data[field] = (value || '').trim();
      if ((required.includes(field) && !data[field]) || data[field].length > (field === 'ChestNo' ? 10 : 50))
        return res.status(400).json({ message: `Enter a valid ${field}.` });
    }

    const ids = memberIdFields.map(f => data[f]).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ message: 'Select each contestant only once, including the group leader.' });

    try {
      await dbReady;
      // Load event info
      const evResult = await db.query(
        "SELECT event_name AS \"EventName\", event_age_group AS \"EventAgeGroup\" FROM events WHERE event_id = @eventID AND TRIM(individual_group) = 'Group'",
        { eventID: data.EventID }
      );
      if (evResult.recordset.length !== 1)
        return res.status(400).json({ message: 'Select an existing Group event with a unique ID.' });
      data.AgeGroup = evResult.recordset[0].EventAgeGroup.trim();
      const eventName = evResult.recordset[0].EventName;

      // Load age categories
      const catResult = await db.query('SELECT age_range AS "AgeRange" FROM age_categories');
      const categories = catResult.recordset.map(r => r.AgeRange);

      // Load member contestant details
      const uniqueIds = [...new Set(ids)];
      // Build parameterized IN clause
      const idParams = {};
      uniqueIds.forEach((id, i) => { idParams[`mid${i}`] = id; });
      const inClause = uniqueIds.map((_, i) => `@mid${i}`).join(', ');
      const membersResult = uniqueIds.length
        ? await db.query(
            `SELECT id AS "ID", first_name AS "FirstName", last_name AS "LastName", mission AS "Mission", age_group AS "AgeGroup"
             FROM contestants WHERE id IN (${inClause})`,
            idParams
          )
        : { recordset: [] };
      const members = membersResult.recordset;

      const leaders = members.filter(m => m.ID === data.GroupLeaderID);
      if (leaders.length !== 1)
        return res.status(400).json({ message: 'Select an existing contestant with a unique ID as group leader.' });

      data.GroupName = `${leaders[0].FirstName.trim()} ${leaders[0].LastName.trim()} & Team`;
      if (data.GroupName.length > 50)
        return res.status(400).json({ message: 'The group leader name plus " & Team" exceeds the group name limit of 50 characters.' });

      // Validate eligibility for each member
      const memberNames = {};
      for (const field of memberIdFields) {
        if (!data[field]) { memberNames[field.slice(0, -2)] = null; continue; }
        const match = members.filter(m => m.ID === data[field]);
        if (match.length !== 1)
          return res.status(400).json({ message: 'Select existing contestants with unique IDs. Reload the page and try again.' });
        const member = match[0];
        if (!eligible(member, data.Mission, data.AgeGroup, categories, field === 'GroupLeaderID', eventName)) {
          return res.status(400).json({ message: data.AgeGroup.toLowerCase() === 'all ages'
            ? 'The group leader and participants must belong to the selected mission.'
            : /^margam\s*kali$/i.test(String(eventName).trim()) && data.AgeGroup.toLowerCase() === 'under 30'
            ? 'Margam Kali Under 30 requires contestants from the selected mission with an age category other than 30 and above.'
            : field === 'GroupLeaderID'
            ? 'The group leader must belong to the selected mission and event age group.'
            : 'Participants must belong to the selected mission and either the event age group or the age group immediately below it.' });
        }
        const name = `${member.FirstName.trim()} ${member.LastName.trim()}`;
        if (name.length > 50)
          return res.status(400).json({ message: `The name of contestant ${data[field]} exceeds the group participant limit of 50 characters.` });
        memberNames[field.slice(0, -2)] = name;
      }

      const result = await db.withTransaction(async (tq) => {
        if (editing) {
          const hasResults = await tq(
            'SELECT 1 FROM prepub_results WHERE contestant_id = @id UNION ALL SELECT 1 FROM published_results WHERE contestant_id = @id LIMIT 1',
            { id: original.ID }
          );
          if (hasResults.recordset.length)
            throw Object.assign(new Error('[51060] This group has results and cannot be changed.'), {});

          const upd = await tq(`
            UPDATE group_contestants SET
              group_name = @groupName, event_id = @eventId, event_name = @eventName,
              age_group = @ageGroup, mission = @mission, region = @region,
              chest_no = @chestNo, group_leader = @groupLeader, group_leader_id = @groupLeaderId,
              participant_1 = @p1, participant_1_id = @p1id,
              participant_2 = @p2, participant_2_id = @p2id,
              participant_3 = @p3, participant_3_id = @p3id,
              participant_4 = @p4, participant_4_id = @p4id,
              participant_5 = @p5, participant_5_id = @p5id,
              participant_6 = @p6, participant_6_id = @p6id,
              participant_7 = @p7, participant_7_id = @p7id,
              participant_8 = @p8, participant_8_id = @p8id,
              participant_9 = @p9, participant_9_id = @p9id,
              comments = @comments
            WHERE id = @id RETURNING id
          `, {
            id: original.ID, groupName: data.GroupName, eventId: data.EventID, eventName,
            ageGroup: data.AgeGroup, mission: data.Mission, region: data.Region,
            chestNo: data.ChestNo || null,
            groupLeader: memberNames.GroupLeader, groupLeaderId: data.GroupLeaderID,
            p1: memberNames.Participant1 || null, p1id: data.Participant1ID || null,
            p2: memberNames.Participant2 || null, p2id: data.Participant2ID || null,
            p3: memberNames.Participant3 || null, p3id: data.Participant3ID || null,
            p4: memberNames.Participant4 || null, p4id: data.Participant4ID || null,
            p5: memberNames.Participant5 || null, p5id: data.Participant5ID || null,
            p6: memberNames.Participant6 || null, p6id: data.Participant6ID || null,
            p7: memberNames.Participant7 || null, p7id: data.Participant7ID || null,
            p8: memberNames.Participant8 || null, p8id: data.Participant8ID || null,
            p9: memberNames.Participant9 || null, p9id: data.Participant9ID || null,
            comments: data.Comments || null,
          });
          if (!upd.rowCount)
            throw Object.assign(new Error('[51060] Group registration changed. Reload before saving.'), {});
          return { id: original.ID };
        }

        // INSERT path
        const seqRow = await tq("SELECT nextval('group_contestant_id_seq') AS seq");
        const newId = 'G' + seqRow.recordset[0].seq;
        await tq("INSERT INTO participants (id, participant_type) VALUES (@id, 'group')", { id: newId });
        const ins = await tq(`
          INSERT INTO group_contestants (
            id, group_name, event_id, event_name, age_group, mission, region, chest_no,
            group_leader, group_leader_id,
            participant_1, participant_1_id, participant_2, participant_2_id,
            participant_3, participant_3_id, participant_4, participant_4_id,
            participant_5, participant_5_id, participant_6, participant_6_id,
            participant_7, participant_7_id, participant_8, participant_8_id,
            participant_9, participant_9_id, comments
          ) VALUES (
            @id, @groupName, @eventId, @eventName, @ageGroup, @mission, @region, @chestNo,
            @groupLeader, @groupLeaderId,
            @p1, @p1id, @p2, @p2id, @p3, @p3id, @p4, @p4id,
            @p5, @p5id, @p6, @p6id, @p7, @p7id, @p8, @p8id, @p9, @p9id, @comments
          ) RETURNING id
        `, {
          id: newId, groupName: data.GroupName, eventId: data.EventID, eventName,
          ageGroup: data.AgeGroup, mission: data.Mission, region: data.Region,
          chestNo: data.ChestNo || null,
          groupLeader: memberNames.GroupLeader, groupLeaderId: data.GroupLeaderID,
          p1: memberNames.Participant1 || null, p1id: data.Participant1ID || null,
          p2: memberNames.Participant2 || null, p2id: data.Participant2ID || null,
          p3: memberNames.Participant3 || null, p3id: data.Participant3ID || null,
          p4: memberNames.Participant4 || null, p4id: data.Participant4ID || null,
          p5: memberNames.Participant5 || null, p5id: data.Participant5ID || null,
          p6: memberNames.Participant6 || null, p6id: data.Participant6ID || null,
          p7: memberNames.Participant7 || null, p7id: data.Participant7ID || null,
          p8: memberNames.Participant8 || null, p8id: data.Participant8ID || null,
          p9: memberNames.Participant9 || null, p9id: data.Participant9ID || null,
          comments: data.Comments || null,
        });
        if (!ins.rowCount) throw new Error('Failed to save group contestant.');
        return { id: newId };
      });

      const { id } = result;
      if (editing) return res.json({ message: 'Group event registration updated.', id });
      return res.status(201).json({ message: `Group contestant saved. ID: ${id}.`, id });
    } catch (error) {
      const en = db.errorNumber(error);
      const ce = db.getCustomError(error);
      if (ce && [51060, 51063].includes(ce.number)) return res.status(409).json({ message: ce.message });
      if (en === 51005) return res.status(409).json({ message: 'A contestant can register for a maximum of 3 group events, counting both group leader and participant roles.' });
      if (en === 23505) return res.status(409).json({ message: 'A group contestant with these details already exists.' });
      console.error('Create-group-contestant database error:', error);
      return res.status(500).json({ message: 'Unable to save the group contestant.' });
    }
  };

  app.post('/api/group-contestants', authMiddleware, saveGroup);
  app.put('/api/group-contestants', authMiddleware, saveGroup);
};
