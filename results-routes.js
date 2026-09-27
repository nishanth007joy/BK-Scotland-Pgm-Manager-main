const ageCategoryOrder = require('./age-category-order');
module.exports = function registerResultsRoutes(app, { db, dbReady, sql, authMiddleware, isAdmin }) {
  const notifyPublishedResults = require('./published-result-updates')(app, authMiddleware);
  const registrationColumns = `EventID, EventName, EventAgeGroup, IndividualGroup, OnStageOffStage,
    ContestantID, ContestantFirstName, ContestantLastName, ContestantMission, ChestNo`;
  const registrationSource = `(SELECT ${registrationColumns} FROM dbo.EventRegistrations WITH (HOLDLOCK)
    UNION ALL
    SELECT e.EventID, e.EventName, e.EventAgeGroup, e.IndividualGroup, e.OnStageOffStage,
      g.ID AS ContestantID, g.GroupName AS ContestantFirstName, '' AS ContestantLastName,
      g.Mission AS ContestantMission, g.ChestNo
    FROM dbo.GroupContestants g WITH (HOLDLOCK)
    JOIN dbo.Events e WITH (HOLDLOCK) ON e.EventID=g.EventID AND e.EventAgeGroup=g.AgeGroup
    WHERE LOWER(LTRIM(RTRIM(e.IndividualGroup)))='group')`;
  const publishWinners = `
            IF EXISTS (SELECT 1 FROM #results WHERE RTRIM(EventAttendence)='WalkOver')
              AND ((SELECT COUNT(*) FROM ${registrationSource} registrationsSource
                WHERE EventID=@eventId AND EventAgeGroup=@ageGroup) <> 1
                OR (SELECT COUNT(*) FROM #results) <> 1)
              THROW 51050, 'WalkOver requires exactly one registered participant. Reload and correct the result.', 1;
            ;WITH ranked AS (
              SELECT *, ROW_NUMBER() OVER (ORDER BY Score DESC, ContestantID ASC) AS placeNumber
              FROM #results WHERE RTRIM(EventAttendence) IN ('Completed', 'WalkOver')
            )
            SELECT r.*, ep.MatchCount,
              CASE WHEN RTRIM(r.EventAttendence)='WalkOver' THEN r.Points ELSE ep.Points END AS AwardPoints
              INTO #winners FROM ranked r
            OUTER APPLY (
              SELECT COUNT(*) AS MatchCount,
                CASE WHEN RTRIM(r.EventAttendence)='WalkOver' THEN MAX(WalkOver)
                  WHEN r.placeNumber=1 THEN MAX(FirstPlace) WHEN r.placeNumber=2 THEN MAX(SecondPlace)
                  ELSE MAX(ThirdPlace) END AS Points
              FROM dbo.EventPoints
              WHERE UPPER(REPLACE(LTRIM(RTRIM(IndividualGroup)), ' ', '')) =
                UPPER(REPLACE(LTRIM(RTRIM(r.IndividualGroup)), ' ', ''))
                AND UPPER(REPLACE(LTRIM(RTRIM(OnStageOffStage)), ' ', '')) =
                  UPPER(REPLACE(LTRIM(RTRIM(r.OnStageOffStage)), ' ', ''))
            ) ep WHERE r.placeNumber <= 3;
            IF EXISTS (SELECT 1 FROM #winners WHERE MatchCount <> 1 OR AwardPoints IS NULL OR AwardPoints < 0)
              THROW 51049, 'Each winner needs exactly one matching points rule in EventPoints.', 1;
            INSERT INTO dbo.PublishedResults (${registrationColumns}, Score, Place, Points,
              ScoreLastEditedBy, ApprovedBy, ApprovedAt, IsWalkOver)
            SELECT ${registrationColumns}, Score,
              CASE placeNumber WHEN 1 THEN 'First' WHEN 2 THEN 'Second' ELSE 'Third' END,
              AwardPoints, ScoreLastEditedBy, @username, @approvedAt,
              CASE WHEN RTRIM(EventAttendence)='WalkOver' THEN 1 ELSE 0 END
            FROM #winners;
`;
  const validText = (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 50;
  const validPoints = (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647;
  const validScore = (value) => Number.isFinite(value) && value >= 0 && value <= 2147483647
    && Number(value.toFixed(2)) === value;

  app.get('/api/reports/individual-top-scorers', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.request().query(`WITH totals AS (
        SELECT ContestantID, MAX(ContestantFirstName) AS FirstName,
          MAX(ContestantLastName) AS LastName, MAX(ContestantMission) AS Mission,
          SUM(CONVERT(bigint, Points)) AS TotalPoints, COUNT(*) AS PublishedEvents
        FROM dbo.PublishedResults
        WHERE LOWER(LTRIM(RTRIM(IndividualGroup)))='individual' AND Points IS NOT NULL
        GROUP BY ContestantID
      ), ranked AS (
        SELECT *, DENSE_RANK() OVER (ORDER BY TotalPoints DESC) AS Place FROM totals
      )
      SELECT Place, ContestantID, FirstName, LastName, Mission, TotalPoints, PublishedEvents
      FROM ranked WHERE Place <= 4
      ORDER BY Place, FirstName, LastName, ContestantID;`);
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
      const result = await db.request().query(`WITH missions AS (
        SELECT DISTINCT LTRIM(RTRIM(MissionName)) AS Mission FROM dbo.MissionDetails
        WHERE NULLIF(LTRIM(RTRIM(MissionName)), '') IS NOT NULL
      ), totals AS (
        SELECT LTRIM(RTRIM(ContestantMission)) AS Mission,
          SUM(CASE WHEN LOWER(LTRIM(RTRIM(IndividualGroup)))='individual' THEN CONVERT(bigint, Points) ELSE 0 END) AS IndividualPoints,
          SUM(CASE WHEN LOWER(LTRIM(RTRIM(IndividualGroup)))='group' THEN CONVERT(bigint, Points) ELSE 0 END) AS GroupPoints
        FROM dbo.PublishedResults
        WHERE Points IS NOT NULL AND LOWER(LTRIM(RTRIM(IndividualGroup))) IN ('individual', 'group')
        GROUP BY LTRIM(RTRIM(ContestantMission))
      ), combined AS (
        SELECT m.Mission, COALESCE(t.IndividualPoints, 0) AS IndividualPoints,
          COALESCE(t.GroupPoints, 0) AS GroupPoints,
          COALESCE(t.IndividualPoints, 0) + COALESCE(t.GroupPoints, 0) AS TotalPoints
        FROM missions m LEFT JOIN totals t ON t.Mission=m.Mission
      )
      SELECT DENSE_RANK() OVER (ORDER BY TotalPoints DESC) AS Place,
        Mission, IndividualPoints, GroupPoints, TotalPoints
      FROM combined ORDER BY TotalPoints DESC, Mission;`);
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
      const result = await db.request().query(`SELECT ${registrationColumns}, EventAttendence
        FROM dbo.PrePubResults
        WHERE Score IS NULL AND LOWER(LTRIM(RTRIM(COALESCE(EventAttendence, '')))) <> 'walkover'
        ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID, ContestantFirstName, ContestantLastName, ContestantID;`);
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
      const result = await db.request().query(`SELECT ${registrationColumns}, Score, Place, Points, CertificatePrinted, ResultsPrinted, IsWalkOver
        FROM dbo.PublishedResults
        ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID,
          CASE RTRIM(Place) WHEN 'First' THEN 1 WHEN 'Second' THEN 2 WHEN 'Third' THEN 3 ELSE 4 END,
          ContestantFirstName, ContestantLastName, ContestantID;`);
      return res.json({ results: result.recordset });
    } catch (error) {
      console.error('Published results error:', error);
      return res.status(500).json({ message: 'Unable to load published results.' });
    }
  });

  app.post('/api/results/printed', authMiddleware, async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000
      || !rows.every(row => row && [row.EventID, row.EventAgeGroup, row.ContestantID].every(validText))) {
      return res.status(400).json({ message: 'Select published results to mark as printed.' });
    }
    try {
      await dbReady;
      const selected = rows.map(({ EventID, EventAgeGroup, ContestantID }) => ({ EventID, EventAgeGroup, ContestantID }));
      await db.request().input('rows', sql.NVarChar(sql.MAX), JSON.stringify(selected))
        .query(`UPDATE p SET ResultsPrinted='Yes'
          FROM dbo.PublishedResults p
          JOIN OPENJSON(@rows) WITH (EventID nvarchar(50), EventAgeGroup nvarchar(50), ContestantID nvarchar(50)) r
            ON p.EventID=r.EventID AND p.EventAgeGroup=r.EventAgeGroup AND p.ContestantID=r.ContestantID;`);
      return res.json({ message: 'Results marked as printed.' });
    } catch (error) {
      console.error('Results printed status error:', error);
      return res.status(500).json({ message: 'Unable to save results printed status. Please try again.' });
    }
  });

  app.get('/api/results/options', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.request().query(`SELECT DISTINCT ${ageCategoryOrder('EventAgeGroup')} AS AgeSortOrder, EventID, EventName, EventAgeGroup,
        IndividualGroup, OnStageOffStage FROM ${registrationSource} registrationsSource
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.PrePubResults p
          WHERE p.EventID = registrationsSource.EventID
            AND p.EventAgeGroup = registrationsSource.EventAgeGroup
            AND p.ContestantID = registrationsSource.ContestantID
            AND NULLIF(LTRIM(RTRIM(p.ScoreLastEditedBy)), '') IS NOT NULL
            AND ((RTRIM(p.EventAttendence) = 'Completed' AND p.Score IS NOT NULL)
              OR RTRIM(p.EventAttendence) IN ('NoShow', 'WalkOver'))
        )
        ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID;`);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('Results options error:', error);
      return res.status(500).json({ message: 'Unable to load registered events.' });
    }
  });

  app.get('/api/results/publish-options', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.request().query(`SELECT DISTINCT ${ageCategoryOrder('EventAgeGroup')} AS AgeSortOrder, EventID, EventName, EventAgeGroup
        FROM dbo.PrePubResults WHERE (Score IS NOT NULL OR RTRIM(EventAttendence)='WalkOver') AND CheckedApproved = 'not approved'
        ORDER BY EventName, ${ageCategoryOrder('EventAgeGroup')}, EventAgeGroup, EventID;`);
      return res.json({ events: result.recordset });
    } catch (error) {
      console.error('Publish options error:', error);
      return res.status(500).json({ message: 'Unable to load events with saved scores.' });
    }
  });

  app.get('/api/results/participants', authMiddleware, async (req, res) => {
    if (!validText(req.query.EventID) || !validText(req.query.EventAgeGroup)) {
      return res.status(400).json({ message: 'Select an event and age group.' });
    }
    try {
      await dbReady;
      const result = await db.request()
        .input('eventId', sql.NVarChar(50), req.query.EventID.trim())
        .input('ageGroup', sql.NVarChar(50), req.query.EventAgeGroup.trim())
        .query(`WITH registrations AS (
          SELECT DISTINCT ${registrationColumns} FROM ${registrationSource} registrationsSource
          WHERE EventID = @eventId AND EventAgeGroup = @ageGroup
        )
        SELECT r.*, COUNT(*) OVER (PARTITION BY r.EventID, r.ContestantID) AS RegistrationCount,
          p.Score, p.EventAttendence, p.CheckedApproved, p.Place, p.Points,
          p.ScoreLastEditedBy, p.Comments, p.CheckedApprovedby AS ApprovedBy,
          CASE WHEN p.EventID IS NULL THEN 0 ELSE 1 END AS ResultExists
        FROM registrations r LEFT JOIN dbo.PrePubResults p
          ON p.EventID = r.EventID AND p.ContestantID = r.ContestantID
        ORDER BY r.ContestantFirstName, r.ContestantLastName, r.ContestantID;`);
      return res.json({ participants: result.recordset, canEditPublished: Boolean(isAdmin(req)) });
    } catch (error) {
      console.error('Results participants error:', error);
      return res.status(500).json({ message: 'Unable to load registered contestants.' });
    }
  });

  app.post('/api/results', authMiddleware, async (req, res) => {
    const { EventID, EventAgeGroup, ContestantID, EventAttendence, Score, OriginalScore, OriginalAttendence } = req.body || {};
    if (![EventID, EventAgeGroup, ContestantID].every(validText)
        || !['Completed', 'NoShow', 'WalkOver'].includes(EventAttendence)
        || !(Score === null || validScore(Score))
        || (EventAttendence === 'Completed' && !validScore(Score))
        || (EventAttendence !== 'Completed' && Score !== null)
        || !(OriginalScore === null || validScore(OriginalScore))
        || !(OriginalAttendence === null || ['Completed', 'NoShow', 'WalkOver', 'Present'].includes(OriginalAttendence))) {
      return res.status(400).json({ message: 'Select attendance and enter a non-negative score with up to two decimal places for Completed contestants.' });
    }
    try {
      await dbReady;
      const username = String(req.session.username || '').trim();
      if (!username) return res.status(401).json({ message: 'Please sign in first.' });
      const result = await db.request()
        .input('eventId', sql.NVarChar(50), EventID.trim())
        .input('ageGroup', sql.NVarChar(50), EventAgeGroup.trim())
        .input('contestantId', sql.NVarChar(50), ContestantID.trim())
        .input('score', sql.Decimal(12, 2), Score)
        .input('isAdmin', sql.Bit, Boolean(isAdmin(req)))
        .input('originalScore', sql.Decimal(12, 2), OriginalScore)
        .input('attendance', sql.VarChar(10), EventAttendence)
        .input('originalAttendance', sql.VarChar(10), OriginalAttendence)
        .input('username', sql.NVarChar(255), username)
        .query(`SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          BEGIN TRY
            SELECT DISTINCT ${registrationColumns} INTO #registration
            FROM ${registrationSource} registrationsSource
            WHERE EventID = @eventId AND EventAgeGroup = @ageGroup AND ContestantID = @contestantId;
            IF (SELECT COUNT(*) FROM #registration) <> 1
              THROW 51020, 'Registration is missing or ambiguous. Reload the contestants.', 1;
            DECLARE @walkOverPoints int = NULL;
            IF @attendance='WalkOver'
            BEGIN
              IF (SELECT COUNT(*) FROM ${registrationSource} registrationsSource
                  WHERE EventID=@eventId AND EventAgeGroup=@ageGroup) <> 1
                THROW 51050, 'WalkOver requires exactly one registered participant.', 1;
              IF EXISTS (SELECT 1 FROM dbo.PrePubResults WITH (UPDLOCK, HOLDLOCK)
                  WHERE EventID=@eventId AND EventAgeGroup=@ageGroup AND ContestantID<>@contestantId)
                THROW 51050, 'Other results exist for this event. Correct them before recording WalkOver.', 1;
              SELECT @walkOverPoints=MAX(ep.WalkOver)
                FROM dbo.EventPoints ep CROSS JOIN #registration r
                WHERE UPPER(REPLACE(LTRIM(RTRIM(ep.IndividualGroup)), ' ', '')) =
                  UPPER(REPLACE(LTRIM(RTRIM(r.IndividualGroup)), ' ', ''))
                  AND UPPER(REPLACE(LTRIM(RTRIM(ep.OnStageOffStage)), ' ', '')) =
                  UPPER(REPLACE(LTRIM(RTRIM(r.OnStageOffStage)), ' ', ''))
                HAVING COUNT(*)=1;
              IF @walkOverPoints IS NULL OR @walkOverPoints<0
                THROW 51049, 'WalkOver needs exactly one matching non-negative points rule in EventPoints.', 1;
            END;
            DECLARE @existingScore decimal(12,2), @existingAttendance varchar(10), @approval varchar(12), @hasExisting bit = 0;
            SELECT @hasExisting = 1, @existingScore = Score, @existingAttendance = RTRIM(EventAttendence), @approval = CheckedApproved
              FROM dbo.PrePubResults WITH (UPDLOCK, HOLDLOCK)
              WHERE EventID = @eventId AND ContestantID = @contestantId;
            DECLARE @published bit = 0;
            IF @approval = 'approved' OR EXISTS (SELECT 1 FROM dbo.PrePubResults WITH (UPDLOCK, HOLDLOCK)
                WHERE EventID = @eventId AND EventAgeGroup = @ageGroup AND CheckedApproved = 'approved')
              OR EXISTS (SELECT 1 FROM dbo.PublishedResults WITH (UPDLOCK, HOLDLOCK)
                WHERE EventID = @eventId AND EventAgeGroup = @ageGroup)
              SET @published = 1;
            IF @published = 1 AND @isAdmin = 0
              THROW 51021, 'Only an administrator can edit published results.', 1;
            IF (@hasExisting = 0 AND (@originalAttendance IS NOT NULL OR @originalScore IS NOT NULL))
              OR (@hasExisting = 1 AND (@originalAttendance IS NULL OR @existingAttendance <> @originalAttendance
                OR (@existingScore IS NULL AND @originalScore IS NOT NULL)
                OR (@existingScore IS NOT NULL AND (@originalScore IS NULL OR @existingScore <> @originalScore))))
              THROW 51022, 'This result changed since it was loaded. Reload the contestants before saving.', 1;
            IF @hasExisting = 0
              INSERT INTO dbo.PrePubResults (${registrationColumns}, EventAttendence, Score,
                CheckedApprovedby, ScoreLastEditedBy, Place, Points)
                SELECT ${registrationColumns}, @attendance, @score, NULL, @username,
                  CASE WHEN @attendance='WalkOver' THEN 'First' END, @walkOverPoints FROM #registration;
            ELSE
              UPDATE dbo.PrePubResults SET EventAttendence = @attendance, Score = @score,
                Comments = CASE WHEN @existingScore <> @score
                    OR (@existingScore IS NULL AND @score IS NOT NULL)
                    OR (@existingScore IS NOT NULL AND @score IS NULL)
                  THEN CONCAT(CAST(Comments AS nvarchar(max)),
                    CASE WHEN NULLIF(RTRIM(Comments), '') IS NULL THEN '' ELSE CHAR(13)+CHAR(10) END,
                    'Old score: ', COALESCE(CONVERT(varchar(30), @existingScore), 'Not required'),
                    ', New score: ', COALESCE(CONVERT(varchar(30), @score), 'Not required'))
                  ELSE Comments END,
                ScoreLastEditedBy = @username,
                Place = CASE WHEN @attendance='WalkOver' THEN 'First' END, Points=@walkOverPoints
                WHERE EventID = @eventId AND ContestantID = @contestantId;
            IF NOT EXISTS (SELECT 1 FROM dbo.PrePubResults
                WHERE EventID = @eventId AND ContestantID = @contestantId
                  AND ScoreLastEditedBy COLLATE Latin1_General_100_CI_AS = @username COLLATE Latin1_General_100_CI_AS)
              THROW 51023, 'The signed-in scorer was not recorded. Save again after restarting the app.', 1;
            IF @published = 1
            BEGIN
              UPDATE dbo.PrePubResults SET CheckedApproved='approved', CheckedApprovedby=@username
                WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
              SELECT * INTO #results FROM dbo.PrePubResults WITH (UPDLOCK, HOLDLOCK)
                WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
              DECLARE @approvedAt datetime2(0)=SYSUTCDATETIME();
              DELETE FROM dbo.PublishedResults WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
              ${publishWinners}
            END;
            SELECT Score, RTRIM(EventAttendence) AS EventAttendence, CheckedApproved,
              ScoreLastEditedBy, Comments, Place, Points FROM dbo.PrePubResults
              WHERE EventID = @eventId AND ContestantID = @contestantId;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      return res.json({ message: 'Result saved.', result: result.recordset[0] });
    } catch (error) {
      if (error.number === 51021) return res.status(403).json({ message: error.message });
      if ([51020, 51022, 51023, 51049, 51050].includes(error.number)) return res.status(409).json({ message: error.message });
      if (error.number === 547) return res.status(409).json({ message: 'The scorer was not recorded. Restart the app and save the result again.' });
      if ([2601, 2627, 1205].includes(error.number)) {
        return res.status(409).json({ message: 'Another save overlapped with this one. Reload the contestants and try again.' });
      }
      console.error('Save result error:', error);
      return res.status(500).json({ message: 'Unable to save the score.' });
    }
  });

  app.post('/api/results/approve', authMiddleware, async (req, res) => {
    const { EventID, EventAgeGroup, ReviewedResults } = req.body || {};
    if (![EventID, EventAgeGroup].every(validText))
      return res.status(400).json({ message: 'Select an event and age group.' });
    if (!Array.isArray(ReviewedResults) || !ReviewedResults.length
      || ReviewedResults.some((row) => !validText(row?.ContestantID)
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
      const result = await db.request()
        .input('eventId', sql.NVarChar(50), EventID.trim())
        .input('ageGroup', sql.NVarChar(50), EventAgeGroup.trim())
        .input('username', sql.NVarChar(255), username)
        .input('reviewedJson', sql.NVarChar(sql.MAX), JSON.stringify(ReviewedResults))
        .query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
          BEGIN TRY
            SELECT EventID, ContestantID INTO #registered FROM ${registrationSource} registrationsSource
              WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
            SELECT * INTO #results FROM dbo.PrePubResults WITH (UPDLOCK, HOLDLOCK)
              WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
            IF NOT EXISTS (SELECT 1 FROM #registered)
              THROW 51040, 'No registered contestants were found.', 1;
            IF EXISTS (SELECT 1 FROM #registered GROUP BY EventID, ContestantID HAVING COUNT(*) > 1)
              THROW 51046, 'Conflicting registrations must be corrected before approval.', 1;
            IF EXISTS (SELECT 1 FROM #registered r LEFT JOIN #results p
                ON p.EventID=r.EventID AND p.ContestantID=r.ContestantID WHERE p.ContestantID IS NULL)
              THROW 51041, 'Save every registered contestant result before approval.', 1;
            IF EXISTS (SELECT 1 FROM #results WHERE CheckedApproved='approved')
              THROW 51042, 'This event and age group is already approved.', 1;
              SELECT ContestantID, Score, EventAttendence, Place, Points INTO #reviewed
              FROM OPENJSON(@reviewedJson) WITH (
                ContestantID nvarchar(50) '$.ContestantID',
                Score decimal(12,2) '$.Score', EventAttendence varchar(10) '$.EventAttendence',
                Place varchar(6) '$.Place', Points int '$.Points');
              IF (SELECT COUNT(*) FROM #reviewed) <> (SELECT COUNT(*) FROM #results)
                OR EXISTS (SELECT 1 FROM #reviewed GROUP BY ContestantID HAVING COUNT(*) > 1)
                OR EXISTS (SELECT 1 FROM #results p LEFT JOIN #reviewed r
                  ON r.ContestantID=p.ContestantID WHERE r.ContestantID IS NULL
                  OR RTRIM(p.EventAttendence) <> r.EventAttendence
                  OR (RTRIM(p.EventAttendence)='WalkOver' AND
                    (r.Place IS NULL OR r.Place<>p.Place OR r.Points IS NULL OR r.Points<>p.Points))
                  OR (p.Score IS NULL AND r.Score IS NOT NULL)
                  OR (p.Score IS NOT NULL AND (r.Score IS NULL OR p.Score <> r.Score)))
                THROW 51047, 'Scores changed or some results were not reviewed. Reload the list.', 1;
              IF EXISTS (SELECT 1 FROM #results WHERE ScoreLastEditedBy IS NULL)
                THROW 51048, 'Some results have no recorded scorer. Resave them on Results entry.', 1;
              IF EXISTS (SELECT 1 FROM #results WHERE
                @username COLLATE Latin1_General_100_CI_AS = ScoreLastEditedBy COLLATE Latin1_General_100_CI_AS)
              THROW 51044, 'You entered or edited a score in this group and cannot approve it.', 1;
            IF EXISTS (SELECT 1 FROM #results WHERE RTRIM(EventAttendence)='Completed' AND Score IS NULL)
              THROW 51045, 'A completed contestant is missing a score.', 1;
            DECLARE @approvedAt datetime2(0)=SYSUTCDATETIME();
            UPDATE dbo.PrePubResults SET CheckedApproved='approved', CheckedApprovedby=@username
              WHERE EventID=@eventId AND EventAgeGroup=@ageGroup;
            ${publishWinners}
            SELECT COUNT(*) AS PublishedCount FROM dbo.PublishedResults
              WHERE EventID=@eventId AND EventAgeGroup=@ageGroup AND ApprovedAt=@approvedAt;
            COMMIT TRANSACTION;
          END TRY BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW;
          END CATCH;`);
      notifyPublishedResults();
      return res.json({ message: 'Results approved and top places published.', publishedCount: result.recordset[0].PublishedCount });
    } catch (error) {
      if ([51040, 51041, 51042, 51043, 51044, 51045, 51046, 51047, 51048, 51049, 51050, 2601, 2627, 1205].includes(error.number))
        return res.status(409).json({ message: error.message });
      console.error('Approve results error:', error);
      return res.status(500).json({ message: 'Unable to approve and publish results.' });
    }
  });
};
