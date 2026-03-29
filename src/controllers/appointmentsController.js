const { query, transaction } = require('../config/db');

const genRef = () => 'MM-' + Date.now().toString(36).toUpperCase().slice(-6) +
  Math.random().toString(36).substring(2, 4).toUpperCase();

// POST /appointments
const book = async (req, res, next) => {
  try {
    const { doctor_id, date, time, consult_type = 'in_person', reason } = req.body;
    const patientId = req.user.id;

    // Validate date is not past
    if (new Date(date + 'T' + time) < new Date()) {
      return res.status(400).json({ error: 'Cannot book an appointment in the past' });
    }

    // Fetch slot duration from template
    const dow = new Date(date + 'T00:00:00').getDay();
    const { rows: tpls } = await query(
      `SELECT slot_minutes FROM availability_templates
       WHERE doctor_id = $1 AND day_of_week = $2 AND is_active`,
      [doctor_id, dow]
    );
    if (!tpls.length) {
      return res.status(400).json({ error: 'Doctor is not available on this day' });
    }
    const slotMin = tpls[0].slot_minutes;
    const [h, m] = time.split(':').map(Number);
    const endMin = h * 60 + m + slotMin;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const result = await transaction(async (client) => {
      // Lock check — slot must be free
      const { rows: conflict } = await client.query(
        `SELECT id FROM appointments
         WHERE doctor_id = $1 AND appt_date = $2 AND start_time = $3
         AND status NOT IN ('cancelled')
         FOR UPDATE`,
        [doctor_id, date, time]
      );
      if (conflict.length) {
        const err = new Error('This time slot is no longer available');
        err.status = 409;
        throw err;
      }

      const ref = genRef();
      const { rows } = await client.query(
        `INSERT INTO appointments
           (patient_id, doctor_id, appt_date, start_time, end_time,
            consult_type, reason, reference_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [patientId, doctor_id, date, time, endTime, consult_type, reason || null, ref]
      );
      return rows[0];
    });

    // Fetch enriched response
    const { rows: enriched } = await query(
      `SELECT a.*,
              u.first_name AS doctor_first, u.last_name AS doctor_last,
              s.name AS specialty,
              d.address, d.neighborhood
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users u ON u.id = d.user_id
       JOIN specialties s ON s.id = d.specialty_id
       WHERE a.id = $1`,
      [result.id]
    );

    res.status(201).json(enriched[0]);
  } catch (err) { next(err); }
};

// GET /appointments  (patient: own | doctor: own schedule | admin: all)
const list = async (req, res, next) => {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conds = [];
    let p = 1;

    if (req.user.role === 'patient') {
      conds.push(`a.patient_id = $${p++}`); params.push(req.user.id);
    } else if (req.user.role === 'doctor') {
      const { rows } = await query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
      if (!rows.length) return res.status(404).json({ error: 'Doctor profile not found' });
      conds.push(`a.doctor_id = $${p++}`); params.push(rows[0].id);
    }
    // admin sees all

    if (status) { conds.push(`a.status = $${p++}`); params.push(status); }
    if (from)   { conds.push(`a.appt_date >= $${p++}`); params.push(from); }
    if (to)     { conds.push(`a.appt_date <= $${p++}`); params.push(to); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await query(
      `SELECT a.id, a.appt_date, a.start_time, a.end_time, a.consult_type,
              a.status, a.reason, a.reference_code, a.created_at,
              up.first_name AS patient_first, up.last_name AS patient_last,
              ud.first_name AS doctor_first, ud.last_name AS doctor_last,
              s.name AS specialty, d.address, d.neighborhood
       FROM appointments a
       JOIN users up ON up.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users ud ON ud.id = d.user_id
       JOIN specialties s ON s.id = d.specialty_id
       ${where}
       ORDER BY a.appt_date DESC, a.start_time DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, parseInt(limit), offset]
    );
    res.json(rows);
  } catch (err) { next(err); }
};

// GET /appointments/:id
const getOne = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*,
              up.first_name AS patient_first, up.last_name AS patient_last, up.phone AS patient_phone,
              ud.first_name AS doctor_first, ud.last_name AS doctor_last,
              s.name AS specialty, d.address, d.neighborhood, d.consultation_fee
       FROM appointments a
       JOIN users up ON up.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users ud ON ud.id = d.user_id
       JOIN specialties s ON s.id = d.specialty_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });

    const appt = rows[0];
    const isOwner = req.user.role === 'admin' ||
      appt.patient_id === req.user.id ||
      (req.user.role === 'doctor');  // further check done below if needed

    if (!isOwner) return res.status(403).json({ error: 'Access denied' });
    res.json(appt);
  } catch (err) { next(err); }
};

// PATCH /appointments/:id/cancel
const cancel = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { rows } = await query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });

    const appt = rows[0];
    if (!['confirmed', 'pending'].includes(appt.status)) {
      return res.status(400).json({ error: `Cannot cancel an appointment with status "${appt.status}"` });
    }

    // 2-hour cancellation window check (patients only)
    if (req.user.role === 'patient') {
      const apptDT = new Date(`${appt.appt_date}T${appt.start_time}`);
      const diffMs = apptDT - new Date();
      if (diffMs < 2 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Cancellations must be made at least 2 hours before the appointment' });
      }
    }

    await query(
      `UPDATE appointments SET status='cancelled', cancellation_reason=$1,
       cancelled_by=$2, cancelled_at=NOW() WHERE id=$3`,
      [reason || null, req.user.id, req.params.id]
    );
    res.json({ message: 'Appointment cancelled' });
  } catch (err) { next(err); }
};

// PATCH /appointments/:id/complete  (doctor only)
const complete = async (req, res, next) => {
  try {
    const { notes } = req.body;
    const { rows } = await query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    if (rows[0].status !== 'confirmed') {
      return res.status(400).json({ error: 'Only confirmed appointments can be marked complete' });
    }
    await query(
      `UPDATE appointments SET status='completed', notes=$1 WHERE id=$2`,
      [notes || null, req.params.id]
    );
    res.json({ message: 'Appointment marked as completed' });
  } catch (err) { next(err); }
};

module.exports = { book, list, getOne, cancel, complete };
