// Targeted checks, not a claim of a complete automated security scan.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createSandbox}=require('../dev/sandbox.cjs');
test('four checks: private records, recruiter ownership, sessions and request limits',async t=>{
 const sandbox=await createSandbox();process.env.OPENJOB_DEMO='0';
 const app=require('../src/server');
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;process.env.WEB_BASE_URL=base;
 t.after(async()=>{await new Promise(r=>server.close(r));await sandbox.close();});
 let logins=0;
 async function call(route,method='GET',body,token,extra={}){
 const response=await fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...extra},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {code:response.status,body:data,retry:response.headers.get('Retry-After')};
 }
 const api=(route,...args)=>call('/api'+route,...args);
 async function login(email,password='BoundaryCheck123!'){
 logins++;return api('/authentications','POST',{email,password});
 }
 async function user(name,role='user',verified=true){
 const email=name+'@example.com';const r=await api('/users','POST',{name,email,role,password:'BoundaryCheck123!'});assert.equal(r.code,201);
 if(verified)await sandbox.pool.query('UPDATE users SET email_verified_at=NOW() WHERE id=$1',[r.body.data.id]);
 const session=await login(email);assert.equal(session.code,200);
 return {id:r.body.data.id,email,...session.body.data};
 }
 const owner=await user('boundary-owner','employer'),other=await user('boundary-other','employer'),candidate=await user('boundary-candidate'),stranger=await user('boundary-stranger'),unverified=await user('boundary-unverified','employer',false);
 const company=async(who,name)=>{const r=await api('/companies','POST',{name,location:'Jakarta'},who.accessToken);assert.equal(r.code,201);return r.body.data.id;};
 const c1=await company(owner,'Owner QA'),c2=await company(other,'Other QA');
 const jobBody={company_id:c1,category_id:'category-technology',title:'Boundary QA job',description:'Fictional content for local tests.',job_type:'full-time',experience_level:'junior',location_type:'remote'};
 const j1=await api('/jobs','POST',jobBody,owner.accessToken),j2=await api('/jobs','POST',{...jobBody,company_id:c2},other.accessToken);assert.equal(j1.code,201);assert.equal(j2.code,201);
 const pdf=await require('pdf-lib').PDFDocument.create();pdf.addPage().drawText('Fictional access boundary CV');const bytes=await pdf.save();
 function form(data=bytes,mime='application/pdf',multiple=false){const f=new FormData();f.append('document',new Blob([data],{type:mime}),'cv.pdf');if(multiple)f.append('document',new Blob([bytes],{type:'application/pdf'}),'second.pdf');return f;}
 const upload=await api('/documents','POST',form(),candidate.accessToken);assert.equal(upload.code,201);const doc=upload.body.data.documentId;
 let a1,a2;
 await t.test('1: CV/application access includes aliases, two recruiters and withdrawal',async()=>{
 for(const route of ['/api/documents/'+doc,'/documents/'+doc])assert.equal((await call(route)).code,401);
 assert.equal((await api('/documents/'+doc,'GET',null,owner.accessToken)).code,404);
 assert.equal((await api('/documents/'+doc,'GET',null,stranger.accessToken)).code,404);
 assert.equal((await api('/applications','POST',{job_id:j1.body.data.id,document_id:doc},stranger.accessToken)).code,403);
 const make=async job=>{const r=await api('/applications','POST',{job_id:job,document_id:doc},candidate.accessToken);assert.equal(r.code,201);return r.body.data.id;};
 a1=await make(j1.body.data.id);a2=await make(j2.body.data.id);
 assert.equal((await api('/applications/'+a1,'GET',null,stranger.accessToken)).code,404);
 assert.equal((await call('/applications/'+a1,'GET',null,other.accessToken)).code,404);
 assert.equal((await api('/applications/user/'+candidate.id,'GET',null,stranger.accessToken)).code,403);
 assert.equal((await api('/applications/job/'+j1.body.data.id,'GET',null,other.accessToken)).code,403);
 const filtered=await api('/applications?job_id='+j1.body.data.id,'GET',null,other.accessToken);assert.equal(filtered.body.data.applications.length,0);
 assert.equal((await api('/applications/'+a1,'PUT',{status:'accepted'},other.accessToken)).code,409);
 assert.equal((await api('/applications/'+a1,'DELETE',null,stranger.accessToken)).code,409);
 for(const actor of [owner,other,candidate])assert.equal((await api('/documents/'+doc,'GET',null,actor.accessToken)).code,200);
 assert.equal((await api('/applications/'+a1,'DELETE',null,candidate.accessToken)).code,200);
 assert.equal((await api('/documents/'+doc,'GET',null,owner.accessToken)).code,404);
 assert.equal((await api('/documents/'+doc,'GET',null,other.accessToken)).code,200);
 assert.equal((await api('/applications/'+a2,'DELETE',null,candidate.accessToken)).code,200);
 assert.equal((await api('/documents/'+doc,'GET',null,other.accessToken)).code,404);
 assert.equal((await api('/documents/'+doc,'GET',null,candidate.accessToken)).code,200);
 assert.equal((await sandbox.pool.query('SELECT id FROM applications WHERE id IN ($1,$2)',[a1,a2])).rowCount,2);
 });
 await t.test('2: foreign company/job writes and role escalation are rejected without mutation',async()=>{
 assert.equal((await api('/companies/'+c1,'PUT',{name:'Taken'},other.accessToken)).code,404);
 assert.equal((await api('/companies','POST',{name:'No role',location:'Jakarta'},candidate.accessToken)).code,403);
 assert.equal((await api('/jobs','POST',jobBody,other.accessToken)).code,403);
 assert.equal((await api('/jobs/'+j1.body.data.id,'PUT',{title:'Taken'},other.accessToken)).code,404);
 assert.equal((await api('/jobs/'+j1.body.data.id,'PUT',{company_id:c2},owner.accessToken)).code,403);
 assert.equal((await api('/jobs/'+j1.body.data.id,'PUT',{owner_id:other.id},owner.accessToken)).code,400);
 assert.equal((await api('/users/'+candidate.id,'PUT',{role:'admin'},candidate.accessToken)).code,400);
 assert.equal((await api('/jobs/'+j1.body.data.id,'DELETE',null,other.accessToken)).code,409);
 assert.equal((await api('/companies/'+c1,'DELETE',null,other.accessToken)).code,409);
 assert.equal((await api('/companies/'+c1)).body.data.name,'Owner QA');
 const job=await api('/jobs/'+j1.body.data.id);assert.equal(job.body.data.title,jobBody.title);assert.equal(job.body.data.owner_id,owner.id);assert.equal(job.body.data.company_id,c1);
 const empty=await company(owner,'Empty ownership QA');assert.equal((await api('/companies/'+empty,'DELETE',null,other.accessToken)).code,404);assert.equal((await api('/companies/'+empty)).code,200);
 });
 await t.test('3: refresh races, replay, token types and logout revoke access',async()=>{
 const session=await login(stranger.email);assert.equal(session.code,200);
 const {accessToken,refreshToken}=session.body.data;
 assert.equal((await api('/profile','GET',null,refreshToken)).code,401);
 assert.equal((await api('/authentications','PUT',{refreshToken:accessToken})).code,400);
 const results=await Promise.all([api('/authentications','PUT',{refreshToken}),api('/authentications','PUT',{refreshToken})]);assert.deepEqual(results.map(r=>r.code).sort(),[200,400]);
 const rotated=results.find(r=>r.code===200).body.data;
 assert.equal((await api('/authentications','PUT',{refreshToken})).code,400);
 assert.equal((await api('/authentications','DELETE',{refreshToken:rotated.refreshToken},owner.accessToken)).code,400);
 assert.equal((await api('/authentications','DELETE',{refreshToken:rotated.refreshToken},rotated.accessToken)).code,200);
 assert.equal((await api('/profile','GET',null,rotated.accessToken)).code,401);
 assert.equal((await api('/profile','GET',null,accessToken)).code,401);
 assert.equal((await api('/authentications','PUT',{refreshToken:rotated.refreshToken})).code,400);
 });
 await t.test('3: probe confirms public visibility of an unverified closed draft',async()=>{
 const companyId=await company(unverified,'Unverified draft QA');
 assert.equal((await api('/jobs','POST',{...jobBody,company_id:companyId},unverified.accessToken)).code,403);
 const draft=await api('/jobs','POST',{...jobBody,company_id:companyId,status:'close',title:'Unverified QA draft'},unverified.accessToken);assert.equal(draft.code,201);
 assert.equal((await api('/jobs/'+draft.body.data.id)).code,200);
 const publicList=await api('/jobs?status=close');assert.ok(publicList.body.data.jobs.some(j=>j.id===draft.body.data.id));
 t.diagnostic('CONFIRMED GAP: unverified closed draft is publicly readable by ID and status=close; open publishing itself is blocked.');
 });
 await t.test('4: upload rejects wrong type, malformed PDF, excess size and multiple files without residue',async()=>{
 const before=(await fs.readdir(sandbox.uploadDirectory)).sort();
 for(const payload of [form('fake PDF'),form(bytes,'text/plain'),form(Buffer.alloc(5*1024*1024+1)),form(bytes,'application/pdf',true)])assert.equal((await api('/documents','POST',payload,candidate.accessToken)).code,400);
 assert.equal((await api('/documents','POST',form(),owner.accessToken)).code,403);
 assert.equal((await api('/documents','POST',form())).code,401);
 assert.deepEqual((await fs.readdir(sandbox.uploadDirectory)).sort(),before);
 });
 await t.test('4: login attempt 31 returns 429 and spoofed forwarded headers do not bypass it',async()=>{
 while(logins<30){const r=await login('nonexistent-boundary@example.com','wrong-password');assert.equal(r.code,401);}
 const blocked=await api('/authentications','POST',{email:candidate.email,password:'BoundaryCheck123!'});assert.equal(blocked.code,429);assert.ok(Number(blocked.retry)>0&&Number(blocked.retry)<=900);
 assert.equal((await api('/authentications','POST',{email:'another-boundary@example.com',password:'wrong-password'},null,{'X-Forwarded-For':'203.0.113.9'})).code,429);
 t.diagnostic('LIMITATION: login limiter is per-process/IP; restart or additional instances do not share counters. Upload has per-file size/parser limits, but no per-account quota or global worker admission limit in current source.');
 });
});
