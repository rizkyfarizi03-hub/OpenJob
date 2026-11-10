module.exports = `SELECT b.id, b.user_id, b.job_id, b.created_at,
 j.company_id, j.category_id, j.title, j.description, j.job_type, j.experience_level,
 j.location_type, j.location_city,
 CASE WHEN j.is_salary_visible THEN j.salary_min ELSE NULL END AS salary_min,
 CASE WHEN j.is_salary_visible THEN j.salary_max ELSE NULL END AS salary_max, j.is_salary_visible,
 j.status, j.created_at AS job_created_at, c.name AS company_name
 FROM bookmarks b JOIN jobs j ON j.id = b.job_id JOIN companies c ON c.id = j.company_id`;
