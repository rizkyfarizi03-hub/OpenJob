const express=require('express');
const Joi=require('joi');
const bcrypt=require('bcrypt');
const jwt=require('jsonwebtoken');
const {randomUUID}=require('crypto');
const pool=require('../database');
const {hash,tokens}=require('../sessions');
const router=express.Router();
const fail=(res,code,message)=>res.status(code).json({status:'failed',message});
const password=Joi.string().custom((v,h)=>Buffer.byteLength(v,'utf8')<=72?v:h.error('string.max',{limit:72}));
const attempts=new Map();
router.post('/',async(req,res,next)=>{
 const {error,value}=Joi.object({email:Joi.string().trim().lowercase().email().required(),password:password.required()}).validate(req.body);
 if(error)return fail(res,400,error.message);
 const now=Date.now();
 for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);
 const key=req.ip;
 const entry=attempts.get(key)||{count:0,until:now+15*60*1000};
 if(entry.count>=30){res.set('Retry-After',String(Math.ceil((entry.until-now)/1000)));return fail(res,429,'Terlalu banyak percobaan masuk. Coba lagi nanti.');}
 entry.count++;attempts.set(key,entry);
 let client;
 try{
 client=await pool.connect();await client.query('BEGIN');
 const result=await client.query('SELECT * FROM users WHERE lower(trim(email))=$1 FOR UPDATE',[value.email]);
 const user=result.rows[0];
 if(!user||!await bcrypt.compare(value.password,user.password_hash)){await client.query('ROLLBACK');return fail(res,401,'Email atau password salah');}
 const sid=randomUUID(),expiresAt=new Date(Date.now()+7*86400000),data=tokens(user.id,sid,expiresAt);
 await client.query('DELETE FROM auth_sessions WHERE user_id=$1 AND expires_at<=NOW()',[user.id]);
 await client.query('INSERT INTO auth_sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,$4)',[sid,user.id,hash(data.refreshToken),expiresAt]);
 await client.query('COMMIT');
 return res.json({status:'success',data});
 }catch(e){if(client)await client.query('ROLLBACK');next(e);}finally{client?.release();}
});
router.use(async(req,res,next)=>{
 if(!['PUT','DELETE'].includes(req.method))return next();
 const {error,value}=Joi.object({refreshToken:Joi.string().required()}).validate(req.body);
 if(error)return fail(res,400,error.message);
 try{
 req.refreshPayload=jwt.verify(value.refreshToken,process.env.REFRESH_TOKEN_KEY,{algorithms:['HS256']});
 if(!req.refreshPayload.id||!req.refreshPayload.sid)throw Error('Invalid');
 req.refreshHash=hash(value.refreshToken);
 }catch{return fail(res,400,'Refresh token tidak valid atau kedaluwarsa');}
 next();
});
router.put('/',async(req,res,next)=>{
 try{
 const p=req.refreshPayload;
 const data=tokens(p.id,p.sid,new Date(p.exp*1000));
 const result=await pool.query('UPDATE auth_sessions SET refresh_hash=$1 WHERE id=$2 AND user_id=$3 AND refresh_hash=$4 AND expires_at>NOW() RETURNING id',[hash(data.refreshToken),p.sid,p.id,req.refreshHash]);
 if(!result.rowCount)return fail(res,400,'Sesi tidak ditemukan');
 res.json({status:'success',data});
 }catch(e){next(e);}
});
router.delete('/',async(req,res,next)=>{
 const p=req.refreshPayload;
 if(req.headers.authorization){
 try{
 const access=jwt.verify(req.headers.authorization.replace(/^Bearer /,''),process.env.ACCESS_TOKEN_KEY,{algorithms:['HS256'],ignoreExpiration:true});
 if(access.id!==p.id||access.sid!==p.sid)throw Error('Mismatch');
 }catch{return fail(res,400,'Sesi tidak sesuai');}
 }
 try{
 const result=await pool.query('DELETE FROM auth_sessions WHERE id=$1 AND user_id=$2 AND refresh_hash=$3 RETURNING id',[p.sid,p.id,req.refreshHash]);
 if(!result.rowCount)return fail(res,400,'Sesi tidak ditemukan');
 res.json({status:'success',message:'Logout berhasil'});
 }catch(e){next(e);}
});
module.exports=router;

