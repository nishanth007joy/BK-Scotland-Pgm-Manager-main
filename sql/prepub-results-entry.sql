SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    -- 'not approved' requires 12 characters; the original char(10) is too short.
    ALTER TABLE dbo.PrePubResults ALTER COLUMN CheckedApproved varchar(12) NOT NULL;
    ALTER TABLE dbo.PrePubResults ALTER COLUMN CheckedApprovedby nvarchar(255) NULL;
    ALTER TABLE dbo.PrePubResults ALTER COLUMN Score decimal(12,2) NULL;
    UPDATE dbo.PrePubResults SET EventAttendence = 'Completed' WHERE RTRIM(EventAttendence) = 'Present';
    IF OBJECT_ID('dbo.CK_PrePubResults_AttendanceScore', 'C') IS NULL
        ALTER TABLE dbo.PrePubResults WITH CHECK ADD CONSTRAINT CK_PrePubResults_AttendanceScore
            CHECK ((RTRIM(EventAttendence) = 'Completed' AND Score IS NOT NULL)
                OR (RTRIM(EventAttendence) = 'NoShow' AND Score IS NULL));
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.PrePubResults') AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.PrePubResults'), 'CheckedApproved', 'ColumnId'))
        ALTER TABLE dbo.PrePubResults ADD CONSTRAINT DF_PrePubResults_CheckedApproved DEFAULT ('not approved') FOR CheckedApproved;
    IF OBJECT_ID('dbo.CK_PrePubResults_CheckedApproved', 'C') IS NULL
        ALTER TABLE dbo.PrePubResults WITH CHECK ADD CONSTRAINT CK_PrePubResults_CheckedApproved
            CHECK (CheckedApproved COLLATE Latin1_General_100_BIN2 IN ('approved', 'not approved'));
    IF OBJECT_ID('dbo.CK_PrePubResults_Score', 'C') IS NULL
        ALTER TABLE dbo.PrePubResults WITH CHECK ADD CONSTRAINT CK_PrePubResults_Score CHECK (Score >= 0);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PrePubResults') AND name = 'UX_PrePubResults_EventContestant')
        CREATE UNIQUE INDEX UX_PrePubResults_EventContestant ON dbo.PrePubResults (EventID, ContestantID);
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
