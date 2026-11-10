// Start the actual API and consumer entrypoints in separate processes; no module mocks/preloads.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');
const {Client}=require('pg');
const {config,migrate,setup}=require('./postgresQa.cjs');
const base='http://127.0.0.1:3102',tag=randomBytes(8).toString('hex'),schema='start_'+tag;
const directory=path.resolve(__dirname,'../qa-postgres-files',schema);
const children=new Set();let db,broker;
function start(file,env){
 const child=spawn(process.execPath,[file],{cwd:directory,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 children.add(child);child.on('error',()=>{});
 // Drain output without printing environment/configuration values.
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 return child;
}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const ended=once(child,'exit');child.kill();await ended;}
async function waitReady(child){
 const end=Date.now()+20000;
 while(Date.now()<end){
 if(child.exitCode!==null||child.signalCode!==null)throw Error('API entrypoint exited before becoming ready');
 try{const response=await fetch(base+'/api/health');if(response.ok)return;}catch{}
 await new Promise(resolve=>setTimeout(resolve,150));
 }throw Error('API entrypoint did not become ready');
}
async function smoke(env,check=false){
 const child=spawn(process.execPath,[path.resolve(__dirname,'test-postgres-web.cjs'),...(check?['--check']:[])],{cwd:directory,env:{...env,OPENJOB_SMOKE_BASE_URL:base},stdio:'inherit',windowsHide:true});
 children.add(child);const [code]=await once(child,'exit');assert.equal(code,0,'HTTP smoke test failed');
}
(async()=>{
 // Fail before creating fixtures if the dedicated test port is already occupied.
 const probe=require('node:net').createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3102,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
 await setup();await fs.mkdir(directory,{recursive:true});
 db=new Client(config());await db.connect();await db.query('CREATE SCHEMA '+schema);await migrate(db,schema);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM "'+schema+'".users')).rows[0].n,0,'Test schema must start without seeded users');
 const database=config(),prefix='openjob.qa.normal.'+tag;
 const env={...process.env,HOST:'127.0.0.1',PORT:'3102',PGHOST:database.host,PGPORT:String(database.port),PGUSER:database.user,PGPASSWORD:database.password,PGDATABASE:database.database,PGOPTIONS:'-c search_path='+schema,
 ACCESS_TOKEN_KEY:randomBytes(32).toString('hex'),REFRESH_TOKEN_KEY:randomBytes(32).toString('hex'),PASSWORD_RESET_KEY:randomBytes(32).toString('hex'),WEB_BASE_URL:base,
 OPENJOB_DEMO:'0',OPENJOB_DEMO_MAIL:'0',OPENJOB_LOCAL_QA:'0',OPENJOB_UPLOAD_DIRECTORY:path.join(directory,'documents'),
 REDIS_HOST:'127.0.0.1',REDIS_PORT:'6379',
 AMQP_URL:'amqp://openjob:openjob_local_2026@127.0.0.1:5672',RABBITMQ_QUEUE_PREFIX:prefix,
 MAIL_HOST:'127.0.0.1',MAIL_PORT:'1025',MAIL_USER:'openjob-qa@example.test',MAIL_PASSWORD:'local-only',MAIL_FROM:'openjob-qa@example.test'};
 // NODE_OPTIONS could preload a mock; this test deliberately uses clean Node entrypoints.
 delete env.NODE_OPTIONS;
 const apiPath=path.resolve(__dirname,'../src/server.js'),consumerPath=path.resolve(__dirname,'../../openjob_consumer/src/consumer.js');
 assert.equal(require('../package.json').scripts.start,'node src/server.js');
 assert.equal(require('../../openjob_consumer/package.json').scripts.start,'node src/consumer.js');
 let api=start(apiPath,env),consumer=start(consumerPath,env);await waitReady(api);
 const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.demo,false);assert.equal(health.localQa,false);
 await smoke(env);
 const users=await db.query('SELECT count(*)::int AS n FROM "'+schema+'".users');assert.equal(users.rows[0].n,2,'Actual runtime must use the isolated schema');
 // Redis is optional here: cached routes fall back to PostgreSQL when it is unavailable.
 const jobs=await fetch(base+'/api/jobs').then(r=>r.json());assert.ok(jobs.data.jobs.some(j=>j.title==='Posisi Uji Persisten'));
 await stop(api);await stop(consumer);
 api=start(apiPath,env);consumer=start(consumerPath,env);await waitReady(api);await smoke(env,true);
 // Password recovery must also work using the independent consumer, not the demo mail helper.
 const manifest=JSON.parse(await fs.readFile(path.resolve(__dirname,'../.qa-postgres/normal-start-smoke.json'),'utf8'));
 const post=async(route,body)=>fetch(base+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/password-resets',{email:manifest.email})).status,202);
 let message;const until=Date.now()+25000;
 while(Date.now()<until){const inbox=await fetch('http://127.0.0.1:8025/api/v1/messages').then(r=>r.json());const item=inbox.messages.find(m=>m.Subject==='Ganti password akun OpenJob'&&m.To?.some(t=>t.Address===manifest.email));if(item){message=await fetch('http://127.0.0.1:8025/api/v1/message/'+item.ID).then(r=>r.json());break;}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.ok(message,'Password reset email must arrive');const link=new URL(message.Text.match(/http[^\s]+/)[0]);assert.equal(link.origin,base);
 const token=new URLSearchParams(link.hash.split('?')[1]).get('token');
 assert.equal((await post('/password-resets/confirm',{token,password:'NormalStartRecovered123!'})).status,200);
 assert.equal((await post('/authentications',{email:manifest.email,password:'NormalStartRecovered123!'})).status,200);
 // Clean only this run's disposable queues. Keep DB/files as reviewable test fixtures.
 await stop(api);await stop(consumer);
 broker=await require('amqplib').connect(env.AMQP_URL);const channel=await broker.createChannel();
 for(const suffix of ['application.created','application.status_changed','account.password_reset','account.email_verification'])for(const failed of ['', '.failed'])await channel.deleteQueue(prefix+'.'+suffix+failed);
 console.log('NORMAL_START_PASS: actual API + independent consumer, empty schema, real PostgreSQL/RabbitMQ/Mailpit, recruitment, reset and restart persistence');
 console.log('QA schema retained: '+schema+'; temporary website 3102 stopped');
})().catch(e=>{console.error('NORMAL_START_FAILED',e.message);process.exitCode=1;}).finally(async()=>{
 await Promise.allSettled([...children].map(stop));await Promise.allSettled([db?.end(),broker?.close()]);
});
