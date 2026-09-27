-- Record UTC creation times for future contestants. Existing rows remain NULL.
-- Safe to rerun; applied automatically during server startup.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.Contestants', 'CreatedAt') IS NULL
        ALTER TABLE dbo.Contestants ADD CreatedAt datetime2(3) NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.default_constraints
        WHERE parent_object_id = OBJECT_ID('dbo.Contestants')
          AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('dbo.Contestants'), 'CreatedAt', 'ColumnId')
    )
        EXEC sys.sp_executesql N'ALTER TABLE dbo.Contestants
            ADD CONSTRAINT DF_Contestants_CreatedAt DEFAULT SYSUTCDATETIME() FOR CreatedAt;';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
