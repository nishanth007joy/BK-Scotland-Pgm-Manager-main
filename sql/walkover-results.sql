SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.PrePubResults', 'Place') IS NULL
        ALTER TABLE dbo.PrePubResults ADD Place varchar(6) NULL;
    IF COL_LENGTH('dbo.PrePubResults', 'Points') IS NULL
        ALTER TABLE dbo.PrePubResults ADD Points int NULL;
    IF COL_LENGTH('dbo.PublishedResults', 'IsWalkOver') IS NULL
        ALTER TABLE dbo.PublishedResults ADD IsWalkOver bit NOT NULL
            CONSTRAINT DF_PublishedResults_IsWalkOver DEFAULT (0) WITH VALUES;
    -- Preserve the score datatype when enabling scoreless WalkOver results.
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PublishedResults') AND name = 'Score' AND is_nullable = 0)
    BEGIN
        DECLARE @scoreType nvarchar(100);
        SELECT @scoreType = TYPE_NAME(system_type_id) +
            CASE WHEN TYPE_NAME(system_type_id) IN ('decimal', 'numeric')
                THEN '(' + CAST(precision AS varchar(3)) + ',' + CAST(scale AS varchar(3)) + ')' ELSE '' END
        FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PublishedResults') AND name = 'Score';
        EXEC(N'ALTER TABLE dbo.PublishedResults ALTER COLUMN Score ' + @scoreType + N' NULL;');
    END;
    IF OBJECT_ID('dbo.CK_PrePubResults_AttendanceScore', 'C') IS NOT NULL
        ALTER TABLE dbo.PrePubResults DROP CONSTRAINT CK_PrePubResults_AttendanceScore;
    EXEC(N'ALTER TABLE dbo.PrePubResults WITH CHECK ADD CONSTRAINT CK_PrePubResults_AttendanceScore
        CHECK ((RTRIM(EventAttendence) = ''Completed'' AND Score IS NOT NULL AND Place IS NULL AND Points IS NULL)
          OR (RTRIM(EventAttendence) = ''NoShow'' AND Score IS NULL AND Place IS NULL AND Points IS NULL)
          OR (RTRIM(EventAttendence) = ''WalkOver'' AND Score IS NULL AND Place IS NOT NULL
            AND Place = ''First'' AND Points IS NOT NULL AND Points >= 0));');
    IF OBJECT_ID('dbo.CK_PublishedResults_WalkOver', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.PublishedResults WITH CHECK ADD CONSTRAINT CK_PublishedResults_WalkOver
            CHECK ((IsWalkOver=0 AND Score IS NOT NULL)
              OR (IsWalkOver=1 AND Score IS NULL AND Place=''First''));');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
