const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const signAccess = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const signRefresh = (userId) =>
  jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

// POST /auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, phone, date_of_birth, gender } = req.body;

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, date_of_birth, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, email, role, first_name, last_name, created_at`,
      [email, hash, first_name, last_name, phone || null, date_of_birth || null, gender || null]
    );

    const user = rows[0];
    const accessToken  = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    res.status(201).json({ user, access_token: accessToken, refresh_token: refreshToken });
  } catch (err) { next(err); }
};

// POST /auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await query(
      'SELECT id, email, role, first_name, last_name, password_hash, is_active FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    const accessToken  = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    const { password_hash, ...safe } = user;
    res.json({ user: safe, access_token: accessToken, refresh_token: refreshToken });
  } catch (err) { next(err); }
};

// POST /auth/refresh
const refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

    let payload;
    try {
      payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const { rows } = await query(
      'SELECT id, refresh_token FROM users WHERE id = $1 AND is_active = TRUE', [payload.sub]
    );
    if (!rows.length || rows[0].refresh_token !== refresh_token) {
      return res.status(401).json({ error: 'Refresh token revoked' });
    }

    const newAccess  = signAccess(payload.sub);
    const newRefresh = signRefresh(payload.sub);
    await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefresh, payload.sub]);

    res.json({ access_token: newAccess, refresh_token: newRefresh });
  } catch (err) { next(err); }
};

// POST /auth/logout
const logout = async (req, res, next) => {
  try {
    await query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
};

// GET /auth/me
const me = async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.phone,
            u.date_of_birth, u.gender, u.avatar_url, u.created_at,
            d.id AS doctor_id
     FROM users u
     LEFT JOIN doctors d ON d.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
};

module.exports = { register, login, refresh, logout, me };
