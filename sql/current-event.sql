-- One display setting, independent of contestant and result data.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF OBJECT_ID('dbo.CurrentEvent', 'U') IS NULL
        CREATE TABLE dbo.CurrentEvent (
            ID int NOT NULL CONSTRAINT PK_CurrentEvent PRIMARY KEY,
            CurrentEventName nvarchar(200) NOT NULL,
            CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_CurrentEvent_CreatedAt DEFAULT SYSUTCDATETIME(),
            CONSTRAINT CK_CurrentEvent_SingleRow CHECK (ID = 1),
            CONSTRAINT CK_CurrentEvent_Name CHECK (LEN(LTRIM(RTRIM(CurrentEventName))) > 0)
        );
    IF NOT EXISTS (SELECT 1 FROM dbo.CurrentEvent WITH (UPDLOCK, HOLDLOCK) WHERE ID = 1)
        INSERT INTO dbo.CurrentEvent (ID, CurrentEventName)
        VALUES (1, N'Bible Kalothsavam - Scotland 2026');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
