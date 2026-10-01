const { createHash } = require('node:crypto');
const pgTables = ['events', 'event_registrations', 'group_contestants', 'prepub_results', 'published_results'];

module.exports = function registerAdminEventNames(app, { db, dbReady, requireAdmin }) {
  async function handle(req, res, saving) {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    const name = typeof req.body?.EventName === 'string' ? req.body.EventName.trim() : '';
    if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid event.' });
    if (saving && (!name || name.length > 50 || req.body.confirmed !== true || typeof req.body.token !== 'string'))
      return res.status(400).json({ message: 'Enter an event name (up to 50 characters), review all entries and confirm.' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const buildQuery = (sql, params = {}) => {
        const values = [];
        const indices = {};
        let counter = 0;
        const text = sql.replace(/@([a-zA-Z_]\w*)/g, (_, n) => {
          if (!(n in indices)) { indices[n] = ++counter; values.push(params[n] ?? null); }
          return `$${indices[n]}`;
        });
        return { text, values };
      };
      const tq = (sql, params = {}) => {
        const q = buildQuery(sql, params);
        return client.query(q).then(r => ({ recordset: r.rows, rowCount: r.rowCount }));
      };

      const snapshots = await Promise.all(
        pgTables.map(table => tq(`SELECT * FROM ${table} WHERE event_id = @id FOR UPDATE`, { id }))
      );
      const records = snapshots.map(r => r.recordset.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

      if (records[0].length !== 1) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Event missing or ambiguous. Reload the event list.' });
      }

      const token = createHash('sha256').update(JSON.stringify(records)).digest('hex');

      if (!saving) {
        await client.query('COMMIT');
        return res.json({
          token,
          event: records[0][0],
          registrations: records[1],
          groups: records[2],
          prepubResults: records[3],
          publishedResults: records[4],
        });
      }

      if (token !== req.body.token) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Event, registrations or results changed. Review the latest details and confirm again.' });
      }

      for (const table of pgTables) {
        await tq(`UPDATE ${table} SET event_name = @name WHERE event_id = @id`, { name, id });
      }

      await client.query('COMMIT');
      return res.json({ message: 'Event name updated in the event, all registrations and all results.' });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (db.errorNumber(error) === 23505 || db.errorNumber(error) === 1205)
        return res.status(409).json({ message: 'Conflicting event details or a concurrent update. Review and try again.' });
      console.error('Admin event rename error:', error);
      return res.status(500).json({ message: 'Unable to update the event name. No changes were saved.' });
    } finally {
      client.release();
    }
  }

  app.get('/api/admin/event-names/:id', requireAdmin, (req, res) => handle(req, res, false));
  app.put('/api/admin/event-names/:id', requireAdmin, (req, res) => handle(req, res, true));
};
