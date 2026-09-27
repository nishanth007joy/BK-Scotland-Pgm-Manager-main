const assert = require('node:assert/strict');
const routes = {}; let deletes=0, revoked=0, fail=false;
require('../delete-user-routes')({ get:(p,...h)=>routes.get=h, post:(p,...h)=>routes.post=h }, {
 dbReady:Promise.resolve(), sql:{ NVarChar:()=>({}) },
 db:{ request:()=>({ input(){return this;}, async query(query){
  if(query.startsWith('SELECT')) return {recordset:[{name:'Other',email:'other@example.com',role:'data-entry'}]};
  assert.deepEqual([...query.matchAll(/DELETE FROM ([\w.]+)/g)].map(m=>m[1]),['dbo.users']);
  assert.ok(query.includes('delete_referential_action<>0')); assert.ok(query.includes('sys.triggers')); assert.ok(query.includes('ROLLBACK TRANSACTION'));
  if(fail) {const error=new Error('Referenced'); error.number=547; throw error;} deletes++; return {};
 }})}, requireAdmin:(req,res,next)=>req.admin?next():res.status(403).json({}),
 activeSessions:{list:()=>[{account:'other@example.com',id:'session'}],revoke(){revoked++;}},
});
const session={accountKey:'admin@example.com'};
async function call(method,body={},admin=true){
 const req={session,body,admin}; const res={code:200,set(){},status(c){this.code=c;return this;},json(data){this.data=data;}};
 await routes[method][0](req,res,()=>routes[method][1](req,res));return res;
}
(async()=>{
 assert.equal((await call('get',{},false)).code,403); assert.equal((await call('post',{},false)).code,403);
 assert.equal((await call('post')).code,403);
 const preview=await call('get'); const payload={email:'other@example.com',token:preview.data.token,confirmed:true};
 assert.equal((await call('post',{...payload,confirmed:false})).code,400);
 assert.equal((await call('post',{...payload,email:session.accountKey})).code,400);
 fail=true; assert.equal((await call('post',payload)).code,409); assert.equal(revoked,0);
 fail=false; assert.equal((await call('post',payload)).code,200); assert.equal(deletes,1); assert.equal(revoked,1);
 console.log('Delete-user checks passed: authorization, confirmation, self-protection, account-only deletion, reference protection and session revocation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
