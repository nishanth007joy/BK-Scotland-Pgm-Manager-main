// Run the admin SQL against temporary tables only; never write application tables.
const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
const register = require('../admin-contestant-routes');
const routes = {};
const contestant = { FirstName: 'Ann', LastName: 'Smith', AgeGroup: '8-10', Mission: 'Mission', Region: 'Region', OnStageChestNo: '1', OffStageChestNo: '', Comments: '' };
const memberFields = ['GroupLeader', ...Array.from({ length: 9 }, (_, i) => `Participant${i + 1}`)];
const resultColumns = `EventID nvarchar(50), EventName varchar(50), EventAgeGroup nvarchar(50), IndividualGroup varchar(10),
 OnStageOffStage varchar(10), ContestantID nvarchar(50), ContestantFirstName varchar(50), ContestantLastName varchar(50), ContestantMission varchar(50), ChestNo nchar(10), Score int, Place varchar(6)`;
const setup = `CREATE TABLE #Contestants (ID nvarchar(50), [First Name] varchar(50), [Last Name] varchar(50), AgeGroup nvarchar(50), Mission varchar(50), Region varchar(50), OnStageChestNo nchar(10), OffStageChestNo nchar(10), Comments varchar(50));
 INSERT INTO #Contestants VALUES ('1','Ann','Smith','8-10','Mission','Region','1',NULL,NULL);
 CREATE TABLE #GroupContestants (ID nvarchar(50), EventID nvarchar(50), GroupName varchar(50), ${memberFields.map(f => `${f} varchar(50), ${f}ID nvarchar(50)`).join(',')});
 INSERT INTO #GroupContestants (ID,EventID,GroupName,GroupLeader,GroupLeaderID) VALUES ('G1','E2','Ann Smith & Team','Ann Smith','1');
 ${['EventRegistrations','PrePubResults','PublishedResults'].map(t => `CREATE TABLE #${t} (${resultColumns});
 INSERT INTO #${t} VALUES ('E1','Song','8-10','Individual','OnStage','1','Ann','Smith','Mission','1',90,'First');
 INSERT INTO #${t} VALUES ('E2','Dance','All ages','Group','OnStage','G1','Ann Smith & Team','','Mission','9',80,'Second');`).join('\n')}`;
(async () => {
 const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland', connectionTimeout: 5000, options: { encrypt: false, trustServerCertificate: true } }).connect();
 let saving = false;
 class Transaction {
   constructor() { this.tx = new sql.Transaction(pool); }
   async begin(level) { await this.tx.begin(level); await new sql.Request(this.tx).batch(setup); }
   async rollback() { await this.tx.rollback(); }
   async commit() {
     if (saving) {
       const result = await new sql.Request(this.tx).query(`SELECT * FROM #PublishedResults ORDER BY EventID; SELECT * FROM #Contestants; SELECT * FROM #GroupContestants;`);
       assert.equal(result.recordsets[0][0].ContestantFirstName, 'Anne');
       assert.equal(result.recordsets[0][0].ChestNo.trim(), '2');
       assert.equal(result.recordsets[0][0].Score, 90);
       assert.equal(result.recordsets[0][0].Place, 'First');
       assert.equal(result.recordsets[0][1].ContestantFirstName, 'Anne Smith & Team');
       assert.equal(result.recordsets[0][1].ChestNo.trim(), '9');
       assert.equal(result.recordsets[1][0]['First Name'], 'Anne');
       assert.equal(result.recordsets[2][0].GroupLeader, 'Anne Smith');
     }
     await this.tx.rollback();
   }
 }
 class Request {
   constructor(tx) { this.req = new sql.Request(tx.tx); }
   input(...args) { this.req.input(...args); return this; }
   query(text) { return this.req.query(text.replace(/dbo\.(Contestants|GroupContestants|EventRegistrations|PrePubResults|PublishedResults)/g, '#$1')); }
 }
 register({ get: (p, m, h) => { routes.get = h; }, put: (p, m, h) => { routes.put = h; } }, { db: pool, dbReady: Promise.resolve(), sql: { ...sql, Transaction, Request }, requireAdmin() {} });
 async function call(method, body) {
   const res = { code: 200, set() {}, status(c) { this.code=c; return this; }, json(data) { this.data=data; } };
   await routes[method]({ params: { id: '1' }, body }, res);
   assert.equal(res.code, 200, res.data?.message);
   return res.data;
 }
 try {
   const preview = await call('get');
   assert.equal(preview.groups.length, 1);
   assert.equal(preview.publishedResults.length, 2);
   saving = true;
   await call('put', { ...contestant, FirstName: 'Anne', OnStageChestNo: '2', confirmed: true, token: preview.token });
   console.log('Admin contestant SQL integration passed using temporary tables; all transactions rolled back.');
 } finally { await pool.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

