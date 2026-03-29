const { query } = require('../config/db');

// ─── Specialties ───────────────────────────────────────────────
const listSpecialties = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.slug, s.icon,
              COUNT(d.id) AS doctor_count
       FROM specialties s
       LEFT JOIN doctors d ON d.specialty_id = s.id AND d.is_verified
       GROUP BY s.id ORDER BY s.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
};

// ─── Users (patient self-service) ──────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, first_name, last_name, phone, date_of_birth,
              gender, avatar_url, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
};

const updateProfile = async (req, res, next) => {
  try {
    const { first_name, last_name, phone, date_of_birth, gender } = req.body;
    await query(
      `UPDATE users SET
         first_name   = COALESCE($1, first_name),
         last_name    = COALESCE($2, last_name),
         phone        = COALESCE($3, phone),
         date_of_birth= COALESCE($4, date_of_birth),
         gender       = COALESCE($5, gender)
       WHERE id = $6`,
      [first_name, last_name, phone, date_of_birth, gender, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
};

// ─── Admin ─────────────────────────────────────────────────────
const adminListUsers = async (req, res, next) => {
  try {
    const { role, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const cond = role ? 'WHERE role = $3' : '';
    const params = role
      ? [parseInt(limit), offset, role]
      : [parseInt(limit), offset];
    const { rows } = await query(
      `SELECT id, email, role, first_name, last_name, is_active, created_at
       FROM users ${cond} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
};

const adminVerifyDoctor = async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE doctors SET is_verified = NOT is_verified WHERE id = $1 RETURNING id, is_verified`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doctor not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

module.exports = { listSpecialties, getProfile, updateProfile, adminListUsers, adminVerifyDoctor };
