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

module.exports = function registerCertificateRoutes(app, { db, dbReady, sql, authMiddleware,
  getCertificateDirectory = certificateDirectory }) {
  app.post('/api/results/certificate', authMiddleware, async (req, res) => {
    const { EventName, EventAgeGroup } = req.body || {};
    if (![EventName, EventAgeGroup].every(value => typeof value === 'string' && value.trim() && value.length <= 50))
      return res.status(400).json({ message: 'Select an event name and age group.' });
    let transaction;
    let active = false;
    try {
      await dbReady;
      transaction = new sql.Transaction(db);
      transaction.on('rollback', () => { active = false; });
      await transaction.begin();
      active = true;
      const request = () => new sql.Request(transaction)
        .input('eventName', sql.VarChar(50), EventName.trim())
        .input('ageGroup', sql.NVarChar(50), EventAgeGroup.trim());
      const result = await request().query(`SELECT EventID, EventName, EventAgeGroup, IndividualGroup,
        OnStageOffStage, ContestantID, ContestantFirstName, ContestantLastName, ContestantMission,
        ChestNo, Score, Place, Points, CertificatePrinted, IsWalkOver
        FROM dbo.PublishedResults WITH (UPDLOCK, HOLDLOCK)
        WHERE LTRIM(RTRIM(EventName))=@eventName AND LTRIM(RTRIM(EventAgeGroup))=@ageGroup
        ORDER BY EventID, CASE RTRIM(Place) WHEN 'First' THEN 1 WHEN 'Second' THEN 2 ELSE 3 END, ContestantID;`);
      if (!result.recordset.length) {
        await transaction.rollback(); active = false;
        return res.status(404).json({ message: 'Published result not found. Refresh the list.' });
      }
      const rows = result.recordset;
      const row = rows[0];
      if (!rows.some(item => String(item.CertificatePrinted).trim().toLowerCase() === 'no')) {
        await transaction.rollback(); active = false;
        return res.status(409).json({ message: 'All certificates in this selection have already been exported or are not available for printing. Refresh the list.' });
      }
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
      const filename = `${row.EventName.trim()} - ${row.EventAgeGroup.trim()}`
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150) + '.xlsx';
      const directory = await getCertificateDirectory();
      await fs.mkdir(directory, { recursive: true });
      const filePath = path.join(directory, filename);
      await fs.writeFile(filePath, Buffer.from(buffer));
      await request().query(`UPDATE dbo.PublishedResults SET CertificatePrinted='Yes'
        WHERE LTRIM(RTRIM(EventName))=@eventName AND LTRIM(RTRIM(EventAgeGroup))=@ageGroup;`);
      await transaction.commit(); active = false;
      res.set('Cache-Control', 'no-store');
      return res.json({ message: 'Certificate Excel file saved.', filePath, filename });
    } catch (error) {
      if (active) await transaction.rollback().catch(() => {});
      console.error('Certificate export error:', error);
      return res.status(500).json({ message: 'Unable to export the certificate. Refresh the list before retrying.' });
    }
  });
};
