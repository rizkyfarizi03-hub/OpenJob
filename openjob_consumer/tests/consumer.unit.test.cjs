const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./loadWithMocks.cjs');
const QUEUE='openjob.application.created',STATUS_QUEUE='openjob.application.status_changed';
function fixture(){
 const state={notified:false,failures:0,next:null,failed:null,rollbacks:0,commits:0,connected:0,released:0,missing:false};
 const pool={connect:async()=>{
 state.connected++;
 return {query:async(sql,p)=>{
 if(sql==='COMMIT')state.commits++;
 if(sql==='ROLLBACK')state.rollbacks++;
 if(sql.startsWith('SELECT notified_at'))return {rowCount:state.missing?0:1,rows:state.missing?[]:[{notified_at:state.notified?new Date():null,failure_count:state.failures,next_attempt_at:state.next,failed_at:state.failed,application_id:'application-123',status:'interview'}]};
 if(sql.includes('FROM applications a JOIN users u'))return {rowCount:1,rows:[{id:'application-123',created_at:'2026-10-20T10:00:00Z',applicant_name:'Sinta',applicant_email:'sinta@example.test',title:'Backend Developer',owner_email:'owner@example.test',company_name:'Tech Corp'}]};
 if(sql.startsWith('UPDATE')&&sql.includes('SET notified_at'))state.notified=true;
 if(sql.startsWith('UPDATE')&&sql.includes('SET failure_count')){
 state.failures=p[1];state.next=new Date(Date.now()+p[3]*1000);state.failed=p[4]?new Date():null;
 }
 return {rows:[],rowCount:1};
 },release(){state.released++;}};
 }};
 const consumer=load('../src/consumer.js',{dotenv:{config(){}},nodemailer:{createTransport(){}},'./database':pool,'./rabbit':{QUEUE,STATUS_QUEUE,connect:async()=>({})}});
 return {state,...consumer};
}
const message=(status=false)=>({content:Buffer.from(JSON.stringify(status?{id:'00000000-0000-4000-8000-000000000001',application_id:'application-123',status:'interview'}:{application_id:'application-123'}))});
function channel(){
 const state={sent:[],acked:0,confirmFailure:false};
 return {state,sendToQueue(q,body,options,cb){state.sent.push({queue:q,body,options});cb(state.confirmFailure?Error('broker unavailable'):null);},ack(){state.acked++;}};
}
for(const kind of ['created','status']){
 const isStatus=kind==='status',queue=isStatus?STATUS_QUEUE:QUEUE;
 test(kind+': successful mail is sent once and has stable message id',async()=>{
 const f=fixture(),emails=[],m=message(isStatus),send={sendMail:async o=>emails.push(o)};
 await (isStatus?f.notifyStatus:f.notify)(m,send);await (isStatus?f.notifyStatus:f.notify)(m,send);
 assert.equal(emails.length,1);assert.equal(emails[0].to,isStatus?'sinta@example.test':'owner@example.test');
 assert.match(emails[0].subject,/Backend Developer/);
 if(isStatus){assert.equal(emails[0].messageId,'<application-status-00000000-0000-4000-8000-000000000001@openjob.local>');assert.match(emails[0].text,/Tahap Wawancara/);}
 assert.equal(f.state.released,2);
 });
 test(kind+': transient failures persist, defer early redelivery and stop after three attempts',async()=>{
 const f=fixture(),c=channel(),m=message(isStatus);let sends=0;
 const send={sendMail:async()=>{sends++;throw Object.assign(Error('temporary failure'),{code:'ETIMEDOUT'});}};
 await f.handleDelivery(c,queue,kind,m,send);
 assert.equal(f.state.failures,1);assert.equal(c.state.acked,1);assert.equal(c.state.sent.length,0);
 await f.handleDelivery(c,queue,kind,m,send);
 assert.equal(sends,1);
 for(let i=1;i<3;i++){f.state.next=new Date(0);await f.handleDelivery(c,queue,kind,m,send);}
 assert.equal(sends,3);assert.equal(f.state.failures,3);assert.ok(f.state.failed);
 assert.equal(c.state.sent.length,1);assert.equal(c.state.sent[0].queue,queue+'.failed');
 assert.equal(c.state.sent[0].options.persistent,true);assert.equal(c.state.sent[0].options.headers['x-openjob-failures'],3);
 await f.handleDelivery(c,queue,kind,m,send);assert.equal(sends,3);
 });
 test(kind+': recovery before the limit marks notified and suppresses duplicates',async()=>{
 const f=fixture(),m=message(isStatus),notify=isStatus?f.notifyStatus:f.notify;
 assert.equal((await notify(m,{sendMail:async()=>{throw Error('offline');}})).action,'retry');
 f.state.next=new Date(0);let sends=0;
 const mailer={sendMail:async()=>sends++};
 await notify(m,mailer);await notify(m,mailer);
 assert.equal(sends,1);assert.ok(f.state.notified);
 });
}
test('permanent SMTP rejection is separated immediately',async()=>{
 const f=fixture(),c=channel();
 await f.handleDelivery(c,QUEUE,'created',message(),{sendMail:async()=>{throw Object.assign(Error('rejected'),{responseCode:550,code:'EENVELOPE'});}});
 assert.equal(f.state.failures,1);assert.ok(f.state.failed);assert.equal(c.state.sent.length,1);
});
test('malformed messages go to failed queue without database access and next message continues',async()=>{
 const f=fixture(),c=channel();
 for(const raw of ['null','not JSON','{}','{"id":"x","application_id":"application-123","status":"invented"}']){
 await f.handleDelivery(c,STATUS_QUEUE,'status',{content:Buffer.from(raw)},{});
 }
 assert.equal(f.state.connected,0);assert.equal(c.state.acked,4);
 assert.equal(c.state.sent.length,4);
 await f.handleDelivery(c,QUEUE,'created',message(),{sendMail:async()=>{}});
 assert.equal(c.state.acked,5);assert.ok(f.state.notified);
});
test('failed queue publish must be confirmed before acknowledging',async()=>{
 const f=fixture(),c=channel(),m={content:Buffer.from('bad JSON')};
 c.state.confirmFailure=true;
 await assert.rejects(()=>f.handleDelivery(c,QUEUE,'created',m,{}),/broker unavailable/);
 assert.equal(c.state.acked,0);
 c.state.confirmFailure=false;
 await f.handleDelivery(c,QUEUE,'created',m,{});
 assert.equal(c.state.acked,1);
 assert.equal(c.state.sent[0].options.messageId,c.state.sent[1].options.messageId);
});
test('status payload must match persisted event and cannot bypass idempotency without id',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.notifyStatus({content:Buffer.from(JSON.stringify({application_id:'application-123',status:'interview'}))},{}),/Payload/);
 await assert.rejects(()=>f.notifyStatus({content:Buffer.from(JSON.stringify({id:'00000000-0000-4000-8000-000000000001',application_id:'application-other',status:'interview'}))},{}),/Payload/);
 assert.equal(f.state.rollbacks,1);
});
test('missing outbox event is acknowledged without sending email',async()=>{
 const f=fixture(),c=channel();f.state.missing=true;
 await f.handleDelivery(c,QUEUE,'created',message(),{sendMail:async()=>assert.fail('unexpected email')});
 assert.equal(c.state.acked,1);
});
test('consumer uses expected queue names and AMQP_URL',async()=>{
 let url;
 const rabbit=load('../src/rabbit.js',{amqplib:{connect:async value=>{url=value;return{on(){}};}}});
 assert.equal(rabbit.QUEUE,QUEUE);assert.equal(rabbit.STATUS_QUEUE,STATUS_QUEUE);
 const old=process.env.AMQP_URL;
 try{process.env.AMQP_URL='amqp://openjob:test@localhost:5672';await rabbit.connect();assert.equal(url,process.env.AMQP_URL);}
 finally{if(old===undefined)delete process.env.AMQP_URL;else process.env.AMQP_URL=old;}
});


