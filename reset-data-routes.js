const crypto = require('crypto');

module.exports = function registerResetData(app, { db, dbReady, requireAdmin, activeSessions }) {
  const tables = ['published_results', 'prepub_results', 'group_contestants', 'event_registrations', 'contestants', 'participants'];

  app.get('/api/admin/reset-data', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const counts = await Promise.all(
        tables.map(t => db.query(`SELECT '${t}' AS "TableName", COUNT(*) AS "RowCount" FROM ${t}`))
      );
      const token = crypto.randomBytes(32).toString('hex');
      req.session.resetData = { token, expires: Date.now() + 10 * 60 * 1000 };
      res.json({ tables: counts.map(r => r.recordset[0]), token });
    } catch (error) {
      console.error('Reset preview error:', error);
      res.status(500).json({ message: 'Unable to load reset details.' });
    }
  });

  app.post('/api/admin/reset-data', requireAdmin, async (req, res) => {
    const confirmation = req.session.resetData;
    if (!confirmation || confirmation.expires < Date.now() || req.body?.token !== confirmation.token
      || req.body?.confirmation !== 'DELETE COMPETITION DATA' || req.body?.backupConfirmed !== true) {
      return res.status(400).json({ message: 'Refresh the page, confirm your backup and type DELETE COMPETITION DATA.' });
    }
    if (activeSessions.list().some(s => s.account !== req.session.accountKey)) {
      return res.status(409).json({ message: 'Other users are signed in. Ask them to finish and log out before deleting data.' });
    }
    delete req.session.resetData;
    try {
      // Persist token consumption before running destructive request.
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      await dbReady;
      await db.withTransaction(async (tq) => {
        for (const table of tables) {
          await tq(`DELETE FROM ${table}`);
        }
      });
      res.json({ message: 'Contestants, registrations and results have been deleted. Competition settings and ID sequences have been kept.' });
    } catch (error) {
      console.error('Reset data error:', error);
      res.status(500).json({ message: 'The reset could not be confirmed. Refresh and check the counts before trying again.' });
    }
  });
};
