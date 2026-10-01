const ageCategoryOrder = require('./age-category-order');
module.exports = function registerResultsRoutes(app, { db, dbReady, authMiddleware, isAdmin }) {
  const notifyPublishedResults = require('./published-result-updates')(app, authMiddleware);

  const registrationColumns = `event_id, event_name, event_age_group, individual_group, on_stage_off_stage,
    contestant_id, contestant_first_name, contestant_last_name, contestant_mission, chest_no`;
  const registrationSource = `(
    SELECT ${registrationColumns} FROM event_registrations
    UNION ALL
    SELECT e.event_id, e.event_name, e.event_age_group, e.individual_group, e.on_stage_off_stage,
      g.id AS contestant_id, g.group_name AS contestant_first_name, '' AS contestant_last_name,
      g.mission AS contestant_mission, g.chest_no
    FROM group_contestants g
    JOIN events e ON e.event_id = g.event_id AND e.event_age_group = g.age_group
    WHERE LOWER(TRIM(e.individual_group)) = 'group'
  ) registrations_source`;

  const validText = v => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 50;
  const validPoints = v => Number.isInteger(v) && v >= 0 && v <= 2147483647;
  const validScore = v => Number.isFinite(v) && v >= 0 && v <= 2147483647 && Number(v.toFixed(2)) === v;

  app.get('/api/reports/individual-top-scorers', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        WITH totals AS (
          SELECT contestant_id, MAX(contestant_first_name) AS "FirstName",
            MAX(contestant_last_name) AS "LastName", MAX(contestant_mission) AS "Mission",
            SUM(points::bigint) AS "TotalPoints", COUNT(*) AS "PublishedEvents"
          FROM published_results
          WHERE LOWER(TRIM(individual_group)) = 'individual' AND points IS NOT NULL
          GROUP BY contestant_id
        ), ranked AS (
          SELECT *, DENSE_RANK() OVER (ORDER BY "TotalPoints" DESC) AS "Place" FROM totals
        )
        SELECT "Place", contestant_id AS "ContestantID", "FirstName", "LastName",
          "Mission", "TotalPoints", "PublishedEvents"
        FROM ranked WHERE "Place" <= 4
        ORDER BY "Place", "FirstName", "LastName", contestant_id
      `);
      res.set('Cache-Control', 'no-store');
      return res.json({ scorers: result.recordset });
    } catch (error) {
      console.error('Individual top scorers report error:', error);
      return res.status(500).json({ message: 'Unable to load individual top scorers.' });
    }
  });

  app.get('/api/reports/mission-standings', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        WITH missions AS (
          SELECT DISTINCT TRIM(mission_name) AS mission FROM missions
          WHERE NULLIF(TRIM(mission_name), '') IS NOT NULL
        ), totals AS (
          SELECT TRIM(contestant_mission) AS mission,
            SUM(CASE WHEN LOWER(TRIM(individual_group)) = 'individual' THEN points::bigint ELSE 0 END) AS "IndividualPoints",
            SUM(CASE WHEN LOWER(TRIM(individual_group)) = 'group' THEN points::bigint ELSE 0 END) AS "GroupPoints"
          FROM published_results
          WHERE points IS NOT NULL AND LOWER(TRIM(individual_group)) IN ('individual', 'group')
          GROUP BY TRIM(contestant_mission)
        ), combined AS (
          SELECT m.mission AS "Mission",
            COALESCE(t."IndividualPoints", 0) AS "IndividualPoints",
            COALESCE(t."GroupPoints", 0) AS "GroupPoints",
            COALESCE(t."IndividualPoints", 0) + COALESCE(t."GroupPoints", 0) AS "TotalPoints"
          FROM missions m LEFT JOIN totals t ON t.mission = m.mission
        )
        SELECT DENSE_RANK() OVER (ORDER BY "TotalPoints" DESC) AS "Place",
          "Mission", "IndividualPoints", "GroupPoints", "TotalPoints"
        FROM combined ORDER BY "TotalPoints" DESC, "Mission"
      `);
      res.set('Cache-Control', 'no-store');
      return res.json({ missions: result.recordset });
    } catch (error) {
      console.error('Mission standings report error:', error);
      return res.status(500).json({ message: 'Unable to load mission standings.' });
    }
  });

  app.get('/api/reports/records-without-score', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup",
          individual_group AS "IndividualGroup", on_stage_off_stage AS "OnStageOffStage",
          contestant_id AS "ContestantID", contestant_first_name AS "ContestantFirstName",
          contestant_last_name AS "ContestantLastName", contestant_mission AS "ContestantMission",
          TRIM(chest_no) AS "ChestNo", event_attendance AS "EventAttendence"
        FROM prepub_results
        WHERE score IS NULL AND LOWER(TRIM(COALESCE(event_attendance, ''))) <> 'walkover'
        ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id,
          contestant_first_name, contestant_last_name, contestant_id
      `);
      res.set('Cache-Control', 'no-store');
      return res.json({ records: result.recordset });
    } catch (error) {
      console.error('Records without score report error:', error);
      return res.status(500).json({ message: 'Unable to load records without score.' });
    }
  });

  app.get('/api/results/published', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup",
          TRIM(individual_group) AS "IndividualGroup", TRIM(on_stage_off_stage) AS "OnStageOffStage",
          contestant_id AS "ContestantID", contestant_first_name AS "ContestantFirstName",
          contestant_last_name AS "ContestantLastName", contestant_mission AS "ContestantMission",
          TRIM(chest_no) AS "ChestNo", score AS "Score", place AS "Place", points AS "Points",
          certificate_printed AS "CertificatePrinted", results_printed AS "ResultsPrinted",
          is_walkover AS "IsWalkOver"
        FROM published_results
        ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id,
          CASE place WHEN 'First' THEN 1 WHEN 'Second' THEN 2 WHEN 'Third' THEN 3 ELSE 4 END,
          contestant_first_name, contestant_last_name, contestant_id
      `);
      return res.json({ results: result.recordset });
    } catch (error) {
      console.error('Published results error:', error);
      return res.status(500).json({ message: 'Unable to load published results.' });
    }
  });

  app.post('/api/results/printed', authMiddleware, async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000
      || !rows.every(row => row && [row.EventID, row.EventAgeGroup, row.ContestantID].every(validText)))
      return res.status(400).json({ message: 'Select published results to mark as printed.' });
    try {
      await dbReady;
      const selected = rows.map(({ EventID, EventAgeGroup, ContestantID }) => ({ EventID, EventAgeGroup, ContestantID }));
      // Use pool directly to pass jsonb parameter
      await db.pool.query(
        `UPDATE published_results pr SET results_printed = 'Yes'
         FROM jsonb_array_elements($1::jsonb) AS elem
         WHERE pr.event_id = (elem->>'EventID')
           AND pr.event_age_group = (elem->>'EventAgeGroup')
           AND pr.contestant_id = (elem->>'ContestantID')`,
        [JSON.stringify(selected)]
      );
      return res.json({ message: 'Results marked as printed.' });
    } catch (error) {
      console.error('Results printed status error:', error);
      return res.status(500).json({ message: 'Unable to save results printed status. Please try again.' });
    }
  });

  app.get('/api/results/options', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT DISTINCT ${ageCategoryOrder('event_age_group')} AS "AgeSortOrder",
          event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup",
          individual_group AS "IndividualGroup", on_stage_off_stage AS "OnStageOffStage"
        FROM ${registrationSource}
        WHERE NOT EXISTS (
          SELECT 1 FROM prepub_results p
          WHERE p.event_id = registrations_source.event_id
            AND p.event_age_group = registrations_source.event_age_group
            AND p.contestant_id = registrations_source.contestant_id
            AND NULLIF(TRIM(p.score_last_edited_by), '') IS NOT NULL
            AND ((TRIM(p.event_attendance) = 'Completed' AND p.score IS NOT NULL)
              OR TRIM(p.event_attendance) IN ('NoShow', 'WalkOver'))
        )
        ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id
      `);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('Results options error:', error);
      return res.status(500).json({ message: 'Unable to load registered events.' });
    }
  });

  app.get('/api/results/publish-options', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.query(`
        SELECT DISTINCT ${ageCategoryOrder('event_age_group')} AS "AgeSortOrder",
          event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup"
        FROM prepub_results
        WHERE (score IS NOT NULL OR TRIM(event_attendance) = 'WalkOver')
          AND checked_approved = 'not approved'
        ORDER BY event_name, ${ageCategoryOrder('event_age_group')}, event_age_group, event_id
      `);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('Publish options error:', error);
      return res.status(500).json({ message: 'Unable to load events with saved scores.' });
    }
  });

  app.get('/api/results/participants', authMiddleware, async (req, res) => {
    if (!validText(req.query.EventID) || !validText(req.query.EventAgeGroup))
      return res.status(400).json({ message: 'Select an event and age group.' });
    try {
      await dbReady;
      const result = await db.query(`
        WITH registrations AS (
          SELECT DISTINCT ${registrationColumns}
          FROM ${registrationSource}
          WHERE event_id = @eventId AND event_age_group = @ageGroup
        )
        SELECT r.event_id AS "EventID", r.event_name AS "EventName",
          r.event_age_group AS "EventAgeGroup", r.individual_group AS "IndividualGroup",
          r.on_stage_off_stage AS "OnStageOffStage", r.contestant_id AS "ContestantID",
          r.contestant_first_name AS "ContestantFirstName",
          r.contestant_last_name AS "ContestantLastName",
          r.contestant_mission AS "ContestantMission", TRIM(r.chest_no) AS "ChestNo",
          COUNT(*) OVER (PARTITION BY r.event_id, r.contestant_id) AS "RegistrationCount",
          p.score AS "Score", p.event_attendance AS "EventAttendence",
          p.checked_approved AS "CheckedApproved", p.place AS "Place", p.points AS "Points",
          p.score_last_edited_by AS "ScoreLastEditedBy", p.comments AS "Comments",
          p.checked_approved_by AS "ApprovedBy",
          CASE WHEN p.event_id IS NULL THEN 0 ELSE 1 END AS "ResultExists"
        FROM registrations r
        LEFT JOIN prepub_results p ON p.event_id = r.event_id AND p.contestant_id = r.contestant_id
        ORDER BY r.contestant_first_name, r.contestant_last_name, r.contestant_id
      `, { eventId: req.query.EventID.trim(), ageGroup: req.query.EventAgeGroup.trim() });
      return res.json({ participants: result.recordset, canEditPublished: Boolean(isAdmin(req)) });
    } catch (error) {
      console.error('Results participants error:', error);
      return res.status(500).json({ message: 'Unable to load registered contestants.' });
    }
  });

  app.post('/api/results', authMiddleware, async (req, res) => {
    const { EventID, EventAgeGroup, ContestantID, EventAttendence, Score,
      OriginalScore, OriginalAttendence } = req.body || {};
    if (![EventID, EventAgeGroup, ContestantID].every(validText)
      || !['Completed', 'NoShow', 'WalkOver'].includes(EventAttendence)
      || !(Score === null || validScore(Score))
      || (EventAttendence === 'Completed' && !validScore(Score))
      || (EventAttendence !== 'Completed' && Score !== null)
      || !(OriginalScore === null || validScore(OriginalScore))
      || !(OriginalAttendence === null || ['Completed', 'NoShow', 'WalkOver', 'Present'].includes(OriginalAttendence)))
      return res.status(400).json({ message: 'Select attendance and enter a non-negative score with up to two decimal places for Completed contestants.' });

    try {
      await dbReady;
      const username = String(req.session.username || '').trim();
      if (!username) return res.status(401).json({ message: 'Please sign in first.' });

      const eventId = EventID.trim(), ageGroup = EventAgeGroup.trim(), contestantId = ContestantID.trim();

      const saved = await db.withTransaction(async (tq) => {
        // Lock and get registration
        const regResult = await tq(`
          SELECT DISTINCT ${registrationColumns}
          FROM ${registrationSource}
          WHERE event_id = @eventId AND event_age_group = @ageGroup AND contestant_id = @contestantId
        `, { eventId, ageGroup, contestantId });
        if (regResult.recordset.length !== 1)
          throw Object.assign(new Error('[51020] Registration is missing or ambiguous. Reload the contestants.'), {});

        const reg = regResult.recordset[0];

        // WalkOver validation
        let walkOverPoints = null;
        if (EventAttendence === 'WalkOver') {
          const regCount = await tq(`SELECT COUNT(*) AS cnt FROM ${registrationSource} WHERE event_id = @eventId AND event_age_group = @ageGroup`, { eventId, ageGroup });
          if (Number(regCount.recordset[0].cnt) !== 1)
            throw Object.assign(new Error('[51050] WalkOver requires exactly one registered participant.'), {});
          const ep = await tq(`
            SELECT walkover FROM event_points
            WHERE UPPER(REPLACE(TRIM(individual_group), ' ', '')) = UPPER(REPLACE(TRIM(@ig), ' ', ''))
              AND UPPER(REPLACE(TRIM(on_stage_off_stage), ' ', '')) = UPPER(REPLACE(TRIM(@os), ' ', ''))
          `, { ig: reg.individual_group, os: reg.on_stage_off_stage });
          if (ep.recordset.length !== 1 || ep.recordset[0].walkover < 0)
            throw Object.assign(new Error('[51049] WalkOver needs exactly one matching non-negative points rule in event_points.'), {});
          walkOverPoints = ep.recordset[0].walkover;
        }

        // Get existing result (with row lock)
        const existingResult = await tq(`
          SELECT score, TRIM(event_attendance) AS event_attendance, checked_approved, comments
          FROM prepub_results WHERE event_id = @eventId AND contestant_id = @contestantId FOR UPDATE
        `, { eventId, contestantId });
        const existing = existingResult.recordset[0] || null;
        const hasExisting = existing !== null;

        // Check published state
        const publishedCheck = await tq(`
          SELECT 1 FROM prepub_results
          WHERE event_id = @eventId AND event_age_group = @ageGroup AND checked_approved = 'approved'
          UNION ALL
          SELECT 1 FROM published_results WHERE event_id = @eventId AND event_age_group = @ageGroup
          LIMIT 1
        `, { eventId, ageGroup });
        const isPublishedEvent = publishedCheck.recordset.length > 0;

        if (isPublishedEvent && !isAdmin(req))
          throw Object.assign(new Error('[51021] Only an administrator can edit published results.'), {});

        // Stale check
        const existingScore = existing ? (existing.score !== null ? Number(existing.score) : null) : null;
        if ((!hasExisting && (OriginalAttendence !== null || OriginalScore !== null))
          || (hasExisting && (OriginalAttendence === null
            || existing.event_attendance !== OriginalAttendence
            || (existingScore === null && OriginalScore !== null)
            || (existingScore !== null && (OriginalScore === null || existingScore !== OriginalScore)))))
          throw Object.assign(new Error('[51022] This result changed since it was loaded. Reload the contestants before saving.'), {});

        const place = EventAttendence === 'WalkOver' ? 'First' : null;
        const points = EventAttendence === 'WalkOver' ? walkOverPoints : null;

        if (!hasExisting) {
          await tq(`
            INSERT INTO prepub_results (${registrationColumns},
              event_attendance, score, checked_approved_by, score_last_edited_by, place, points)
            VALUES (@eventId, @eventName, @ageGroup, @indGroup, @osGroup,
              @contestantId, @firstName, @lastName, @mission, @chestNo,
              @attendance, @score, NULL, @username, @place, @points)
          `, {
            eventId, eventName: reg.event_name, ageGroup: reg.event_age_group,
            indGroup: reg.individual_group, osGroup: reg.on_stage_off_stage,
            contestantId, firstName: reg.contestant_first_name, lastName: reg.contestant_last_name,
            mission: reg.contestant_mission, chestNo: reg.chest_no,
            attendance: EventAttendence, score: Score, username, place, points,
          });
        } else {
          let newComments = existing.comments || '';
          if (existingScore !== Score) {
            if (newComments) newComments += '\r\n';
            newComments += `Old score: ${existingScore ?? 'Not required'}, New score: ${Score ?? 'Not required'}`;
          }
          await tq(`
            UPDATE prepub_results SET event_attendance = @attendance, score = @score,
              comments = @comments, score_last_edited_by = @username, place = @place, points = @points
            WHERE event_id = @eventId AND contestant_id = @contestantId
          `, { attendance: EventAttendence, score: Score, comments: newComments, username, eventId, contestantId, place, points });
        }

        // Verify scorer was recorded
        const scorerCheck = await tq(`
          SELECT 1 FROM prepub_results WHERE event_id = @eventId AND contestant_id = @contestantId
            AND LOWER(TRIM(score_last_edited_by)) = LOWER(TRIM(@username))
        `, { eventId, contestantId, username });
        if (!scorerCheck.recordset.length)
          throw Object.assign(new Error('[51023] The signed-in scorer was not recorded. Save again after restarting the app.'), {});

        // If already published, immediately re-approve
        if (isPublishedEvent) {
          await tq(`UPDATE prepub_results SET checked_approved = 'approved', checked_approved_by = @username
            WHERE event_id = @eventId AND event_age_group = @ageGroup`, { username, eventId, ageGroup });
          await tq('SELECT publish_winners(@eventId, @ageGroup, @username, NOW())', { eventId, ageGroup, username });
        }

        const savedRow = await tq(`
          SELECT score AS "Score", TRIM(event_attendance) AS "EventAttendence",
            checked_approved AS "CheckedApproved", score_last_edited_by AS "ScoreLastEditedBy",
            comments AS "Comments", place AS "Place", points AS "Points"
          FROM prepub_results WHERE event_id = @eventId AND contestant_id = @contestantId
        `, { eventId, contestantId });
        return savedRow.recordset[0];
      });

      return res.json({ message: 'Result saved.', result: saved });
    } catch (error) {
      const en = db.errorNumber(error);
      const ce = db.getCustomError(error);
      if (en === 51021) return res.status(403).json({ message: ce?.message || error.message });
      if ([51020, 51022, 51023, 51049, 51050].includes(en))
        return res.status(409).json({ message: ce?.message || error.message });
      if (db.errorNumber(error) === 1205)
        return res.status(409).json({ message: 'Another save overlapped with this one. Reload the contestants and try again.' });
      console.error('Save result error:', error);
      return res.status(500).json({ message: 'Unable to save the score.' });
    }
  });

  app.post('/api/results/approve', authMiddleware, async (req, res) => {
    const { EventID, EventAgeGroup, ReviewedResults } = req.body || {};
    if (![EventID, EventAgeGroup].every(validText))
      return res.status(400).json({ message: 'Select an event and age group.' });
    if (!Array.isArray(ReviewedResults) || !ReviewedResults.length
      || ReviewedResults.some(row => !validText(row?.ContestantID)
        || !['Completed', 'NoShow', 'WalkOver'].includes(row.EventAttendence)
        || !(row.Score === null || validScore(row.Score))
        || (row.EventAttendence === 'Completed' && !validScore(row.Score))
        || (row.EventAttendence !== 'Completed' && row.Score !== null)
        || (row.EventAttendence === 'WalkOver' && (row.Place !== 'First' || !validPoints(row.Points)))))
      return res.status(400).json({ message: 'Review every saved attendance and score before publishing.' });

    const username = String(req.session.username || '').trim();
    if (!username) return res.status(401).json({ message: 'Please sign in first.' });

    try {
      await dbReady;
      const eventId = EventID.trim(), ageGroup = EventAgeGroup.trim();

      const publishedCount = await db.withTransaction(async (tq) => {
        // Lock all relevant rows
        const registered = await tq(`
          SELECT DISTINCT event_id, contestant_id FROM ${registrationSource}
          WHERE event_id = @eventId AND event_age_group = @ageGroup
        `, { eventId, ageGroup });
        if (!registered.recordset.length)
          throw Object.assign(new Error('[51040] No registered contestants were found.'), {});

        // Check for duplicate registrations
        const regCounts = {};
        for (const r of registered.recordset) {
          const key = `${r.event_id}|${r.contestant_id}`;
          regCounts[key] = (regCounts[key] || 0) + 1;
        }
        if (Object.values(regCounts).some(c => c > 1))
          throw Object.assign(new Error('[51046] Conflicting registrations must be corrected before approval.'), {});

        const dbResults = await tq(`
          SELECT contestant_id, score, TRIM(event_attendance) AS event_attendance,
            place, points, score_last_edited_by, checked_approved
          FROM prepub_results WHERE event_id = @eventId AND event_age_group = @ageGroup FOR UPDATE
        `, { eventId, ageGroup });

        // All registered contestants must have a result
        const regIds = new Set(registered.recordset.map(r => r.contestant_id));
        const resultIds = new Set(dbResults.recordset.map(r => r.contestant_id));
        for (const rid of regIds) {
          if (!resultIds.has(rid))
            throw Object.assign(new Error('[51041] Save every registered contestant result before approval.'), {});
        }

        if (dbResults.recordset.some(r => r.checked_approved === 'approved'))
          throw Object.assign(new Error('[51042] This event and age group is already approved.'), {});

        // Validate reviewed results match DB state
        const reviewedMap = new Map(ReviewedResults.map(r => [r.ContestantID, r]));
        if (reviewedMap.size !== dbResults.recordset.length)
          throw Object.assign(new Error('[51047] Scores changed or some results were not reviewed. Reload the list.'), {});

        for (const dbRow of dbResults.recordset) {
          const reviewed = reviewedMap.get(dbRow.contestant_id);
          if (!reviewed) throw Object.assign(new Error('[51047] Scores changed or some results were not reviewed. Reload the list.'), {});
          const dbScore = dbRow.score !== null ? Number(dbRow.score) : null;
          if (dbRow.event_attendance !== reviewed.EventAttendence
            || (dbScore === null && reviewed.Score !== null)
            || (dbScore !== null && (reviewed.Score === null || dbScore !== reviewed.Score))
            || (dbRow.event_attendance === 'WalkOver' && (reviewed.Place !== dbRow.place || reviewed.Points !== dbRow.points)))
            throw Object.assign(new Error('[51047] Scores changed or some results were not reviewed. Reload the list.'), {});
        }

        if (dbResults.recordset.some(r => !r.score_last_edited_by))
          throw Object.assign(new Error('[51048] Some results have no recorded scorer. Resave them on Results entry.'), {});

        // Scorer cannot approve their own results
        if (dbResults.recordset.some(r => r.score_last_edited_by &&
          r.score_last_edited_by.toLowerCase().trim() === username.toLowerCase().trim()))
          throw Object.assign(new Error('[51044] You entered or edited a score in this group and cannot approve it.'), {});

        if (dbResults.recordset.some(r => r.event_attendance === 'Completed' && r.score === null))
          throw Object.assign(new Error('[51045] A completed contestant is missing a score.'), {});

        await tq(`UPDATE prepub_results SET checked_approved = 'approved', checked_approved_by = @username
          WHERE event_id = @eventId AND event_age_group = @ageGroup`, { username, eventId, ageGroup });

        const countRow = await tq('SELECT publish_winners(@eventId, @ageGroup, @username, NOW()) AS cnt',
          { eventId, ageGroup, username });
        return countRow.recordset[0].cnt;
      });

      notifyPublishedResults();
      return res.json({ message: 'Results approved and top places published.', publishedCount });
    } catch (error) {
      const en = db.errorNumber(error);
      const ce = db.getCustomError(error);
      if ([51040, 51041, 51042, 51043, 51044, 51045, 51046, 51047, 51048, 51049, 51050].includes(en) || en === 1205 || en === 23505)
        return res.status(409).json({ message: ce?.message || error.message });
      console.error('Approve results error:', error);
      return res.status(500).json({ message: 'Unable to approve and publish results.' });
    }
  });
};
