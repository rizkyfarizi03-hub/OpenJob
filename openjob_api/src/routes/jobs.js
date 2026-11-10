const router = require('express').Router();
const Joi = require('joi');
const { randomUUID } = require('crypto');
const pool = require('../database');
const verify = require('../middlewares/verifyToken');
const { identity, roles } = require('../middlewares/access');
const scope = require('../cacheScope');
const employer = [verify, identity, roles('employer', 'admin')];
const fail = (res, code, message) => res.status(code).json({ status: 'failed', message });
const fields = `j.id,j.owner_id,j.company_id,j.category_id,j.title,j.description,j.job_type,
 j.experience_level,j.location_type,j.location_city,j.is_salary_visible,j.status,j.created_at,
 CASE WHEN j.is_salary_visible THEN j.salary_min ELSE NULL END AS salary_min,
 CASE WHEN j.is_salary_visible THEN j.salary_max ELSE NULL END AS salary_max,
 c.name AS company_name,c.description AS company_description,cat.name AS category_name`;
const from = 'FROM jobs j JOIN companies c ON c.id=j.company_id JOIN categories cat ON cat.id=j.category_id';
const schema = Joi.object({
 company_id:Joi.string().required(), category_id:Joi.string().required(),
 title:Joi.string().trim().max(255).required(), description:Joi.string().max(20000).required(),
 job_type:Joi.string().valid('full-time','part-time','contract','internship','freelance').required(),
 experience_level:Joi.string().valid('entry','junior','mid','senior','lead').required(),
 location_type:Joi.string().valid('remote','hybrid','on-site').required(),
 location_city:Joi.string().max(255).allow(''), salary_min:Joi.number().integer().min(0).max(2147483647).allow(null),
 salary_max:Joi.number().integer().min(0).max(2147483647).allow(null),
 is_salary_visible:Joi.boolean(), status:Joi.string().valid('open','close'),
});
const update=schema.fork(['company_id','category_id','title','description','job_type','experience_level','location_type'],f=>f.optional()).min(1);
router.get('/mine',...employer,async(req,res,next)=>{
 try{
 const {rows}=await pool.query(`SELECT ${fields},j.salary_min,j.salary_max,
 (SELECT COUNT(*)::int FROM applications a WHERE a.job_id=j.id) AS applicant_count ${from}
 WHERE j.owner_id=$1 ORDER BY j.created_at DESC`,[req.userId]);
 res.json({status:'success',data:{jobs:rows}});
 }catch(e){next(e);}
});
async function list(req,res,next){
 try{
 const {error,value:q}=Joi.object({
 title:Joi.string().allow('').max(255),'company-name':Joi.string().allow('').max(255),
 location:Joi.string().allow('').max(255),category:Joi.string().allow(''),
 job_type:Joi.string().allow(''),location_type:Joi.string().allow(''),experience_level:Joi.string().allow(''),
 status:Joi.string().valid('open','close','all').default('open'),
 page:Joi.number().integer().min(1).max(100000).default(1),limit:Joi.number().integer().min(1).max(50).default(12),
 }).validate(req.query);
 if(error)return fail(res,400,'Filter pencarian tidak valid');
 const where=[],values=[];
 const add=(sql,v)=>{values.push(v);where.push(sql.replace('?',`$${values.length}`));};
 if(q.title)add('j.title ILIKE ?',`%${q.title}%`);
 if(q['company-name'])add('c.name ILIKE ?',`%${q['company-name']}%`);
 if(q.location)add('j.location_city ILIKE ?',`%${q.location}%`);
 if(q.status!=='all')add('j.status = ?',q.status);
 for(const key of ['job_type','location_type','experience_level'])if(q[key])add(`j.${key} = ?`,q[key]);
 if(q.category||req.params.categoryId)add('j.category_id = ?',req.params.categoryId||q.category);
 if(req.params.companyId)add('j.company_id = ?',req.params.companyId);
 const clause=where.length?' WHERE '+where.join(' AND '):'';
 const count=await pool.query(`SELECT COUNT(*)::int AS total ${from}${clause}`,values);
 const result=await pool.query(`SELECT ${fields} ${from}${clause} ORDER BY j.created_at DESC,j.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,q.limit,(q.page-1)*q.limit]);
 res.json({status:'success',data:{jobs:result.rows,pagination:{page:q.page,limit:q.limit,total:count.rows[0].total,pages:Math.ceil(count.rows[0].total/q.limit)}}});
 }catch(e){next(e);}
}
router.get('/',list);
router.get('/company/:companyId',list);
router.get('/category/:categoryId',list);
router.get('/:id',async(req,res,next)=>{
 try{
 const {rows}=await pool.query(`SELECT ${fields} ${from} WHERE j.id=$1`,[req.params.id]);
 if(!rows.length)return fail(res,404,'Lowongan tidak ditemukan');
 res.json({status:'success',data:rows[0]});
 }catch(e){next(e);}
});
async function save(req,res,next){
 let db;
 try{
 const editing=Boolean(req.params.id);
 const {error,value}=(editing?update:schema).validate(req.body);
 if(error)return fail(res,400,error.details[0].message);
 db=await pool.connect();await db.query('BEGIN');
 const account=await db.query('SELECT email_verified_at FROM users WHERE id=$1 FOR SHARE',[req.userId]);
 const abort=async(code,message)=>{await db.query('ROLLBACK');return fail(res,code,message);};
 let current={};
 if(editing){
 const {rows}=await db.query('SELECT * FROM jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE',[req.params.id,req.userId]);
 if(!rows.length)return await abort(404,'Lowongan tidak ditemukan atau bukan milik Anda');
 current=rows[0];
 }
 const merged={...current,...value};
 const publishing=(!editing&&(merged.status||'open')==='open')||(editing&&current.status!=='open'&&merged.status==='open');
 if(publishing&&!account.rows[0]?.email_verified_at){await db.query('ROLLBACK');return res.status(403).json({status:'failed',code:'EMAIL_VERIFICATION_REQUIRED',message:'Verifikasi email Anda sebelum menerbitkan lowongan.'});}
 if(merged.salary_min!=null&&merged.salary_max!=null&&merged.salary_min>merged.salary_max)return await abort(400,'Gaji maksimum harus lebih besar dari atau sama dengan minimum');
 const company=await db.query('SELECT id FROM companies WHERE id=$1 AND owner_id=$2',[merged.company_id,req.userId]);
 if(!company.rowCount)return await abort(403,'Pilih perusahaan milik Anda');
 if(editing){
 const keys=Object.keys(value);
 await db.query('UPDATE jobs SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' WHERE id=$'+(keys.length+1)+' AND owner_id=$'+(keys.length+2),[...Object.values(value),req.params.id,req.userId]);
 await db.query('COMMIT');db.release();db=undefined;await scope.jobChanged(req.params.id,req.userId);res.json({status:'success',message:'Lowongan diperbarui'});
 }else{
 const id=randomUUID(),data={id,owner_id:req.userId,...value},keys=Object.keys(data);
 await db.query('INSERT INTO jobs ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(data));
 await db.query('COMMIT');res.status(201).json({status:'success',data:{id}});
 }
 }catch(e){
 if(db)await db.query('ROLLBACK').catch(()=>{});
 if(e.code==='23503')return fail(res,400,'Perusahaan atau kategori tidak valid');next(e);
 }finally{db?.release();}
}

router.post('/',...employer,save);
router.put('/:id',...employer,save);
router.delete('/:id',...employer,async(req,res,next)=>{
 try{
 const applications=await pool.query('SELECT id FROM applications WHERE job_id=$1 LIMIT 1',[req.params.id]);
 if(applications.rowCount)return fail(res,409,'Lowongan memiliki lamaran. Tutup lowongan untuk menyimpan riwayat.');
 // Bookmark ikut terhapus bersama lowongan, jadi catat pemiliknya sebelum DELETE.
 const saved=await scope.accountsRelatedTo('job',req.params.id);
 const result=await pool.query('DELETE FROM jobs WHERE id=$1 AND owner_id=$2 RETURNING id',[req.params.id,req.userId]);
 if(!result.rowCount)return fail(res,404,'Lowongan tidak ditemukan atau bukan milik Anda');
 await scope.invalidateAccounts(...saved);
 res.json({status:'success',message:'Lowongan dihapus'});
 }catch(e){if(['23503','23001'].includes(e.code))return fail(res,409,'Data masih digunakan dan tidak dapat dihapus');next(e);}
});
module.exports=router;



