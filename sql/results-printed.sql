SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.PublishedResults', 'ResultsPrinted') IS NULL
        ALTER TABLE dbo.PublishedResults ADD ResultsPrinted varchar(3) NOT NULL
            CONSTRAINT DF_PublishedResults_ResultsPrinted DEFAULT ('No') WITH VALUES;

    -- Compile the constraint after the new column has been created.
    IF OBJECT_ID('dbo.CK_PublishedResults_ResultsPrinted', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.PublishedResults WITH CHECK
            ADD CONSTRAINT CK_PublishedResults_ResultsPrinted
            CHECK (ResultsPrinted IN (''Yes'', ''No''));');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
