SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.PublishedResults', 'Points') IS NULL
        ALTER TABLE dbo.PublishedResults ADD Points int NULL;
    IF EXISTS (
        SELECT 1 FROM dbo.PublishedResults p OUTER APPLY (
            SELECT COUNT(*) AS MatchCount FROM dbo.EventPoints ep
            WHERE UPPER(REPLACE(LTRIM(RTRIM(ep.IndividualGroup)), ' ', '')) =
                UPPER(REPLACE(LTRIM(RTRIM(p.IndividualGroup)), ' ', ''))
              AND UPPER(REPLACE(LTRIM(RTRIM(ep.OnStageOffStage)), ' ', '')) =
                UPPER(REPLACE(LTRIM(RTRIM(p.OnStageOffStage)), ' ', ''))
        ) ep WHERE ep.MatchCount <> 1
    ) THROW 51049, 'A published winner has no unique EventPoints rule.', 1;
    EXEC sp_executesql N'
      UPDATE p SET Points = CASE p.Place
          WHEN ''First'' THEN ep.FirstPlace WHEN ''Second'' THEN ep.SecondPlace ELSE ep.ThirdPlace END
      FROM dbo.PublishedResults p JOIN dbo.EventPoints ep
        ON UPPER(REPLACE(LTRIM(RTRIM(p.IndividualGroup)), '' '', '''')) =
           UPPER(REPLACE(LTRIM(RTRIM(ep.IndividualGroup)), '' '', ''''))
       AND UPPER(REPLACE(LTRIM(RTRIM(p.OnStageOffStage)), '' '', '''')) =
           UPPER(REPLACE(LTRIM(RTRIM(ep.OnStageOffStage)), '' '', ''''));';
    ALTER TABLE dbo.PublishedResults ALTER COLUMN Points int NOT NULL;
    IF OBJECT_ID('dbo.CK_PublishedResults_Points', 'C') IS NULL
        EXEC sp_executesql N'ALTER TABLE dbo.PublishedResults WITH CHECK
          ADD CONSTRAINT CK_PublishedResults_Points CHECK (Points >= 0)';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
