// Opt-in PostgreSQL QA. Never migrates the database named in .env.
const path=require('node:path');
const fs=require('node:fs/promises');
const {randomBytes}=require('node:crypto');
const {Pool,Client}=require('pg');
const {runner}=require('node-pg-migrate');
const database='openjob_qa_20261031';
const marker='OpenJob isolated local QA 20261031';
function config(){
 const contents=require('node:fs').readFileSync(path.resolve(__dirname,'../.qa-postgres/docker.env'),'utf8');
 const password=contents.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})\s*$/)?.[1];
 if(!password)throw Error('Run PostgreSQL Docker QA setup first');
 return {host:'127.0.0.1',port:5433,user:'openjob_qa',password,database};
}
async function migrate(client,schema='public'){
 await runner({dbClient:client,dir:path.resolve(__dirname,'../migrations'),direction:'up',schema,migrationsSchema:schema,migrationsTable:'pgmigrations',log:()=>{}});
}
async function setup(){
 const admin=new Client({...config(),database:'postgres'});await admin.connect();
 try{
 const existing=await admin.query('SELECT shobj_description(oid,\'pg_database\') AS marker FROM pg_database WHERE datname=$1',[database]);
 if(existing.rowCount&&existing.rows[0].marker!==marker)throw Error('QA database exists without ownership marker; refusing to modify it');
 if(!existing.rowCount){await admin.query('CREATE DATABASE '+database);await admin.query("COMMENT ON DATABASE "+database+" IS '"+marker+"'");}
 }finally{await admin.end();}
 const client=new Client(config());await client.connect();
 try{await migrate(client);console.log('QA_DATABASE_READY '+database);}finally{await client.end();}
}
async function createSandbox(){
 const schema='qa_'+randomBytes(10).toString('hex');
 const admin=new Client(config());await admin.connect();
 try{
 const check=await admin.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
 if(check.rows[0]?.marker!==marker)throw Error('Run PostgreSQL QA setup first');
 await admin.query('CREATE SCHEMA '+schema);await migrate(admin,schema);
 }finally{await admin.end();}
 const pgPool=new Pool({...config(),options:'-c search_path='+schema+',public'});
 // Express does not serve files inside dot-directories by default.
 const uploadDirectory=path.resolve(__dirname,'../qa-postgres-files',schema,'documents');await fs.mkdir(uploadDirectory,{recursive:true});
 process.env.OPENJOB_UPLOAD_DIRECTORY=uploadDirectory;
 for(const key of ['ACCESS_TOKEN_KEY','REFRESH_TOKEN_KEY','PASSWORD_RESET_KEY'])process.env[key]=randomBytes(32).toString('hex');
 process.env.WEB_BASE_URL='http://127.0.0.1:3100';
 // Bound methods preserve pg.Pool's receiver when tests temporarily wrap query.
 const pool={query:pgPool.query.bind(pgPool),connect:pgPool.connect.bind(pgPool),end:pgPool.end.bind(pgPool)};
 require.cache[require.resolve('../src/database')]={exports:pool};
 const cache=new Map();
 require.cache[require.resolve('../src/cache')]={exports:{get:async k=>cache.has(k)?JSON.parse(cache.get(k)):null,set:async(k,v)=>cache.set(k,JSON.stringify(v)),delete:async(...keys)=>keys.forEach(k=>cache.delete(k))}};
 console.log('POSTGRES_QA_SCHEMA '+schema);
 return {pool,uploadDirectory,databaseKind:'postgresql-docker',persistent:true,close:async()=>{
 await pgPool.end();
 // A fresh connection proves committed records survive closing the application pool.
 const probe=new Client({...config(),options:'-c search_path='+schema+',public'});await probe.connect();
 try{const r=await probe.query('SELECT count(*)::int AS users FROM users');console.log('POSTGRES_QA_RECONNECTED users='+r.rows[0].users);}finally{await probe.end();}
 }};
}
module.exports={config,migrate,setup};
if(require.main===module)setup().catch(e=>{console.error('POSTGRES_QA_FAILED',e.code||e.message);process.exitCode=1;});
else require('./sandbox.cjs').createSandbox=createSandbox;
