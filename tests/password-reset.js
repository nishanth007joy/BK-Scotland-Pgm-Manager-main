const assert=require('node:assert/strict');const register=require('../password-reset-routes');
(async()=>{
const routes={};let writes=0;let revoked;let fail=false;const inputs={};
register({get:(p,...h)=>routes.get=h,post:(p,...h)=>routes.post=h},{
 dbReady:Promise.resolve(),sql:{NVarChar:()=>null},
 requireAdmin:(req,res,next)=>req.session.role==='admin'?next():res.status(403).json({}),
 hashPassword:p=>{assert.equal(p,'new-password');return 'hashed-value'},
 activeSessions:{list:()=>[{account:'user@test',id:'session-1'},{account:'admin@test',id:'session-2'}],revoke:(account,id)=>revoked={account,id}},
 db:{request:()=>({input(k,t,v){inputs[k]=v;return this},async query(q){
 if(q.startsWith('SELECT name'))return {recordset:[{name:'Admin',email:'admin@test'},{name:'User',email:'user@test'}]};
 assert.match(q,/BEGIN TRANSACTION/);assert.match(q,/ROLLBACK TRANSACTION/);assert.equal(inputs.passwordHash,'hashed-value');assert.equal(inputs.self,'admin@test');
 writes++;if(fail)throw {number:51070};return {recordset:[{email:'user@test'}]};
 }})}
});
async function call(method,req){const res={code:200,set(){},status(n){this.code=n;return this},json(data){this.data=data;return this}};await routes[method][0](req,res,()=>routes[method][1](req,res));return res}
for(const role of [undefined,'data-entry'])for(const method of ['get','post'])assert.equal((await call(method,{session:{role}})).code,403);
const req={session:{role:'admin',accountKey:'admin@test'},body:{}};
const list=await call('get',req);assert.equal(list.data.users.length,1);assert.equal(list.data.users[0].email,'user@test');assert.ok(list.data.token);
assert.equal((await call('post',req)).code,403);
req.body={token:list.data.token,email:'user@test',password:'short'};assert.equal((await call('post',req)).code,400);
req.body.password='new-password';req.body.email=' ADMIN@test ';assert.equal((await call('post',req)).code,400);assert.equal(writes,0);
req.body.email='user@test';assert.equal((await call('post',req)).code,200);assert.deepEqual(revoked,{account:'user@test',id:'session-1'});
revoked=null;fail=true;const oldError=console.error;console.error=()=>{};try{assert.equal((await call('post',req)).code,400)}finally{console.error=oldError}assert.equal(revoked,null);
console.log('Password reset checks passed: admin access, token, self exclusion, validation, hashed update, session revocation, failed update. No live passwords changed.');
})().catch(e=>{console.error(e);process.exitCode=1});
