-- Preserve existing IDs and generate G-prefixed IDs for new group contestants.
-- Run before deploying the updated contestant save handler. Safe to rerun.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @maximum bigint;
    SELECT @maximum = ISNULL(MAX(TRY_CONVERT(bigint, SUBSTRING(ID, 2, 49))), 99)
    FROM dbo.GroupContestants WITH (TABLOCKX, HOLDLOCK)
    WHERE ID LIKE 'G%';

    IF OBJECT_ID('dbo.GroupContestantIdSequence', 'SO') IS NULL
    BEGIN
        DECLARE @start bigint = CASE WHEN @maximum < 99 THEN 100 ELSE @maximum + 1 END;
        DECLARE @statement nvarchar(max) =
            N'CREATE SEQUENCE dbo.GroupContestantIdSequence AS bigint START WITH '
            + CONVERT(nvarchar(20), @start) + N' INCREMENT BY 1 NO CYCLE NO CACHE;';
        EXEC sys.sp_executesql @statement;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.GroupContestants')
          AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.GroupContestants'), 'ID', 'ColumnId')
    )
        EXEC sys.sp_executesql N'ALTER TABLE dbo.GroupContestants
            ADD CONSTRAINT DF_GroupContestants_ID
            DEFAULT (N''G'' + CONVERT(nvarchar(20), NEXT VALUE FOR dbo.GroupContestantIdSequence)) FOR ID;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
