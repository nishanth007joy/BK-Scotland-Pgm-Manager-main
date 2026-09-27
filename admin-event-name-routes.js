const { createHash } = require('node:crypto');
const tables = ['Events', 'EventRegistrations', 'GroupContestants', 'PrePubResults', 'PublishedResults'];
module.exports = function registerAdminEventNames(app, { db, dbReady, sql, requireAdmin }) {
  async function handle(req, res, saving) {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    const name = typeof req.body?.EventName === 'string' ? req.body.EventName.trim() : '';
    if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid event.' });
    if (saving && (!name || name.length > 50 || req.body.confirmed !== true || typeof req.body.token !== 'string'))
      return res.status(400).json({ message: 'Enter an event name (up to 50 characters), review all entries and confirm.' });
    let tx;
    try {
      await dbReady;
      tx = new sql.Transaction(db);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const request = () => new sql.Request(tx).input('id', sql.NVarChar(50), id);
      const result = await request().query(tables.map(table =>
        `SELECT * FROM dbo.${table} WITH (UPDLOCK,HOLDLOCK) WHERE EventID=@id;`).join('\n'));
      // Canonical ordering also detects new, removed or changed rows after review.
      const records = result.recordsets.map(rows => rows.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if (records[0].length !== 1) {
        await tx.rollback(); tx = null;
        return res.status(404).json({ message: 'Event missing or ambiguous. Reload the event list.' });
      }
      const token = createHash('sha256').update(JSON.stringify(records)).digest('hex');
      if (!saving) {
        await tx.commit(); tx = null;
        return res.json({ token, event: records[0][0], registrations: records[1], groups: records[2], prepubResults: records[3], publishedResults: records[4] });
      }
      if (token !== req.body.token) {
        await tx.rollback(); tx = null;
        return res.status(409).json({ message: 'Event, registrations or results changed. Review the latest details and confirm again.' });
      }
      await request().input('name', sql.VarChar(50), name).query(tables.map(table =>
        `UPDATE dbo.${table} SET EventName=@name WHERE EventID=@id;`).join('\n'));
      await tx.commit(); tx = null;
      return res.json({ message: 'Event name updated in the event, all registrations and all results.' });
    } catch (error) {
      if (tx) { try { await tx.rollback(); } catch (_) {} }
      if ([2601, 2627, 1205].includes(error.number)) return res.status(409).json({ message: 'Conflicting event details or a concurrent update. Review and try again.' });
      console.error('Admin event rename error:', error);
      return res.status(500).json({ message: 'Unable to update the event name. No changes were saved.' });
    }
  }
  app.get('/api/admin/event-names/:id', requireAdmin, (req, res) => handle(req, res, false));
  app.put('/api/admin/event-names/:id', requireAdmin, (req, res) => handle(req, res, true));
};
