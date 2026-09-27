-- @adminUsername is supplied by the application from ADMIN_USERNAME.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.users', 'role') IS NULL
    BEGIN
        ALTER TABLE dbo.users ADD role varchar(10) NOT NULL
            CONSTRAINT DF_users_role DEFAULT ('data-entry') WITH VALUES;
        EXEC sp_executesql N'
            UPDATE dbo.users SET role = ''admin''
            WHERE @adminUsername <> ''''
              AND LOWER(LTRIM(RTRIM(name))) = @adminUsername;
            ALTER TABLE dbo.users ADD CONSTRAINT CK_users_role
                CHECK (role IN (''admin'', ''data-entry''));',
            N'@adminUsername nvarchar(255)', @adminUsername;
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
