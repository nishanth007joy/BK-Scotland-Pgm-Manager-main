-- Preserve existing scores and check constraints while enabling hundredths.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @table sysname, @drop nvarchar(max), @restore nvarchar(max);
    DECLARE score_tables CURSOR LOCAL FAST_FORWARD FOR
        SELECT t.name FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
        WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name IN ('PrePubResults', 'PublishedResults')
          AND c.name = 'Score'
          AND (TYPE_NAME(c.system_type_id) <> 'decimal' OR c.precision <> 12 OR c.scale <> 2);
    OPEN score_tables;
    FETCH NEXT FROM score_tables INTO @table;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @drop = N'';
        SET @restore = N'';
        -- SQL Server requires dependent checks to be removed before altering a type.
        -- Restore their original definitions, trust and enabled state in this transaction.
        SELECT @drop = @drop + N'ALTER TABLE dbo.' + QUOTENAME(@table) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';',
            @restore = @restore + N'ALTER TABLE dbo.' + QUOTENAME(@table)
                + CASE WHEN is_not_trusted = 1 THEN N' WITH NOCHECK' ELSE N' WITH CHECK' END
                + N' ADD CONSTRAINT ' + QUOTENAME(name) + N' CHECK '
                + CASE WHEN is_not_for_replication = 1 THEN N'NOT FOR REPLICATION ' ELSE N'' END
                + definition + N';'
                + CASE WHEN is_disabled = 1 THEN N'ALTER TABLE dbo.' + QUOTENAME(@table)
                    + N' NOCHECK CONSTRAINT ' + QUOTENAME(name) + N';' ELSE N'' END
        FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.' + @table);
        EXEC sp_executesql @drop;
        DECLARE @alter nvarchar(max) = N'ALTER TABLE dbo.' + QUOTENAME(@table) + N' ALTER COLUMN Score decimal(12,2) NULL;';
        EXEC sp_executesql @alter;
        EXEC sp_executesql @restore;
        FETCH NEXT FROM score_tables INTO @table;
    END;
    CLOSE score_tables;
    DEALLOCATE score_tables;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
