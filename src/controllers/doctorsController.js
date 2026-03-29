const { query } = require('../config/db');

// GET /doctors  — search & filter
const search = async (req, res, next) => {
  try {
    const {
      specialty,        // slug
      neighborhood,
      language,
      insurance,
      consult_type,
      is_accepting_new,
      date,             // YYYY-MM-DD — filter by available date
      sort = 'rating',  // rating | distance | availability
      page = 1,
      limit = 20,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ['d.is_verified = TRUE'];
    const params = [];
    let p = 1;

    if (specialty) {
      conditions.push(`s.slug = $${p++}`);
      params.push(specialty);
    }
    if (neighborhood) {
      conditions.push(`d.neighborhood ILIKE $${p++}`);
      params.push(`%${neighborhood}%`);
    }
    if (language) {
      conditions.push(`$${p++} = ANY(d.languages)`);
      params.push(language);
    }
    if (insurance) {
      conditions.push(`$${p++} = ANY(d.insurances)`);
      params.push(insurance);
    }
    if (consult_type && consult_type !== 'both') {
      conditions.push(`d.consult_type IN ('both', $${p++})`);
      params.push(consult_type);
    }
    if (is_accepting_new === 'true') {
      conditions.push('d.is_accepting_new = TRUE');
    }
    if (date) {
      const dow = new Date(date).getDay();
      conditions.push(`EXISTS (
        SELECT 1 FROM availability_templates at
        WHERE at.doctor_id = d.id AND at.day_of_week = $${p++} AND at.is_active
        AND NOT EXISTS (
          SELECT 1 FROM availability_overrides ao
          WHERE ao.doctor_id = d.id AND ao.override_date = $${p++} AND ao.is_day_off
        )
      )`);
      params.push(dow, date);
      p++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const orderMap = {
      rating:  'd.rating_avg DESC, d.rating_count DESC',
      distance: 'd.id',  // real distance needs lat/lng param — placeholder
    };
    const order = orderMap[sort] || orderMap.rating;

    const countSql = `
      SELECT COUNT(*) FROM doctors d
      JOIN users u ON u.id = d.user_id
      JOIN specialties s ON s.id = d.specialty_id
      ${where}`;
    const dataSql = `
      SELECT
        d.id, d.neighborhood, d.address, d.city, d.state,
        d.consult_type, d.consultation_fee, d.languages, d.insurances,
        d.is_accepting_new, d.rating_avg, d.rating_count, d.latitude, d.longitude,
        d.years_experience,
        u.first_name, u.last_name, u.avatar_url,
        s.name AS specialty, s.slug AS specialty_slug, s.icon AS specialty_icon
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      JOIN specialties s ON s.id = d.specialty_id
      ${where}
      ORDER BY ${order}
      LIMIT $${p++} OFFSET $${p++}`;

    const [countRes, dataRes] = await Promise.all([
      query(countSql, params),
      query(dataSql, [...params, parseInt(limit), offset]),
    ]);

    res.json({
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      doctors: dataRes.rows,
    });
  } catch (err) { next(err); }
};

// GET /doctors/:id
const getOne = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         d.id, d.bio, d.years_experience, d.medical_school,
         d.consult_type, d.consultation_fee, d.address, d.neighborhood,
         d.city, d.state, d.zip, d.latitude, d.longitude,
         d.languages, d.insurances, d.is_accepting_new,
         d.rating_avg, d.rating_count, d.license_number,
         u.first_name, u.last_name, u.avatar_url,
         s.name AS specialty, s.slug AS specialty_slug, s.icon AS specialty_icon
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       JOIN specialties s ON s.id = d.specialty_id
       WHERE d.id = $1 AND d.is_verified = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Doctor not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

// GET /doctors/:id/availability?date=YYYY-MM-DD
const getAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

    const targetDate = new Date(date + 'T00:00:00');
    const dow = targetDate.getDay();

    // Get template for this day
    const { rows: templates } = await query(
      `SELECT start_time, end_time, slot_minutes FROM availability_templates
       WHERE doctor_id = $1 AND day_of_week = $2 AND is_active`,
      [id, dow]
    );
    if (!templates.length) {
      return res.json({ date, slots: [] });
    }

    // Check for day-off override
    const { rows: overrides } = await query(
      `SELECT is_day_off FROM availability_overrides
       WHERE doctor_id = $1 AND override_date = $2`,
      [id, date]
    );
    if (overrides.length && overrides[0].is_day_off) {
      return res.json({ date, slots: [] });
    }

    // Existing appointments that day
    const { rows: booked } = await query(
      `SELECT start_time FROM appointments
       WHERE doctor_id = $1 AND appt_date = $2 AND status NOT IN ('cancelled')`,
      [id, date]
    );
    const bookedSet = new Set(booked.map(r => r.start_time.slice(0, 5)));

    // Generate slots
    const slots = [];
    for (const tpl of templates) {
      const [sh, sm] = tpl.start_time.split(':').map(Number);
      const [eh, em] = tpl.end_time.split(':').map(Number);
      let cur = sh * 60 + sm;
      const end = eh * 60 + em;
      while (cur + tpl.slot_minutes <= end) {
        const hh = String(Math.floor(cur / 60)).padStart(2, '0');
        const mm = String(cur % 60).padStart(2, '0');
        const time = `${hh}:${mm}`;
        slots.push({ time, available: !bookedSet.has(time) });
        cur += tpl.slot_minutes;
      }
    }

    res.json({ date, slots });
  } catch (err) { next(err); }
};

// GET /doctors/:id/reviews
const getReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows } = await query(
      `SELECT
         r.id, r.rating, r.comment, r.is_anonymous, r.created_at,
         CASE WHEN r.is_anonymous THEN 'Anonymous' ELSE u.first_name || ' ' || LEFT(u.last_name, 1) || '.' END AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.patient_id
       WHERE r.doctor_id = $1 AND r.is_visible
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, parseInt(limit), offset]
    );
    res.json(rows);
  } catch (err) { next(err); }
};

// PUT /doctors/:id  (doctor self-update)
const updateProfile = async (req, res, next) => {
  try {
    const { rows: doc } = await query('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
    if (!doc.length || doc[0].id !== req.params.id) {
      return res.status(403).json({ error: 'Cannot edit another doctor\'s profile' });
    }

    const { bio, consultation_fee, is_accepting_new, languages, insurances,
            address, neighborhood, consult_type } = req.body;
    const { rows } = await query(
      `UPDATE doctors SET
         bio = COALESCE($1, bio),
         consultation_fee = COALESCE($2, consultation_fee),
         is_accepting_new = COALESCE($3, is_accepting_new),
         languages = COALESCE($4, languages),
         insurances = COALESCE($5, insurances),
         address = COALESCE($6, address),
         neighborhood = COALESCE($7, neighborhood),
         consult_type = COALESCE($8, consult_type)
       WHERE id = $9
       RETURNING id`,
      [bio, consultation_fee, is_accepting_new, languages, insurances,
       address, neighborhood, consult_type, req.params.id]
    );
    res.json({ message: 'Profile updated', id: rows[0].id });
  } catch (err) { next(err); }
};

module.exports = { search, getOne, getAvailability, getReviews, updateProfile };
