const {randomUUID}=require('crypto');
const tokens=require('./resetTokens');
function configured(){try{tokens.key();tokens.baseUrl();return true;}catch{return false;}}
async function enqueue(db,user){
 const id=randomUUID(),token=tokens.tokenFor(id,'email-verification');
 await db.query('UPDATE email_verification_requests SET invalidated_at=NOW() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL',[user.id]);
 await db.query("INSERT INTO email_verification_requests(id,user_id,email,token_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '24 hours')",[id,user.id,user.email,tokens.hash(token)]);
}
module.exports={configured,enqueue};
