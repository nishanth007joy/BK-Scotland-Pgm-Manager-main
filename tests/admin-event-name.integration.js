// Exercise real SQL using temporary tables only, rolling back every transaction.
const assert = require('node:assert/strict');
const sql = require('mssql');
process.loadEnvFile('.env');
const tables = ['Events', 'EventRegistrations', 'GroupContestants', 'PrePubResults', 'PublishedResults'];
(async () => {
 const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS', user: process.env.DB_USER || 'Pgrm_User', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'CSMEGB-Scotland', connectionTimeout: 5000, options: { encrypt: false, trustServerCertificate: true } }).connect();
 let changed = false, saving = false, fail = false, writes = 0, rollbacks = 0;
 class Transaction {
  constructor() { this.tx = new sql.Transaction(pool); }
  async begin(level) {
   await this.tx.begin(level);
   await new sql.Request(this.tx).batch(tables.map(t => `CREATE TABLE #${t} (EventID nvarchar(50), EventName varchar(50), Score int, Details varchar(50));
    INSERT INTO #${t} VALUES ('E1','Song',${changed ? 95 : 90},'Original details'), ('E2','Other',80,'Other details');`).join('\n'));
  }
  async rollback() { rollbacks++; await this.tx.rollback(); }
  async commit() {
   if (saving) {
    const result = await new sql.Request(this.tx).query(tables.map(t => `SELECT * FROM #${t} ORDER BY EventID;`).join('\n'));
    for (const rows of result.recordsets) {
     assert.equal(rows[0].EventName, 'New song'); assert.equal(rows[0].Score, 90);
     assert.equal(rows[0].Details, 'Original details'); assert.equal(rows[1].EventName, 'Other');
    }
   }
   await this.tx.rollback();
  }
 }
 class Request {
  constructor(tx) { this.req = new sql.Request(tx.tx); }
  input(...args) { this.req.input(...args); return this; }
  async query(text) {
   let query = text.replace(/dbo\.(Events|EventRegistrations|GroupContestants|PrePubResults|PublishedResults)/g, '#$1');
   if (text.includes('UPDATE')) { writes++; if (fail) query = query.replace('UPDATE #PublishedResults', "THROW 51099, 'Simulated failure', 1; UPDATE #PublishedResults"); }
   return this.req.query(query);
  }
 }
 const routes = {};
 require('../admin-event-name-routes')({ get: (p,...h) => { routes.get=h; }, put: (p,...h) => { routes.put=h; } }, {
  db: pool, dbReady: Promise.resolve(), sql: { ...sql, Transaction, Request }, requireAdmin: (req,res,next) => req.admin ? next() : res.status(403).json({}),
 });
 async function call(method, body={}, admin=true) {
  const req = { params: { id:'E1' }, body, admin };
  const res = { code:200, set() {}, status(c) { this.code=c; return this; }, json(data) { this.data=data; } };
  await routes[method][0](req,res,()=>routes[method][1](req,res)); return res;
 }
 try {
  assert.equal((await call('get',{},false)).code,403);
  assert.equal((await call('put',{},false)).code,403);
  assert.equal((await call('put')).code,400);
  const preview = await call('get'); assert.equal(preview.code,200);
  for (const key of ['registrations','groups','prepubResults','publishedResults']) assert.equal(preview.data[key].length,1);
  const payload = { EventName:'New song', confirmed:true, token:preview.data.token };
  changed=true; assert.equal((await call('put',payload)).code,409); assert.equal(writes,0);
  changed=false; saving=true; assert.equal((await call('put',payload)).code,200); assert.equal(writes,1);
  saving=false; fail=true;
  const originalError = console.error; console.error = () => {};
  try { assert.equal((await call('put',payload)).code,500); } finally { console.error=originalError; }
  assert.equal(rollbacks,2);
  console.log('Passed: admin access, required confirmation, complete preview, stale review rejection, all five table updates, unrelated data preserved, rollback on failure. Temporary tables only.');
 } finally { await pool.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
