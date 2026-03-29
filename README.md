# 🏥 MiaMed Backend API

REST API for the MiaMed healthcare appointment booking platform — Miami, FL.

---

## Quick Start

```bash
# 1. Clone & install
npm install

# 2. Configure environment
cp .env.example .env
# → Edit .env with your DB credentials and JWT secrets

# 3. Start with Docker (recommended)
docker compose up -d

# 4. Or run locally (requires PostgreSQL running)
npm run migrate   # Create all tables
npm run seed      # Insert specialties + demo doctors
npm run dev       # Start with hot reload
```

**Demo credentials (after seed):**
| Role    | Email                        | Password      |
|---------|------------------------------|---------------|
| Patient | patient@miamed.com           | Password123!  |
| Doctor  | maria.rodriguez@miamed.com   | Password123!  |
| Admin   | admin@miamed.com             | Password123!  |

---

## Base URL

```
http://localhost:3000/api/v1
```

Health check: `GET http://localhost:3000/health`

---

## Authentication

All protected routes require:
```
Authorization: Bearer <access_token>
```

Tokens expire in 7 days. Use the refresh endpoint to get a new one.

---

## API Reference

### 🔐 Auth

| Method | Endpoint           | Auth | Description              |
|--------|--------------------|------|--------------------------|
| POST   | /auth/register     | —    | Register new patient     |
| POST   | /auth/login        | —    | Login, get tokens        |
| POST   | /auth/refresh      | —    | Refresh access token     |
| POST   | /auth/logout       | ✓    | Revoke refresh token     |
| GET    | /auth/me           | ✓    | Get current user         |

**Register:**
```json
POST /auth/register
{
  "email": "john.doe@email.com",
  "password": "SecurePass123!",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "305-555-0199"
}
```

**Login response:**
```json
{
  "user": { "id": "uuid", "email": "...", "role": "patient", ... },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

---

### 🔬 Specialties

| Method | Endpoint       | Auth | Description               |
|--------|----------------|------|---------------------------|
| GET    | /specialties   | —    | List all with doctor count|

---

### 👨‍⚕️ Doctors

| Method | Endpoint                        | Auth        | Description             |
|--------|---------------------------------|-------------|-------------------------|
| GET    | /doctors                        | —           | Search & filter doctors |
| GET    | /doctors/:id                    | —           | Doctor profile          |
| GET    | /doctors/:id/availability       | —           | Available time slots    |
| GET    | /doctors/:id/reviews            | —           | Patient reviews         |
| PUT    | /doctors/:id                    | Doctor only | Update own profile      |

**Search params:**
```
GET /doctors?specialty=cardiology&neighborhood=Brickell&language=Spanish
             &insurance=BCBS&consult_type=teleconsult&date=2026-04-01
             &sort=rating&page=1&limit=20
