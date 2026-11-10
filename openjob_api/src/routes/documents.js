const router=require('express').Router();
const path=require('path');
const fs=require('fs/promises');
const {randomUUID}=require('crypto');
const pool=require('../database');
const verify=require('../middlewares/verifyToken');
const { identity, roles } = require('../middlewares/access');
const upload=require('../middlewares/uploadDocument');
const directory=process.env.OPENJOB_UPLOAD_DIRECTORY||path.resolve(__dirname,'../../uploads/documents');
const fail=(res,code,message)=>res.status(code).json({status:'failed',message});
router.use(verify, identity);
router.post('/',roles('user'),upload,async(req,res,next)=>{
 const file=req.file,id=randomUUID();
 try{
 const valid=await require('../validatePdf')(await fs.readFile(file.path));
 if(!valid){await fs.unlink(file.path);return fail(res,400,'PDF tidak valid, rusak, kosong, atau terkunci. Unggah PDF tanpa password.');}
 await pool.query('INSERT INTO documents(id,user_id,filename,original_name,mime_type,size) VALUES($1,$2,$3,$4,$5,$6)',[id,req.userId,file.filename,file.originalname,file.mimetype,file.size]);
 res.status(201).json({status:'success',data:{documentId:id,filename:file.filename,originalName:file.originalname,size:file.size}});
 }catch(e){
 await fs.unlink(file.path).catch(()=>{});
 if(e.code==='PDF_VALIDATION_TIMEOUT'){res.set('Retry-After','5');return fail(res,503,'Pemeriksaan PDF belum selesai. Server mungkin sedang sibuk atau dokumen terlalu rumit. Coba unggah kembali.');}
 next(e);
 }
});
router.get('/',roles('user'),async(req,res,next)=>{
 try{
 const {rows}=await pool.query(`SELECT d.id,d.original_name AS "originalName",d.size,d.created_at AS "createdAt",
 EXISTS(SELECT 1 FROM applications a WHERE a.document_id=d.id) AS "inUse"
 FROM documents d WHERE d.user_id=$1 ORDER BY d.created_at DESC`,[req.userId]);
 res.json({status:'success',data:{documents:rows}});
 }catch(e){next(e);}
});
router.get('/:id',async(req,res,next)=>{
 try{
 const {rows}=await pool.query(`SELECT d.filename, d.original_name FROM documents d WHERE d.id=$1 AND
 (d.user_id=$2 OR EXISTS(SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.document_id=d.id AND j.owner_id=$2 AND a.status<>'withdrawn'))`,[req.params.id,req.userId]);
 if(!rows.length)return fail(res,404,'Dokumen tidak ditemukan atau akses ditolak');
 const rawName = rows[0].original_name || 'cv.pdf';
 const safeName = rawName.replace(/["\r\n\\]/g, '').trim() || 'cv.pdf';
 res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${safeName}"`,'Access-Control-Expose-Headers':'Content-Disposition','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
 res.sendFile(path.join(directory,rows[0].filename),err=>{if(err&&!res.headersSent)fail(res,404,'Berkas dokumen tidak ditemukan');});
 }catch(e){next(e);}
});
router.delete('/:id',roles('user'),async(req,res,next)=>{
 try{
 // FK RESTRICT keeps submitted CVs stable and protects concurrent application creation.
 const {rows}=await pool.query('DELETE FROM documents WHERE id=$1 AND user_id=$2 RETURNING filename',[req.params.id,req.userId]);
 if(!rows.length)return fail(res,404,'Dokumen tidak ditemukan atau bukan milik Anda');
 await require('../documentCleanup').cleanup().catch(e=>console.error('Pembersihan dokumen akan diulang:',e.code||e.name));
 res.json({status:'success',message:'Dokumen dihapus'});
 }catch(e){if(['23503','23001'].includes(e.code))return fail(res,409,'CV sudah digunakan dalam lamaran dan harus disimpan sebagai riwayat');next(e);}
});
module.exports=router;



