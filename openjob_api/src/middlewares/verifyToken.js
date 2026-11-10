const jwt = require('jsonwebtoken');
const pool = require('../database');
module.exports = async (req,res,next) => {
  let payload;
  try {
    if (!req.headers.authorization?.startsWith('Bearer ')) throw Error('Missing token');
    payload=jwt.verify(req.headers.authorization.slice(7),process.env.ACCESS_TOKEN_KEY,{algorithms:['HS256']});
    if (!payload.id || !payload.sid) throw Error('Missing session');
  } catch { return res.status(401).json({status:'failed',message:'Sesi berakhir. Silakan masuk kembali.'}); }
  try {
    const result=await pool.query('SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND expires_at>NOW()',[payload.sid,payload.id]);
    if (!result.rowCount) return res.status(401).json({status:'failed',message:'Sesi telah berakhir'});
    req.userId=payload.id; req.sessionId=payload.sid;
    return next();
  } catch(error) { return next(error); }
};
