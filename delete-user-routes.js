const crypto = require('node:crypto');
module.exports = function registerDeleteUsers(app, { db, dbReady, requireAdmin, activeSessions }) {
  app.get('/api/admin/delete-users', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const result = await db.query('SELECT name, email, role FROM users ORDER BY name, email');
      req.session.deleteUserToken = crypto.randomBytes(32).toString('hex');
      res.json({
        users: result.recordset.filter(row => row.email && row.email.trim().toLowerCase() !== req.session.accountKey),
        token: req.session.deleteUserToken,
      });
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
      await db.withTransaction(async (tq) => {
        const check = await tq('SELECT 1 FROM users WHERE email = @email FOR UPDATE', { email: email.trim() });
        if (check.recordset.length !== 1)
          throw Object.assign(new Error('[51070] Select one existing user.'), {});
        const deleted = await tq(
          'DELETE FROM users WHERE email = @email AND LOWER(TRIM(email)) <> @self RETURNING email',
          { email: email.trim(), self: req.session.accountKey }
        );
        if (!deleted.rowCount)
          throw Object.assign(new Error('[51070] Select another existing user.'), {});
      });
      for (const s of activeSessions.list()) {
        if (s.account === email.trim().toLowerCase()) activeSessions.revoke(s.account, s.id);
      }
      res.json({ message: 'Login account deleted. All associated records have been retained.' });
    } catch (error) {
      const ce = db.getCustomError(error);
      if (ce && ce.number === 51070) return res.status(409).json({ message: ce.message });
      if (db.errorNumber(error) === 547)
        return res.status(409).json({ message: 'The account is referenced by other records. Deletion was blocked to retain those records.' });
      res.status(500).json({ message: 'Unable to delete the login account.' });
    }
  });
};
