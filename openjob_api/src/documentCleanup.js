const fs=require('fs/promises');
const path=require('path');
const pool=require('./database');
const directory=process.env.OPENJOB_UPLOAD_DIRECTORY||path.resolve(__dirname,'../uploads/documents');
let running;
function cleanup(){
  if(running)return running;
  running=(async()=>{
    const {rows}=await pool.query('SELECT filename FROM document_file_cleanup ORDER BY created_at LIMIT 100');
    for(const {filename} of rows){
      // Database values must never allow deleting outside the upload directory.
      if(path.basename(filename)!==filename)continue;
      try{
        await fs.unlink(path.join(directory,filename)).catch(e=>{if(e.code!=='ENOENT')throw e;});
        await pool.query('DELETE FROM document_file_cleanup WHERE filename=$1',[filename]);
      }catch(e){console.error('Pembersihan dokumen akan diulang:',e.code||e.name);}
    }
  })().finally(()=>{running=null;});
  return running;
}
function start(){
  const run=()=>cleanup().catch(e=>console.error('Antrean pembersihan dokumen belum tersedia:',e.code||e.name));
  run();const timer=setInterval(run,60000);timer.unref();return timer;
}
module.exports={cleanup,start};
