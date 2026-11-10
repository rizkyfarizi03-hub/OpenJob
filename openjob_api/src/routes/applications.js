const router=require('express').Router();
const Joi=require('joi');
const {randomUUID}=require('crypto');
const pool=require('../database');
const verify=require('../middlewares/verifyToken');
const {identity,roles,verified}=require('../middlewares/access');
const select=require('../applicationQuery');
const fail=(res,code,message)=>res.status(code).json({status:'failed',message});
router.use(verify,identity);
router.post('/',roles('user'),verified,async(req,res,next)=>{
 let db;
 try{
 const {error,value}=Joi.object({
 job_id:Joi.string(),jobId:Joi.string(),document_id:Joi.string().required(),
 cover_letter:Joi.string().max(5000).allow('').default(''),
 }).xor('job_id','jobId').validate(req.body);
 if(error)return fail(res,400,error.details[0].message);
 db=await pool.connect();await db.query('BEGIN');
 const account=await db.query('SELECT email_verified_at FROM users WHERE id=$1 FOR SHARE',[req.userId]);
 if(!account.rows[0]?.email_verified_at){await db.query('ROLLBACK');return fail(res,403,'Verifikasi email Anda sebelum melamar.');}
 const job=await db.query('SELECT id,status,owner_id FROM jobs WHERE id=$1 FOR SHARE',[value.job_id||value.jobId]);
 if(!job.rowCount){await db.query('ROLLBACK');return fail(res,404,'Lowongan tidak ditemukan');}
 if(job.rows[0].status!=='open'){await db.query('ROLLBACK');return fail(res,409,'Lowongan sudah ditutup');}
 if(job.rows[0].owner_id===req.userId){await db.query('ROLLBACK');return fail(res,403,'Tidak dapat melamar lowongan sendiri');}
 const doc=await db.query('SELECT id FROM documents WHERE id=$1 AND user_id=$2 FOR SHARE',[value.document_id,req.userId]);
 if(!doc.rowCount){await db.query('ROLLBACK');return fail(res,403,'Pilih CV milik Anda');}
 const {rows}=await db.query("INSERT INTO applications(id,user_id,job_id,document_id,cover_letter,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING *",[randomUUID(),req.userId,job.rows[0].id,value.document_id,value.cover_letter]);
 await db.query('INSERT INTO application_outbox(application_id) VALUES($1)',[rows[0].id]);
 await db.query('COMMIT');
 res.status(201).json({status:'success',data:rows[0]});
 }catch(e){
 if(db)await db.query('ROLLBACK').catch(()=>{});
 if(e.code==='23505')return fail(res,409,'Anda sudah melamar pekerjaan ini');
 next(e);
 }finally{if(db)db.release();}
});
async function list(req,res,next){
 try{
 const {error,value:q}=Joi.object({
 page:Joi.number().integer().min(1).max(100000).default(1),
 limit:Joi.number().integer().min(1).max(50).default(20),
 job_id:Joi.string().max(50),
 status:Joi.string().valid('pending','reviewing','interview','accepted','rejected','withdrawn'),
 }).validate(req.query);
 if(error)return fail(res,400,'Filter atau halaman lamaran tidak valid');
 const values=[req.userId];let where=req.account.role==='user'?'a.user_id=$1':'j.owner_id=$1';
 if(req.params.userId){
 if(req.params.userId!==req.userId)return fail(res,403,'Tidak memiliki akses');
 where='a.user_id=$1';
 }
 if(req.params.jobId){
 const job=await pool.query('SELECT id FROM jobs WHERE id=$1 AND owner_id=$2',[req.params.jobId,req.userId]);
 if(!job.rowCount)return fail(res,403,'Tidak memiliki akses');
 values.push(req.params.jobId);where+=' AND a.job_id=$2';
 }
 if(q.job_id){values.push(q.job_id);where+=' AND a.job_id=$'+values.length;}
 if(q.status){values.push(q.status);where+=' AND a.status=$'+values.length;}
 const from=' FROM applications a JOIN jobs j ON j.id=a.job_id';
 // Summary covers the account's full recruitment workload, independent of filters/page.
 const summaryWhere=req.account.role==='user'?'a.user_id=$1':'j.owner_id=$1';
 const summary=await pool.query(`SELECT COUNT(*)::int AS total,
 COUNT(*) FILTER (WHERE a.status='pending')::int AS pending,
 COUNT(*) FILTER (WHERE a.status IN ('pending','reviewing','interview'))::int AS active,
 COUNT(*) FILTER (WHERE a.status='accepted')::int AS accepted${from} WHERE ${summaryWhere}`,[req.userId]);
 const count=await pool.query('SELECT COUNT(*)::int AS total'+from+' WHERE '+where,values);
 const {rows}=await pool.query(select+' WHERE '+where+' ORDER BY a.created_at DESC,a.id DESC LIMIT $'+(values.length+1)+' OFFSET $'+(values.length+2),[...values,q.limit,(q.page-1)*q.limit]);
 const total=count.rows[0].total;
 res.json({status:'success',data:{applications:rows,pagination:{page:q.page,limit:q.limit,total,pages:Math.ceil(total/q.limit)},summary:summary.rows[0]}});
 }catch(e){next(e);}
}
router.get('/',list);
router.get('/user/:userId',list);
router.get('/job/:jobId',list);
router.get('/:id',async(req,res,next)=>{
 try{
 const {rows}=await pool.query(select+' WHERE a.id=$1 AND (a.user_id=$2 OR j.owner_id=$2)',[req.params.id,req.userId]);
 if(!rows.length)return fail(res,404,'Lamaran tidak ditemukan');
 res.json({status:'success',data:rows[0]});
 }catch(e){next(e);}
});
router.put('/:id',roles('employer','admin'),async(req,res,next)=>{
 let db;
 try{
 const {error,value}=Joi.object({status:Joi.string().valid('reviewing','interview','accepted','rejected').required()}).validate(req.body);
 if(error)return fail(res,400,'Status lamaran tidak valid');
 db=await pool.connect();
 await db.query('BEGIN');
 const {rows}=await db.query(`UPDATE applications a SET status=$1,updated_at=CURRENT_TIMESTAMP
 FROM jobs j WHERE a.job_id=j.id AND a.id=$2 AND j.owner_id=$3
 AND a.status IN ('pending','reviewing','interview')
 AND a.status<>$1
 AND (a.status<>'interview' OR $1 IN ('interview','accepted','rejected')) RETURNING a.id`,[value.status,req.params.id,req.userId]);
 if(!rows.length){
   const current=await db.query('SELECT a.status FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1 AND j.owner_id=$2',[req.params.id,req.userId]);
   if(current.rows[0]?.status===value.status){
    await db.query('COMMIT');
    return res.json({status:'success',data:{changed:false},message:'Status lamaran sudah sesuai'});
   }
   await db.query('ROLLBACK');
   return fail(res,409,'Lamaran tidak dapat diperbarui: akses ditolak atau proses sudah selesai');
 }
 await db.query('INSERT INTO application_status_outbox(id, application_id, status) VALUES($1, $2, $3)', [randomUUID(), rows[0].id, value.status]);
 await db.query('COMMIT');
 res.json({status:'success',data:{changed:true},message:'Status lamaran diperbarui'});
 }catch(e){
   if(db)await db.query('ROLLBACK').catch(()=>{});
   next(e);
 }finally{
   if(db)db.release();
 }
});
router.delete('/:id',async(req,res,next)=>{
 try{
 const {rowCount}=await pool.query("UPDATE applications SET status='withdrawn',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2 AND status IN ('pending','reviewing','interview') RETURNING id",[req.params.id,req.userId]);
 if(!rowCount)return fail(res,409,'Lamaran tidak dapat ditarik');
 res.json({status:'success',message:'Lamaran ditarik. Riwayat tetap disimpan.'});
 }catch(e){next(e);}
});
module.exports=router;

