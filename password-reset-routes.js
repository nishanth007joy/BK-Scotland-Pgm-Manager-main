const crypto = require('crypto');

module.exports = function registerPasswordReset(app, { db, dbReady, sql, requireAdmin, hashPassword, activeSessions }) {
  app.get('/api/admin/password-users', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const result = await db.request().query('SELECT name, email FROM dbo.users ORDER BY name, email;');
      req.session.passwordResetToken = crypto.randomBytes(32).toString('hex');
      res.json({ users: result.recordset.filter(user => user.email
        && user.email.trim().toLowerCase() !== req.session.accountKey), token: req.session.passwordResetToken });
    } catch (error) {
      console.error('Password reset user list failed:', error);
      res.status(500).json({ message: 'Unable to load users.' });
    }
  });

  app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { email, password, token } = req.body || {};
    if (!req.session.passwordResetToken || token !== req.session.passwordResetToken) {
      return res.status(403).json({ message: 'Refresh this page before resetting a password.' });
    }
    if (typeof email !== 'string' || !email.trim() || email.length > 255
      || typeof password !== 'string' || password.length < 8 || password.length > 256) {
      return res.status(400).json({ message: 'Select a user and enter a password of 8 to 256 characters.' });
    }
    const account = email.trim().toLowerCase();
    if (account === req.session.accountKey) {
      return res.status(400).json({ message: 'This page resets passwords for other users only.' });
    }
    try {
      await dbReady;
      const result = await db.request()
        .input('email', sql.NVarChar(255), email.trim())
        .input('self', sql.NVarChar(255), req.session.accountKey)
        .input('passwordHash', sql.NVarChar(255), hashPassword(password))
        .query(`SET XACT_ABORT ON;
          BEGIN TRY
            BEGIN TRANSACTION;
            IF (SELECT COUNT(*) FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE email=@email) <> 1
              THROW 51070, 'Select one existing user.', 1;
            UPDATE dbo.users SET password_hash=@passwordHash
              OUTPUT INSERTED.email
              WHERE email=@email AND LOWER(LTRIM(RTRIM(email)))<>@self;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      if (!result.recordset.length) return res.status(400).json({ message: 'This page resets passwords for other users only.' });
      const target = result.recordset[0].email.trim().toLowerCase();
      for (const session of activeSessions.list()) {
        if (session.account === target) activeSessions.revoke(session.account, session.id);
      }
      return res.json({ message: 'Password reset. The user must sign in again with the new password.' });
    } catch (error) {
      // Do not log request bodies, passwords or SQL parameter values.
      console.error('Password reset failed:', error.code, error.number);
      res.status(error.number === 51070 ? 400 : 500).json({ message: error.number === 51070
        ? 'Select one existing user.' : 'Unable to reset the password.' });
    }
  });
};
