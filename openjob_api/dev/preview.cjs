const {createSandbox,seed}=require('./sandbox.cjs');
(async()=>{
 process.env.OPENJOB_DEMO='1';
 const sandbox=await createSandbox();await seed(sandbox.pool);
 const app=require('../src/server');
 const port=Number(process.env.DEMO_PORT||3100);
 process.env.WEB_BASE_URL='http://127.0.0.1:'+port;
 let stopMail;
 const server=app.listen(port,'127.0.0.1');
 server.once('listening',()=>{
 if(process.env.OPENJOB_DEMO_MAIL==='1')stopMail=require('./demoResetMail.cjs')(sandbox);
 console.log('OpenJob demo: http://127.0.0.1:'+port+' (temporary database; '+(stopMail?'reset mail: local Mailpit':'email worker disabled')+')');
 });
 const close=()=>server.close(async()=>{if(stopMail)await stopMail();await sandbox.close();process.exit(0);});
 process.on('SIGINT',close);process.on('SIGTERM',close);
 server.on('error',async e=>{console.error(e.message);await sandbox.close();process.exit(1);});
})().catch(e=>{console.error(e);process.exit(1);});