```

**Availability response:**
```json
GET /doctors/:id/availability?date=2026-04-01
{
  "date": "2026-04-01",
  "slots": [
    { "time": "09:00", "available": false },
    { "time": "09:30", "available": true },
    { "time": "10:00", "available": true }
  ]
}
```

---

### 📅 Appointments

| Method | Endpoint                        | Auth       | Description             |
|--------|---------------------------------|------------|-------------------------|
| POST   | /appointments                   | Patient    | Book appointment        |
| GET    | /appointments                   | Any        | List own appointments   |
| GET    | /appointments/:id               | Any        | Get appointment detail  |
| PATCH  | /appointments/:id/cancel        | Any        | Cancel (2h rule)        |
| PATCH  | /appointments/:id/complete      | Doctor/Admin| Mark as completed      |

**Book appointment:**
```json
POST /appointments
Authorization: Bearer <patient_token>
{
  "doctor_id": "uuid",
  "date": "2026-04-01",
  "time": "09:30",
  "consult_type": "in_person",
  "reason": "Annual checkup"
}
```

**Response:**
```json
{
  "id": "uuid",
  "reference_code": "MM-A1B2C3",
  "appt_date": "2026-04-01",
  "start_time": "09:30:00",
  "end_time": "10:00:00",
  "status": "confirmed",
  "doctor_first": "Maria",
  "doctor_last": "Rodriguez",
  "specialty": "General Practice",
  "address": "1450 Brickell Ave, Suite 200"
}
```

**List params:**
```
GET /appointments?status=confirmed&from=2026-01-01&to=2026-12-31
```

---

### ⭐ Reviews

| Method | Endpoint       | Auth    | Description                        |
|--------|----------------|---------|------------------------------------|
| POST   | /reviews       | Patient | Review a completed appointment     |
| GET    | /reviews/me    | Patient | Get own reviews                    |

```json
POST /reviews
{
  "appointment_id": "uuid",
  "rating": 5,
  "comment": "Excellent doctor, very thorough.",
  "is_anonymous": false
}
```

---

### 👤 User Profile

| Method | Endpoint   | Auth | Description        |
|--------|------------|------|--------------------|
| GET    | /users/me  | ✓    | Get own profile    |
| PATCH  | /users/me  | ✓    | Update own profile |

---

### 🔧 Admin

| Method | Endpoint                       | Auth  | Description          |
|--------|--------------------------------|-------|----------------------|
| GET    | /admin/users                   | Admin | List all users       |
| PATCH  | /admin/doctors/:id/verify      | Admin | Toggle verification  |

---

## Database Schema

```
users ──────────────── doctors ─────── specialties
  │                      │
  │                      ├── availability_templates
  │                      └── availability_overrides
  │
  └── appointments ─────────────────── (doctor_id)
        └── reviews
```

### Key design decisions

- **UUID primary keys** — safer for public APIs than sequential integers
- **Atomic slot booking** — `SELECT ... FOR UPDATE` prevents double-booking
- **Rating trigger** — doctor rating auto-recalculates on every review
- **Soft availability** — templates define recurring schedule; overrides handle exceptions
- **Role-based access** — patient/doctor/admin enforced at middleware level
- **2h cancellation window** — enforced server-side, not just frontend

---

## Error Format

All errors return:
```json
{
  "error": "Human-readable message",
  "details": [{ "field": "email", "message": "Invalid email" }]  // validation only
}
```

| Status | Meaning                          |
|--------|----------------------------------|
| 400    | Bad request / validation         |
| 401    | Not authenticated                |
| 403    | Authenticated but not authorized |
| 404    | Resource not found               |
| 409    | Conflict (duplicate / slot taken)|
| 422    | Validation failed                |
| 429    | Rate limited                     |
| 500    | Internal server error            |

---

## Running Tests

```bash
npm test
```

Tests require the database to be running. Uses a separate test DB if `DB_NAME=miamed_test` is set.

---

## Project Structure

```
miamed-backend/
├── src/
│   ├── config/
│   │   ├── db.js           # PostgreSQL connection pool
│   │   ├── migrate.js      # Schema migration
│   │   └── seed.js         # Demo data
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── doctorsController.js
│   │   ├── appointmentsController.js
│   │   ├── reviewsController.js
│   │   └── miscController.js
│   ├── middleware/
│   │   ├── auth.js         # JWT verification + role guard
│   │   └── errors.js       # Validation + error handler
│   ├── routes/
│   │   └── index.js        # All route definitions
│   └── index.js            # Express app entry point
├── tests/
│   └── api.test.js
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## Deployment (Production)

1. Set `NODE_ENV=production` in environment
2. Replace all `dev_*` secrets in `.env` with strong random strings
3. Use a managed PostgreSQL service (AWS RDS, Supabase, Neon, Railway)
4. Deploy the Docker image to Railway, Render, or AWS ECS
5. Put behind a reverse proxy (Nginx or Caddy) with HTTPS

```bash
# Generate strong secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
