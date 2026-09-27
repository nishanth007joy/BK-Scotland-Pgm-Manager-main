-- Preserve existing IDs and generate C-prefixed IDs for new contestants.
-- Run before deploying the updated contestant save handler. Safe to rerun.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @maximum bigint;
    SELECT @maximum = ISNULL(MAX(TRY_CONVERT(bigint, SUBSTRING(ID, 2, 49))), 0)
    FROM dbo.Contestants WITH (TABLOCKX, HOLDLOCK)
    WHERE ID LIKE 'C%';

    IF OBJECT_ID('dbo.ContestantIdSequence', 'SO') IS NULL
    BEGIN
        DECLARE @start bigint = @maximum + 1;
        DECLARE @statement nvarchar(max) =
            N'CREATE SEQUENCE dbo.ContestantIdSequence AS bigint START WITH '
            + CONVERT(nvarchar(20), @start) + N' INCREMENT BY 1 NO CYCLE NO CACHE;';
        EXEC sys.sp_executesql @statement;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.Contestants')
          AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Contestants'), 'ID', 'ColumnId')
    )
        EXEC sys.sp_executesql N'ALTER TABLE dbo.Contestants
            ADD CONSTRAINT DF_Contestants_ID
            DEFAULT (N''C'' + CONVERT(nvarchar(20), NEXT VALUE FOR dbo.ContestantIdSequence)) FOR ID;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
