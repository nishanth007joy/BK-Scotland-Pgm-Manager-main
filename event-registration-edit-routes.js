module.exports = (app, { db, dbReady, sql, authMiddleware }) => {
  app.get('/api/event-registrations', authMiddleware, async (req, res) => {
    try {
      await dbReady;
      const result = await db.request().query(`SELECT EventID, ContestantID, EventName, EventAgeGroup,
        ContestantFirstName, ContestantLastName, ContestantMission, ChestNo, Comments
        FROM dbo.EventRegistrations ORDER BY EventName, ContestantFirstName, ContestantLastName;`);
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
    const originalFields = ['EventID', 'ContestantID', 'EventName', 'EventAgeGroup', 'ContestantFirstName', 'ContestantLastName', 'ContestantMission', 'ChestNo', 'Comments'];
    if (!original || originalFields.some(field => (original[field] != null && typeof original[field] !== 'string') || (original[field] || '').length > 50) || !original.EventID || !original.ContestantID)
      return res.status(400).json({ message: 'Reload the registration before editing.' });
    try {
      await dbReady;
      const request = db.request();
      for (const field of ['EventID', 'ContestantID', 'Comments']) request.input(field, sql.NVarChar(50), data[field] || null);
      for (const field of originalFields) request.input(`old${field}`, sql.NVarChar(50), original[field] || null);
      await request.query(`SET XACT_ABORT ON; BEGIN TRANSACTION; BEGIN TRY
        IF (SELECT COUNT(*) FROM dbo.EventRegistrations WITH (UPDLOCK,HOLDLOCK)
          WHERE EventID=@oldEventID AND ContestantID=@oldContestantID)<>1
          THROW 51060, 'Registration is missing or ambiguous. Reload before editing.', 1;
        IF EXISTS(SELECT 1 FROM dbo.PrePubResults WITH (UPDLOCK,HOLDLOCK)
          WHERE (EventID=@oldEventID AND ContestantID=@oldContestantID)
            OR (EventID=@EventID AND ContestantID=@ContestantID))
          THROW 51060, 'This registration has results and cannot be changed.', 1;
        IF EXISTS(SELECT 1 FROM dbo.PublishedResults WITH (UPDLOCK,HOLDLOCK)
          WHERE (EventID=@oldEventID AND ContestantID=@oldContestantID)
            OR (EventID=@EventID AND ContestantID=@ContestantID))
          THROW 51060, 'This registration has published results and cannot be changed.', 1;
        UPDATE r SET EventID=e.EventID, EventName=e.EventName, EventAgeGroup=e.EventAgeGroup,
          IndividualGroup=e.IndividualGroup, OnStageOffStage=e.OnStageOffStage,
          ContestantID=c.ID, ContestantFirstName=c.[First Name], ContestantLastName=c.[Last Name],
          ContestantMission=c.Mission, ChestNo=chest.ChestNo, Comments=@Comments
        FROM dbo.EventRegistrations r CROSS JOIN dbo.Events e CROSS JOIN dbo.Contestants c
        CROSS APPLY (SELECT CASE LOWER(REPLACE(REPLACE(RTRIM(e.OnStageOffStage),' ',''),'-',''))
          WHEN 'onstage' THEN c.OnStageChestNo WHEN 'offstage' THEN c.OffStageChestNo END AS ChestNo) chest
        WHERE r.EventID=@oldEventID AND r.ContestantID=@oldContestantID
          AND ${originalFields.slice(2).map(field => `ISNULL(RTRIM(r.[${field}]),'')=ISNULL(RTRIM(@old${field}),'')`).join(' AND ')}
          AND e.EventID=@EventID AND c.ID=@ContestantID
          AND (SELECT COUNT(*) FROM dbo.Events WHERE EventID=@EventID)=1
          AND (SELECT COUNT(*) FROM dbo.Contestants WHERE ID=@ContestantID)=1
          AND (LOWER(RTRIM(e.IndividualGroup))<>'individual' OR LOWER(RTRIM(e.EventAgeGroup))=LOWER(RTRIM(c.AgeGroup)))
          AND NULLIF(RTRIM(chest.ChestNo),'') IS NOT NULL;
        IF @@ROWCOUNT<>1 THROW 51060, 'Registration changed or the selected contestant is not eligible. Reload and check the age group and chest number.', 1;
        COMMIT TRANSACTION;
      END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; THROW; END CATCH;`);
      res.json({ message: 'Event registration updated.' });
    } catch (error) {
      if ([51060, 51001, 51004, 2601, 2627, 1205].includes(error.number)) return res.status(409).json({ message: error.number === 51004 ? 'This contestant already has the maximum of three individual registrations.' : [2601, 2627, 51001].includes(error.number) ? 'This contestant is already registered for the selected event.' : error.message });
      console.error('Edit registration:', error);
      res.status(500).json({ message: 'Unable to update the registration.' });
    }
  });
};
