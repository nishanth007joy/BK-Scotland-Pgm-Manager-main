const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function certificateDirectory() {
  let desktop = path.join(os.homedir(), 'Desktop');
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath("Desktop")',
    ], { windowsHide: true, encoding: 'utf8' });
    desktop = stdout.trim();
    if (!desktop || !path.isAbsolute(desktop)) throw new Error('Unable to locate the Desktop folder.');
  }
  return path.join(desktop, 'Certificates');
}

module.exports = function registerCertificateRoutes(app, { db, dbReady, authMiddleware,
  getCertificateDirectory = certificateDirectory }) {
  app.post('/api/results/certificate', authMiddleware, async (req, res) => {
    const { EventName, EventAgeGroup } = req.body || {};
    if (![EventName, EventAgeGroup].every(value => typeof value === 'string' && value.trim() && value.length <= 50))
      return res.status(400).json({ message: 'Select an event name and age group.' });
    try {
      await dbReady;
      let filePath, filename;
      await db.withTransaction(async (tq) => {
        const result = await tq(`
          SELECT event_id AS "EventID", event_name AS "EventName", event_age_group AS "EventAgeGroup",
            individual_group AS "IndividualGroup", on_stage_off_stage AS "OnStageOffStage",
            contestant_id AS "ContestantID", contestant_first_name AS "ContestantFirstName",
            contestant_last_name AS "ContestantLastName", contestant_mission AS "ContestantMission",
            TRIM(chest_no) AS "ChestNo", score AS "Score", place AS "Place",
            points AS "Points", certificate_printed AS "CertificatePrinted", is_walk_over AS "IsWalkOver"
          FROM published_results
          WHERE TRIM(event_name) = @eventName AND TRIM(event_age_group) = @ageGroup
          ORDER BY event_id,
            CASE TRIM(place) WHEN 'First' THEN 1 WHEN 'Second' THEN 2 ELSE 3 END,
            contestant_id
          FOR UPDATE
        `, { eventName: EventName.trim(), ageGroup: EventAgeGroup.trim() });

        if (!result.recordset.length)
          throw Object.assign(new Error('[51404] Published result not found. Refresh the list.'), {});

        const rows = result.recordset;
        if (!rows.some(item => String(item.CertificatePrinted).trim().toLowerCase() === 'no'))
          throw Object.assign(new Error('[51409] All certificates in this selection have already been exported or are not available for printing. Refresh the list.'), {});

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Certificate');
        sheet.columns = ['Name', 'Place', 'Event', 'ItemCode']
          .map(key => ({ header: key, key, width: key === 'Place' ? 15 : 35 }));
        const clean = value => String(value ?? '').trim();
        rows.forEach(row => sheet.addRow({
          Name: [clean(row.ContestantFirstName), clean(row.ContestantLastName)].filter(Boolean).join(' '),
          Place: clean(row.Place),
          Event: clean(row.EventName),
          ItemCode: `${clean(row.EventName)} - ${clean(row.EventAgeGroup)}`,
        }));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        const buffer = await workbook.xlsx.writeBuffer();
        const row = rows[0];
        filename = `${row.EventName.trim()} - ${row.EventAgeGroup.trim()}`
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150) + '.xlsx';
        const directory = await getCertificateDirectory();
        await fs.mkdir(directory, { recursive: true });
        filePath = path.join(directory, filename);
        await fs.writeFile(filePath, Buffer.from(buffer));

        await tq(`
          UPDATE published_results SET certificate_printed = 'Yes'
          WHERE TRIM(event_name) = @eventName AND TRIM(event_age_group) = @ageGroup
        `, { eventName: EventName.trim(), ageGroup: EventAgeGroup.trim() });
      });

      res.set('Cache-Control', 'no-store');
      return res.json({ message: 'Certificate Excel file saved.', filePath, filename });
    } catch (error) {
      const ce = db.getCustomError(error);
      if (ce?.number === 51404) return res.status(404).json({ message: ce.message });
      if (ce?.number === 51409) return res.status(409).json({ message: ce.message });
      console.error('Certificate export error:', error);
      return res.status(500).json({ message: 'Unable to export the certificate. Refresh the list before retrying.' });
    }
  });
};
