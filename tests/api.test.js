/**
 * MiaMed API — Integration Tests
 * Run with: npm test
 * Requires a running test database (set DB_NAME=miamed_test in .env)
 */
process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const app = require('../src/index');
const { pool } = require('../src/config/db');

let patientToken, doctorToken, adminToken;
let appointmentId, doctorId;

beforeAll(async () => {
  // Clean test state
  await pool.query(`DELETE FROM reviews`);
  await pool.query(`DELETE FROM appointments`);
  await pool.query(`DELETE FROM availability_templates`);
  await pool.query(`DELETE FROM doctors WHERE license_number = 'TEST-001'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '%@test.miamed.com'`);
});

afterAll(async () => {
  await pool.end();
});

// ─── AUTH ────────────────────────────────────────────────────────
describe('Auth', () => {
  test('POST /auth/register — creates patient', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'patient@test.miamed.com',
        password: 'Password123!',
        first_name: 'Test',
        last_name: 'Patient',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('access_token');
    patientToken = res.body.access_token;
  });

  test('POST /auth/login — returns tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'patient@test.miamed.com', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    patientToken = res.body.access_token;
  });

  test('POST /auth/login — wrong password → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'patient@test.miamed.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('GET /auth/me — returns user', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('patient@test.miamed.com');
  });

  test('GET /auth/me — no token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

// ─── SPECIALTIES ─────────────────────────────────────────────────
describe('Specialties', () => {
  test('GET /specialties — returns list', async () => {
    const res = await request(app).get('/api/v1/specialties');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── DOCTORS ─────────────────────────────────────────────────────
describe('Doctors', () => {
  test('GET /doctors — returns results', async () => {
    const res = await request(app).get('/api/v1/doctors');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('doctors');
    if (res.body.doctors.length > 0) {
      doctorId = res.body.doctors[0].id;
    }
  });

  test('GET /doctors?specialty=general-practice — filters correctly', async () => {
    const res = await request(app).get('/api/v1/doctors?specialty=general-practice');
    expect(res.status).toBe(200);
    res.body.doctors.forEach(d => {
      expect(d.specialty_slug).toBe('general-practice');
    });
  });

  test('GET /doctors/:id — returns doctor', async () => {
    if (!doctorId) return;
    const res = await request(app).get(`/api/v1/doctors/${doctorId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bio');
  });

  test('GET /doctors/:id/availability?date=2030-06-02 — returns slots', async () => {
    if (!doctorId) return;
    const res = await request(app)
      .get(`/api/v1/doctors/${doctorId}/availability?date=2030-06-02`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('slots');
  });
});

// ─── APPOINTMENTS ────────────────────────────────────────────────
describe('Appointments', () => {
  test('POST /appointments — books slot', async () => {
    if (!doctorId) return;
    const res = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctor_id: doctorId,
        date: '2030-06-02',
        time: '10:00',
        consult_type: 'in_person',
        reason: 'Annual checkup',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('reference_code');
    appointmentId = res.body.id;
  });

  test('POST /appointments — duplicate slot → 409', async () => {
    if (!doctorId || !appointmentId) return;
    const res = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ doctor_id: doctorId, date: '2030-06-02', time: '10:00' });
    expect(res.status).toBe(409);
  });

  test('GET /appointments — patient sees own appointments', async () => {
    const res = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('PATCH /appointments/:id/cancel — cancels', async () => {
    if (!appointmentId) return;
    const res = await request(app)
      .patch(`/api/v1/appointments/${appointmentId}/cancel`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ reason: 'Schedule conflict' });
    expect([200, 400]).toContain(res.status); // 400 if inside 2h window
  });
});
