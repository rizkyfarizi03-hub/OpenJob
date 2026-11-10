module.exports = `SELECT a.id, a.user_id, a.job_id, a.status, a.created_at, a.updated_at, a.document_id, a.cover_letter,
 u.name AS applicant_name, u.email AS applicant_email, j.title, j.company_id,
 c.name AS company_name, j.job_type, j.location_type, j.location_city
 FROM applications a JOIN users u ON u.id = a.user_id
 JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id`;
