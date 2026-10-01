module.exports = (app, { db, dbReady, authMiddleware }) => {
  app.get('/api/event-registrations', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT event_id AS "EventID", contestant_id AS "ContestantID",
          event_name AS "EventName", event_age_group AS "EventAgeGroup",
          contestant_first_name AS "ContestantFirstName",
          contestant_last_name AS "ContestantLastName",
          contestant_mission AS "ContestantMission",
          TRIM(chest_no) AS "ChestNo", comments AS "Comments"
        FROM event_registrations
        ORDER BY event_name, contestant_first_name, contestant_last_name
      `);
      res.json({ registrations: result.recordset });
    } catch (error) {
      console.error('List registrations:', error);
      res.status(500).json({ message: 'Unable to load event registrations.' });
    }
  });

  app.put('/api/event-registrations', authMiddleware, async (req, res) => {
    const data = {};
    for (const field of ['EventID', 'ContestantID', 'Comments']) {
      const value = req.body?.[field];
      if ((value != null && typeof value !== 'string') || (field !== 'Comments' && !value?.trim()) || (value || '').length > 50)
        return res.status(400).json({ message: `Enter a valid ${field}.` });
      data[field] = (value || '').trim();
    }
    const original = req.body?.Original;
    const origFields = ['EventID', 'ContestantID', 'EventName', 'EventAgeGroup',
      'ContestantFirstName', 'ContestantLastName', 'ContestantMission', 'ChestNo', 'Comments'];
    if (!original || origFields.some(f => (original[f] != null && typeof original[f] !== 'string') || (original[f] || '').length > 50)
      || !original.EventID || !original.ContestantID)
      return res.status(400).json({ message: 'Reload the registration before editing.' });

    try {
      await dbReady;
      await db.withTransaction(async (tq) => {
        const existing = await tq(
          'SELECT 1 FROM event_registrations WHERE event_id = @oldEventId AND contestant_id = @oldContestantId FOR UPDATE',
          { oldEventId: original.EventID, oldContestantId: original.ContestantID }
        );
        if (existing.recordset.length !== 1)
          throw Object.assign(new Error('[51060] Registration is missing or ambiguous. Reload before editing.'), {});

        const hasResults = await tq(`
          SELECT 1 FROM prepub_results WHERE
            (event_id = @oldEventId AND contestant_id = @oldContestantId)
            OR (event_id = @newEventId AND contestant_id = @newContestantId)
          UNION ALL
          SELECT 1 FROM published_results WHERE
            (event_id = @oldEventId AND contestant_id = @oldContestantId)
            OR (event_id = @newEventId AND contestant_id = @newContestantId)
          LIMIT 1
        `, {
          oldEventId: original.EventID, oldContestantId: original.ContestantID,
          newEventId: data.EventID, newContestantId: data.ContestantID,
        });
        if (hasResults.recordset.length)
          throw Object.assign(new Error('[51060] This registration has results and cannot be changed.'), {});

        const upd = await tq(`
          UPDATE event_registrations er SET
            event_id = e.event_id, event_name = e.event_name, event_age_group = e.event_age_group,
            individual_group = e.individual_group, on_stage_off_stage = e.on_stage_off_stage,
            contestant_id = c.id, contestant_first_name = c.first_name,
            contestant_last_name = c.last_name, contestant_mission = c.mission,
            chest_no = CASE LOWER(REPLACE(REPLACE(TRIM(e.on_stage_off_stage), ' ', ''), '-', ''))
              WHEN 'onstage' THEN c.on_stage_chest_no WHEN 'offstage' THEN c.off_stage_chest_no END,
            comments = @comments
          FROM events e, contestants c
          WHERE er.event_id = @oldEventId AND er.contestant_id = @oldContestantId
            AND COALESCE(TRIM(er.event_name), '') = COALESCE(@origEventName, '')
            AND COALESCE(TRIM(er.event_age_group), '') = COALESCE(@origEventAgeGroup, '')
            AND COALESCE(TRIM(er.contestant_first_name), '') = COALESCE(@origFirstName, '')
            AND COALESCE(TRIM(er.contestant_last_name), '') = COALESCE(@origLastName, '')
            AND COALESCE(TRIM(er.contestant_mission), '') = COALESCE(@origMission, '')
            AND COALESCE(TRIM(er.chest_no), '') = COALESCE(@origChestNo, '')
            AND COALESCE(er.comments, '') = COALESCE(@origComments, '')
            AND e.event_id = @newEventId AND c.id = @newContestantId
            AND (LOWER(TRIM(e.individual_group)) <> 'individual'
              OR LOWER(TRIM(e.event_age_group)) = LOWER(TRIM(c.age_group)))
            AND NULLIF(TRIM(
              CASE LOWER(REPLACE(REPLACE(TRIM(e.on_stage_off_stage), ' ', ''), '-', ''))
                WHEN 'onstage' THEN c.on_stage_chest_no WHEN 'offstage' THEN c.off_stage_chest_no END
            ), '') IS NOT NULL
          RETURNING er.event_id
        `, {
          oldEventId: original.EventID, oldContestantId: original.ContestantID,
          newEventId: data.EventID, newContestantId: data.ContestantID,
          comments: data.Comments || null,
          origEventName: original.EventName || null, origEventAgeGroup: original.EventAgeGroup || null,
          origFirstName: original.ContestantFirstName || null, origLastName: original.ContestantLastName || null,
          origMission: original.ContestantMission || null, origChestNo: original.ChestNo || null,
          origComments: original.Comments || null,
        });
        if (!upd.rowCount)
          throw Object.assign(new Error('[51060] Registration changed or the selected contestant is not eligible. Reload and check the age group and chest number.'), {});
      });
      res.json({ message: 'Event registration updated.' });
    } catch (error) {
      const en = db.errorNumber(error);
      const ce = db.getCustomError(error);
      if (en === 51004) return res.status(409).json({ message: 'This contestant already has the maximum of three individual registrations.' });
      if (en === 23505) return res.status(409).json({ message: 'This contestant is already registered for the selected event.' });
      if (ce && ce.number === 51060) return res.status(409).json({ message: ce.message });
      console.error('Edit registration:', error);
      res.status(500).json({ message: 'Unable to update the registration.' });
    }
  });
};
