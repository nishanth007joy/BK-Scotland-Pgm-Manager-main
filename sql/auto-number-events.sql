-- Preserve existing IDs and generate E-prefixed IDs for new events.
-- Run before deploying the updated event save handler. Safe to rerun.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @maximum bigint;
    SELECT @maximum = ISNULL(MAX(TRY_CONVERT(bigint, SUBSTRING(EventID, 2, 49))), 0)
    FROM dbo.Events WITH (TABLOCKX, HOLDLOCK)
    WHERE EventID LIKE 'E%';

    IF OBJECT_ID('dbo.EventIdSequence', 'SO') IS NULL
    BEGIN
        DECLARE @start bigint = @maximum + 1;
        DECLARE @statement nvarchar(max) =
            N'CREATE SEQUENCE dbo.EventIdSequence AS bigint START WITH '
            + CONVERT(nvarchar(20), @start) + N' INCREMENT BY 1 NO CYCLE NO CACHE;';
        EXEC sys.sp_executesql @statement;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.Events')
          AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Events'), 'EventID', 'ColumnId')
    )
        EXEC sys.sp_executesql N'ALTER TABLE dbo.Events
            ADD CONSTRAINT DF_Events_EventID
            DEFAULT (N''E'' + CONVERT(nvarchar(20), NEXT VALUE FOR dbo.EventIdSequence)) FOR EventID;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
