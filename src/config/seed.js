require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool, transaction } = require('./db');

const specialties = [
  { name: 'General Practice',  slug: 'general-practice',  icon: '🩺' },
  { name: 'Cardiology',        slug: 'cardiology',         icon: '🫀' },
  { name: 'Dermatology',       slug: 'dermatology',        icon: '🧴' },
  { name: 'Psychiatry',        slug: 'psychiatry',         icon: '🧠' },
  { name: 'Dentistry',         slug: 'dentistry',          icon: '🦷' },
  { name: 'Pediatrics',        slug: 'pediatrics',         icon: '👶' },
  { name: 'Orthopedics',       slug: 'orthopedics',        icon: '🦴' },
  { name: 'Ophthalmology',     slug: 'ophthalmology',      icon: '👁️' },
  { name: 'Gynecology',        slug: 'gynecology',         icon: '🌸' },
  { name: 'Neurology',         slug: 'neurology',          icon: '⚡' },
];

const doctors = [
  {
    first_name: 'Maria', last_name: 'Rodriguez',
    email: 'maria.rodriguez@miamed.com',
    specialty_slug: 'general-practice',
    license: 'FL-GP-100001',
    bio: 'Board-certified family medicine physician with 14 years serving Miami. Specializes in preventive care, chronic disease management, and women\'s health.',
    years_experience: 14, medical_school: 'University of Miami',
    consult_type: 'both', consultation_fee: 150,
    address: '1450 Brickell Ave, Suite 200', neighborhood: 'Brickell',
    languages: ['English', 'Spanish'],
    insurances: ['BCBS', 'Aetna', 'Cigna', 'UnitedHealth'],
    latitude: 25.7617, longitude: -80.1918,
    days: [1,2,3,4,5], start: '09:00', end: '18:00',
  },
  {
    first_name: 'James', last_name: 'Williams',
    email: 'james.williams@miamed.com',
    specialty_slug: 'cardiology',
    license: 'FL-CA-100002',
    bio: 'Interventional cardiologist specializing in heart failure, coronary artery disease, and preventive cardiology.',
    years_experience: 18, medical_school: 'Johns Hopkins University',
    consult_type: 'in_person', consultation_fee: 250,
    address: '8900 N Kendall Dr', neighborhood: 'Kendall',
    languages: ['English'],
    insurances: ['Cigna', 'UnitedHealth', 'Aetna'],
    latitude: 25.6877, longitude: -80.3565,
    days: [1,2,4], start: '10:00', end: '17:00',
  },
  {
    first_name: 'Laura', last_name: 'Mendez',
    email: 'laura.mendez@miamed.com',
    specialty_slug: 'dermatology',
    license: 'FL-DE-100003',
    bio: 'Cosmetic and medical dermatologist fluent in English, Spanish, and Portuguese. Expert in skin cancer screening and treatment.',
    years_experience: 11, medical_school: 'University of São Paulo',
    consult_type: 'both', consultation_fee: 200,
    address: '300 Alhambra Cir', neighborhood: 'Coral Gables',
    languages: ['English', 'Spanish', 'Portuguese'],
    insurances: ['BCBS', 'Humana'],
    latitude: 25.7480, longitude: -80.2582,
    days: [1,2,3,4,5], start: '08:00', end: '16:00',
  },
  {
    first_name: 'Antoine', last_name: 'Theodore',
    email: 'antoine.theodore@miamed.com',
    specialty_slug: 'psychiatry',
    license: 'FL-PS-100004',
    bio: 'Psychiatrist specializing in anxiety, depression, PTSD, and cross-cultural mental health. Fluent in English, French, and Haitian Creole.',
    years_experience: 9, medical_school: 'Université de Montréal',
    consult_type: 'both', consultation_fee: 180,
    address: '2601 SW 37th Ave', neighborhood: 'Coral Gables',
    languages: ['English', 'French', 'French Creole'],
    insurances: ['Aetna', 'Cigna'],
    latitude: 25.7489, longitude: -80.2476,
    days: [2,3,4,5], start: '11:00', end: '19:00',
  },
  {
    first_name: 'Sofia', last_name: 'Chen',
    email: 'sofia.chen@miamed.com',
    specialty_slug: 'pediatrics',
    license: 'FL-PE-100005',
    bio: 'Pediatrician dedicated to children\'s health from newborns through adolescence. Special interest in developmental medicine.',
    years_experience: 7, medical_school: 'Duke University',
    consult_type: 'both', consultation_fee: 160,
    address: '1150 NW 14th St', neighborhood: 'Wynwood',
    languages: ['English', 'Spanish', 'Mandarin'],
    insurances: ['BCBS', 'Aetna', 'Humana', 'UnitedHealth'],
    latitude: 25.7903, longitude: -80.2101,
    days: [1,2,3,4,5], start: '08:30', end: '17:00',
  },
];

