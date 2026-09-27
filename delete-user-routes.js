const crypto = require('node:crypto');
module.exports = function registerDeleteUsers(app, { db, dbReady, sql, requireAdmin, activeSessions }) {
  app.get('/api/admin/delete-users', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const result = await db.request().query('SELECT name, email, role FROM dbo.users ORDER BY name, email;');
      req.session.deleteUserToken = crypto.randomBytes(32).toString('hex');
      res.json({ users: result.recordset.filter(row => row.email && row.email.trim().toLowerCase() !== req.session.accountKey), token: req.session.deleteUserToken });
    } catch (_) { res.status(500).json({ message: 'Unable to load users.' }); }
  });
  app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
    const { email, token, confirmed } = req.body || {};
    if (!req.session.deleteUserToken || token !== req.session.deleteUserToken)
      return res.status(403).json({ message: 'Reload the user list before deleting.' });
    if (typeof email !== 'string' || !email.trim() || email.length > 255 || confirmed !== true)
      return res.status(400).json({ message: 'Select a user and confirm deletion.' });
    if (email.trim().toLowerCase() === req.session.accountKey)
      return res.status(400).json({ message: 'You cannot delete your own login account.' });
    try {
      await dbReady;
      await db.request().input('email', sql.NVarChar(255), email.trim())
        .input('self', sql.NVarChar(255), req.session.accountKey).query(`SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE referenced_object_id=OBJECT_ID('dbo.users') AND delete_referential_action<>0 AND is_disabled=0)
            OR EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID('dbo.users') AND is_disabled=0)
            THROW 51071, 'Deletion blocked because database rules could change associated records.', 1;
          IF (SELECT COUNT(*) FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE email=@email)<>1
            THROW 51070, 'Select one existing user.', 1;
          DELETE FROM dbo.users WHERE email=@email AND LOWER(LTRIM(RTRIM(email)))<>@self;
          IF @@ROWCOUNT<>1 THROW 51070, 'Select another existing user.', 1;
          COMMIT TRANSACTION;
        END TRY BEGIN CATCH
          IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; THROW;
        END CATCH;`);
      for (const session of activeSessions.list()) {
        if (session.account === email.trim().toLowerCase()) activeSessions.revoke(session.account, session.id);
      }
      res.json({ message: 'Login account deleted. All associated records have been retained.' });
    } catch (error) {
      const message = error.number === 51071 ? error.message : error.number === 547
        ? 'The account is referenced by other records. Deletion was blocked to retain those records.'
        : error.number === 51070 ? 'User no longer exists or is ambiguous. Reload the list.' : 'Unable to delete the login account.';
      res.status([51071,51070,547].includes(error.number) ? 409 : 500).json({ message });
    }
  });
};
