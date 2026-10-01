const crypto = require('node:crypto');
const fields = ['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region', 'OnStageChestNo', 'OffStageChestNo', 'Comments'];
const memberIdCols = ['group_leader_id', ...Array.from({ length: 9 }, (_, i) => `participant_${i + 1}_id`)];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

module.exports = function registerAdminContestants(app, { db, dbReady, requireAdmin }) {
  const memberWhere = memberIdCols.map(c => `g.${c} = @id`).join(' OR ');

  async function snapshot(tq, id) {
    const [c, g, er, pr, pub] = await Promise.all([
      tq(`SELECT id AS "ContestantID", first_name AS "FirstName", last_name AS "LastName",
        age_group AS "AgeGroup", mission AS "Mission", region AS "Region",
        TRIM(on_stage_chest_no) AS "OnStageChestNo", TRIM(off_stage_chest_no) AS "OffStageChestNo",
        comments AS "Comments"
        FROM contestants WHERE id = @id FOR UPDATE`, { id }),
      tq(`SELECT * FROM group_contestants g WHERE ${memberWhere} ORDER BY g.id`, { id }),
      tq(`SELECT * FROM event_registrations WHERE
          (contestant_id = @id AND LOWER(TRIM(individual_group)) = 'individual')
          OR (LOWER(TRIM(individual_group)) = 'group' AND EXISTS (
            SELECT 1 FROM group_contestants g
            WHERE g.id = event_registrations.contestant_id
              AND g.event_id = event_registrations.event_id AND (${memberWhere})
          )) ORDER BY event_id, event_age_group, contestant_id`, { id }),
      tq(`SELECT * FROM prepub_results WHERE
          (contestant_id = @id AND LOWER(TRIM(individual_group)) = 'individual')
          OR (LOWER(TRIM(individual_group)) = 'group' AND EXISTS (
            SELECT 1 FROM group_contestants g
            WHERE g.id = prepub_results.contestant_id
              AND g.event_id = prepub_results.event_id AND (${memberWhere})
          )) ORDER BY event_id, event_age_group, contestant_id`, { id }),
      tq(`SELECT * FROM published_results WHERE
          (contestant_id = @id AND LOWER(TRIM(individual_group)) = 'individual')
          OR (LOWER(TRIM(individual_group)) = 'group' AND EXISTS (
            SELECT 1 FROM group_contestants g
            WHERE g.id = published_results.contestant_id
              AND g.event_id = published_results.event_id AND (${memberWhere})
          )) ORDER BY event_id, event_age_group, contestant_id`, { id }),
    ]);
    return { contestant: c.recordset[0], groups: g.recordset,
      registrations: er.recordset, prepubResults: pr.recordset, publishedResults: pub.recordset };
  }

  async function handle(req, res, saving) {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 50) return res.status(400).json({ message: 'Select a valid contestant.' });
    const updated = {};
    if (saving) {
      for (const field of fields) {
        const value = req.body?.[field];
        if (value != null && typeof value !== 'string')
          return res.status(400).json({ message: `${field} must be text.` });
        updated[field] = String(value || '').trim();
        const limit = ['OnStageChestNo', 'OffStageChestNo'].includes(field) ? 10 : 50;
        if (updated[field].length > limit)
          return res.status(400).json({ message: `${field} is too long.` });
      }
      if (['FirstName', 'LastName', 'AgeGroup', 'Mission', 'Region'].some(f => !updated[f]))
        return res.status(400).json({ message: 'First name, last name, age range, mission, and region are required.' });
      if (req.body?.confirmed !== true || typeof req.body?.token !== 'string')
        return res.status(400).json({ message: 'Review all entries and confirm before saving.' });
    }
    try {
      await dbReady;
      const result = await db.withTransaction(async (tq) => {
        const snap = await snapshot(tq, id);
        if (!snap.contestant) return { status: 404, message: 'Contestant not found. Reload the list.' };
        const token = digest([snap.contestant, snap.groups, snap.registrations, snap.prepubResults, snap.publishedResults]);
        if (!saving) {
          return { token, contestant: snap.contestant, groups: snap.groups,
            registrations: snap.registrations, prepubResults: snap.prepubResults,
            publishedResults: snap.publishedResults };
        }
        if (token !== req.body.token)
          return { status: 409, message: 'Contestant data changed since you loaded it. Reload and try again.' };

        const upd = await tq(`
          UPDATE contestants SET
            first_name = @firstName, last_name = @lastName, age_group = @ageGroup,
            mission = @mission, region = @region,
            on_stage_chest_no = @onStageChestNo, off_stage_chest_no = @offStageChestNo,
            comments = @comments
          WHERE id = @id RETURNING id
        `, {
          id,
          firstName: updated.FirstName, lastName: updated.LastName, ageGroup: updated.AgeGroup,
          mission: updated.Mission, region: updated.Region,
          onStageChestNo: updated.OnStageChestNo || null, offStageChestNo: updated.OffStageChestNo || null,
          comments: updated.Comments || null,
        });
        if (!upd.rowCount) return { status: 409, message: 'Contestant not found. Reload the list.' };

        const fullName = `${updated.FirstName} ${updated.LastName}`;

        // Update all three result tables for individual rows
        for (const table of ['event_registrations', 'prepub_results', 'published_results']) {
          await tq(`
            UPDATE ${table} SET
              contestant_first_name = @firstName, contestant_last_name = @lastName,
              contestant_mission = @mission,
              chest_no = CASE LOWER(REPLACE(REPLACE(TRIM(on_stage_off_stage), ' ', ''), '-', ''))
                WHEN 'onstage' THEN @onStageChestNo WHEN 'offstage' THEN @offStageChestNo
                ELSE chest_no END
            WHERE contestant_id = @id AND LOWER(TRIM(individual_group)) = 'individual'
          `, {
            id, firstName: updated.FirstName, lastName: updated.LastName, mission: updated.Mission,
            onStageChestNo: updated.OnStageChestNo || null, offStageChestNo: updated.OffStageChestNo || null,
          });
          // Update group result rows where this contestant is the leader (group_name = leader + " & Team")
          await tq(`
            UPDATE ${table} SET contestant_first_name = @groupName
            WHERE contestant_id IN (
              SELECT id FROM group_contestants WHERE group_leader_id = @id
            ) AND LOWER(TRIM(individual_group)) = 'group'
          `, { id, groupName: `${fullName} & Team` });
        }

        // Update display name fields in group_contestants
        await tq('UPDATE group_contestants SET group_leader = @name WHERE group_leader_id = @id',
          { id, name: fullName });
        for (let i = 1; i <= 9; i++) {
          await tq(`UPDATE group_contestants SET participant_${i} = @name WHERE participant_${i}_id = @id`,
            { id, name: fullName });
        }

        return { message: 'Contestant details saved and all related records updated.' };
      });
      if (result.status) return res.status(result.status).json({ message: result.message });
      return res.json(result);
    } catch (error) {
      const en = db.errorNumber(error);
      if (en === 23505) return res.status(409).json({ message: error.detail || error.message });
      console.error('Admin contestant error:', error);
      return res.status(500).json({ message: 'Unable to process the request.' });
    }
  }

  app.get('/api/admin/contestants/:id', requireAdmin, (req, res) => handle(req, res, false));
  app.put('/api/admin/contestants/:id', requireAdmin, (req, res) => handle(req, res, true));
};