function generateRefCode() {
  return 'MM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function seed() {
  console.log('🌱  Seeding database...');
  const hash = await bcrypt.hash('Password123!', 12);

  await transaction(async (client) => {
    // Specialties
    console.log('  → Inserting specialties...');
    const specMap = {};
    for (const s of specialties) {
      const { rows } = await client.query(
        `INSERT INTO specialties (name, slug, icon)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [s.name, s.slug, s.icon]
      );
      specMap[s.slug] = rows[0].id;
    }

    // Admin user
    console.log('  → Creating admin...');
    await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, 'admin', 'Admin', 'MiaMed')
       ON CONFLICT (email) DO NOTHING`,
      ['admin@miamed.com', hash]
    );

    // Doctors
    console.log('  → Creating doctors...');
    for (const d of doctors) {
      const userId = uuidv4();
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, first_name, last_name, email_verified)
         VALUES ($1, $2, $3, 'doctor', $4, $5, TRUE)
         ON CONFLICT (email) DO NOTHING`,
        [userId, d.email, hash, d.first_name, d.last_name]
      );

      const { rows: userRows } = await client.query(
        'SELECT id FROM users WHERE email = $1', [d.email]
      );
      const uid = userRows[0].id;

      const { rows: docRows } = await client.query(
        `INSERT INTO doctors
           (user_id, specialty_id, license_number, bio, years_experience,
            medical_school, consult_type, consultation_fee, address,
            neighborhood, languages, insurances, latitude, longitude, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)
         ON CONFLICT (license_number) DO UPDATE SET bio = EXCLUDED.bio
         RETURNING id`,
        [uid, specMap[d.specialty_slug], d.license, d.bio,
         d.years_experience, d.medical_school, d.consult_type,
         d.consultation_fee, d.address, d.neighborhood,
         d.languages, d.insurances, d.latitude, d.longitude]
      );
      const docId = docRows[0].id;

      // Availability templates (Mon–Fri or as specified)
      for (const dow of d.days) {
        await client.query(
          `INSERT INTO availability_templates
             (doctor_id, day_of_week, start_time, end_time, slot_minutes, consult_type)
           VALUES ($1,$2,$3,$4,30,$5)
           ON CONFLICT (doctor_id, day_of_week, start_time) DO NOTHING`,
          [docId, dow, d.start, d.end, d.consult_type]
        );
      }
    }

    // Demo patient
    console.log('  → Creating demo patient...');
    await client.query(
      `INSERT INTO users
         (email, password_hash, role, first_name, last_name, phone, email_verified)
       VALUES ($1, $2, 'patient', 'Demo', 'Patient', '305-555-0100', TRUE)
       ON CONFLICT (email) DO NOTHING`,
      ['patient@miamed.com', hash]
    );
  });

  console.log('\n✅  Seed complete!');
  console.log('   Admin:   admin@miamed.com / Password123!');
  console.log('   Patient: patient@miamed.com / Password123!');
  console.log('   Doctors: [name]@miamed.com / Password123!');
  await pool.end();
}

seed().catch((err) => { console.error(err); process.exit(1); });
