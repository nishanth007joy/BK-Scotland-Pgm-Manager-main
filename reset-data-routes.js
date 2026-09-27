const crypto = require('crypto');

module.exports = function registerResetData(app, { db, dbReady, requireAdmin, activeSessions }) {
  const tables = ['PublishedResults', 'PrePubResults', 'GroupContestants', 'EventRegistrations', 'Contestants'];
  app.get('/api/admin/reset-data', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await dbReady;
      const result = await db.request().query(tables.map(table =>
        `SELECT '${table}' AS TableName, COUNT_BIG(*) AS [RowCount] FROM dbo.${table}`).join(' UNION ALL '));
      const token = crypto.randomBytes(32).toString('hex');
      req.session.resetData = { token, expires: Date.now() + 10 * 60 * 1000 };
      res.json({ tables: result.recordset, token });
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
    if (activeSessions.list().some(session => session.account !== req.session.accountKey)) {
      return res.status(409).json({ message: 'Other users are signed in. Ask them to finish and log out before deleting data.' });
    }
    delete req.session.resetData;
    try {
      // Persist consumption before running a destructive request.
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      await dbReady;
      await db.request().query(`SET XACT_ABORT ON;
        BEGIN TRY
          BEGIN TRANSACTION;
          ${tables.map(table => `DELETE FROM dbo.${table} WITH (TABLOCKX);`).join('\n')}
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`);
      res.json({ message: 'Contestants, registrations and results have been deleted. Competition settings and ID sequences have been kept.' });
    } catch (error) {
      console.error('Reset data error:', error);
      res.status(500).json({ message: 'The reset could not be confirmed. Refresh and check the counts before trying again.' });
    }
  });
};
