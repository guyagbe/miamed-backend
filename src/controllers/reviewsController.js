const { query } = require('../config/db');

// POST /reviews
const create = async (req, res, next) => {
  try {
    const { appointment_id, rating, comment, is_anonymous = false } = req.body;
    const patientId = req.user.id;

    // Verify appointment belongs to this patient and is completed
    const { rows: appts } = await query(
      `SELECT a.id, a.doctor_id, a.patient_id, a.status
       FROM appointments a WHERE a.id = $1`,
      [appointment_id]
    );
    if (!appts.length) return res.status(404).json({ error: 'Appointment not found' });
    const appt = appts[0];
    if (appt.patient_id !== patientId) return res.status(403).json({ error: 'Not your appointment' });
    if (appt.status !== 'completed') return res.status(400).json({ error: 'Can only review completed appointments' });

    const { rows } = await query(
      `INSERT INTO reviews (appointment_id, patient_id, doctor_id, rating, comment, is_anonymous)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (appointment_id) DO UPDATE SET rating=$4, comment=$5
       RETURNING *`,
      [appointment_id, patientId, appt.doctor_id, rating, comment || null, is_anonymous]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
};

// GET /reviews/me  (patient's own reviews)
const myReviews = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.*, ud.first_name || ' ' || ud.last_name AS doctor_name, s.name AS specialty
       FROM reviews r
       JOIN doctors d ON d.id = r.doctor_id
       JOIN users ud ON ud.id = d.user_id
       JOIN specialties s ON s.id = d.specialty_id
       WHERE r.patient_id = $1 ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
};

module.exports = { create, myReviews };
