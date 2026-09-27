SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.users') AND name = 'CK_users_role')
        ALTER TABLE dbo.users DROP CONSTRAINT CK_users_role;
    ALTER TABLE dbo.users ALTER COLUMN role varchar(20) NOT NULL;
    ALTER TABLE dbo.users ADD CONSTRAINT CK_users_role CHECK (role IN ('admin', 'data-entry', 'resultboard'));
    UPDATE dbo.users SET role = 'resultboard' WHERE LOWER(LTRIM(RTRIM(name))) = 'resultboard';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
