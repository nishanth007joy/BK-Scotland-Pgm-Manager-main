const crypto = require('crypto');

module.exports = function registerPasswordReset(app, { db, dbReady, requireAdmin, hashPassword, activeSessions }) {
  app.get('/api/admin/password-users', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const result = await db.query('SELECT name, email FROM users ORDER BY name, email');
      req.session.passwordResetToken = crypto.randomBytes(32).toString('hex');
      res.json({
        users: result.recordset.filter(user => user.email && user.email.trim().toLowerCase() !== req.session.accountKey),
        token: req.session.passwordResetToken,
      });
    } catch (error) {
      console.error('Password reset user list failed:', error);
      res.status(500).json({ message: 'Unable to load users.' });
    }
  });

  app.post('/api/admin/reset-password', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { email, password, token } = req.body || {};
    if (!req.session.passwordResetToken || token !== req.session.passwordResetToken)
      return res.status(403).json({ message: 'Refresh this page before resetting a password.' });
    if (typeof email !== 'string' || !email.trim() || email.length > 255
      || typeof password !== 'string' || password.length < 8 || password.length > 256)
      return res.status(400).json({ message: 'Select a user and enter a password of 8 to 256 characters.' });
    const account = email.trim().toLowerCase();
    if (account === req.session.accountKey)
      return res.status(400).json({ message: 'This page resets passwords for other users only.' });
    try {
      await dbReady;
      const result = await db.withTransaction(async (tq) => {
        const check = await tq('SELECT email FROM users WHERE email = @email FOR UPDATE', { email: email.trim() });
        if (check.recordset.length !== 1)
          throw Object.assign(new Error('[51070] Select one existing user.'), {});
        return tq(
          'UPDATE users SET password_hash = @passwordHash WHERE email = @email AND LOWER(TRIM(email)) <> @self RETURNING email',
          { passwordHash: hashPassword(password), email: email.trim(), self: req.session.accountKey }
        );
      });
      if (!result.recordset.length)
        return res.status(400).json({ message: 'This page resets passwords for other users only.' });
      const target = result.recordset[0].email.trim().toLowerCase();
      for (const s of activeSessions.list()) {
        if (s.account === target) activeSessions.revoke(s.account, s.id);
      }
      return res.json({ message: 'Password reset. The user must sign in again with the new password.' });
    } catch (error) {
      // Do not log request bodies, passwords or SQL parameter values.
      console.error('Password reset failed:', error.code, db.errorNumber(error));
      const ce = db.getCustomError(error);
      res.status(ce?.number === 51070 ? 400 : 500).json({
        message: ce?.number === 51070 ? 'Select one existing user.' : 'Unable to reset the password.',
      });
    }
  });
};
