const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const sqlTypes = require('mssql');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let directory, tempDirectory;
let handler;
let stored, commits, rollbacks, failUpdate;
class Transaction {
  on() {}
  async begin() { this.pending = null; }
  async commit() { stored.CertificatePrinted = this.pending; commits++; }
  async rollback() { rollbacks++; }
}
class Request {
  constructor(transaction) { this.transaction = transaction; }
  input() { return this; }
  async query(query) {
    if (query.includes('SELECT')) return { recordset: stored ? [{ ...stored }, { ...stored, ContestantID: 'C2', CertificatePrinted: 'Yes' }] : [] };
    if (failUpdate) throw new Error('Test update failure');
    await fs.access(path.join(directory, 'Singing _ Solo - 8-10.xlsx'));
    this.transaction.pending = 'Yes';
    return { rowsAffected: [1] };
  }
}
const auth = () => {};
require('../certificate-routes')({
  post(path, middleware, callback) { assert.equal(middleware, auth); handler = callback; },
}, { db: {}, dbReady: Promise.resolve(), sql: { ...sqlTypes, Transaction, Request }, authMiddleware: auth,
  getCertificateDirectory: async () => directory });
function response() {
  return { code: 200, status(value) { this.code = value; return this; },
    json(value) { this.data = value; return this; }, set() {},
    attachment(value) { this.filename = value; }, send(value) { this.buffer = value; return this; } };
}
const body = { EventName: 'Singing / Solo', EventAgeGroup: '8-10' };
(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'certificate-export-'));
  directory = path.join(tempDirectory, 'Desktop', 'Certificates');
  stored = { ...body, EventName: 'Singing / Solo', ContestantFirstName: '=1+1',
    ContestantLastName: 'Test', ChestNo: '001', Score: 0, Points: 5, Place: 'First', CertificatePrinted: 'No' };
  commits = rollbacks = 0;
  const res = response();
  await handler({ body }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.filename, 'Singing _ Solo - 8-10.xlsx');
  assert.equal(res.data.filePath, path.join(directory, res.data.filename));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(res.data.filePath);
  const sheet = workbook.getWorksheet('Certificate');
  assert.equal(sheet.rowCount, 3, 'Both listed results must be exported, including previously printed rows');
  assert.equal(sheet.columnCount, 4);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Name', 'Place', 'Event', 'ItemCode']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['=1+1 Test', 'First', 'Singing / Solo', 'Singing / Solo - 8-10']);
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String);
  assert.equal(stored.CertificatePrinted, 'Yes');
  assert.equal(commits, 1);
  const duplicate = response();
  await handler({ body }, duplicate);
  assert.equal(duplicate.code, 409);
  assert.equal(commits, 1);
  stored.CertificatePrinted = 'No';
  failUpdate = true;
  const failed = response();
  const log = console.error;
  console.error = () => {};
  try { await handler({ body }, failed); } finally { console.error = log; }
  assert.equal(failed.code, 500);
  assert.equal(stored.CertificatePrinted, 'No');
  assert.equal(failed.buffer, undefined);
  failUpdate = false;
  directory = path.join(tempDirectory, 'blocked');
  await fs.writeFile(directory, 'A file prevents creating the export directory.');
  const saveFailed = response();
  console.error = () => {};
  try { await handler({ body }, saveFailed); } finally { console.error = log; }
  assert.equal(saveFailed.code, 500);
  assert.equal(stored.CertificatePrinted, 'No');
  assert.equal(commits, 1);
  assert.equal(rollbacks, 3);
  stored = null;
  const missing = response();
  await handler({ body }, missing);
  assert.equal(missing.code, 404);
  const invalid = response();
  await handler({ body: {} }, invalid);
  assert.equal(invalid.code, 400);
  console.log('PASS: four-column XLSX saved to disk, text safety, printed status after save, repeat-export rejection, database and filesystem failures, missing result, invalid input.');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true }); });
