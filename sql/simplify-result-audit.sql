SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.PrePubResults', 'ScoreLastEditedBy') IS NULL
        ALTER TABLE dbo.PrePubResults ADD ScoreLastEditedBy nvarchar(255) NULL;
    IF COL_LENGTH('dbo.PrePubResults', 'ScoreEnteredBy') IS NOT NULL
    BEGIN
        UPDATE dbo.PrePubResults SET ScoreLastEditedBy = COALESCE(ScoreLastEditedBy, ScoreEnteredBy)
          WHERE ScoreLastEditedBy IS NULL;
        ALTER TABLE dbo.PrePubResults DROP COLUMN ScoreEnteredBy;
    END;
    IF COL_LENGTH('dbo.PrePubResults', 'CrossCheckedBy') IS NOT NULL
        ALTER TABLE dbo.PrePubResults DROP COLUMN CrossCheckedBy;
    IF COL_LENGTH('dbo.PrePubResults', 'CrossCheckedAt') IS NOT NULL
        ALTER TABLE dbo.PrePubResults DROP COLUMN CrossCheckedAt;
    IF COL_LENGTH('dbo.PrePubResults', 'ApprovedAt') IS NOT NULL
        ALTER TABLE dbo.PrePubResults DROP COLUMN ApprovedAt;
    IF COL_LENGTH('dbo.PublishedResults', 'ScoreEnteredBy') IS NOT NULL
        ALTER TABLE dbo.PublishedResults DROP COLUMN ScoreEnteredBy;
    IF COL_LENGTH('dbo.PublishedResults', 'CrossCheckedBy') IS NOT NULL
        ALTER TABLE dbo.PublishedResults DROP COLUMN CrossCheckedBy;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
