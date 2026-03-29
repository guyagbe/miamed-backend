const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/errors');

const auth        = require('../controllers/authController');
const doctors     = require('../controllers/doctorsController');
const appts       = require('../controllers/appointmentsController');
const reviews     = require('../controllers/reviewsController');
const misc        = require('../controllers/miscController');

const router = Router();

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────
router.post('/auth/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
  validate,
  auth.register
);

router.post('/auth/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  auth.login
);

router.post('/auth/refresh',
  body('refresh_token').notEmpty(),
  validate,
  auth.refresh
);

router.post('/auth/logout', authenticate, auth.logout);
router.get('/auth/me',      authenticate, auth.me);

// ─────────────────────────────────────────────────────────
// SPECIALTIES  (public)
// ─────────────────────────────────────────────────────────
router.get('/specialties', misc.listSpecialties);

// ─────────────────────────────────────────────────────────
// DOCTORS  (public search + profile)
// ─────────────────────────────────────────────────────────
router.get('/doctors',           doctors.search);
router.get('/doctors/:id',       param('id').isUUID(), validate, doctors.getOne);
router.get('/doctors/:id/availability',
  param('id').isUUID(),
  query('date').isDate().withMessage('date must be YYYY-MM-DD'),
  validate,
  doctors.getAvailability
);
router.get('/doctors/:id/reviews', param('id').isUUID(), validate, doctors.getReviews);

// Doctor self-update
router.put('/doctors/:id',
  authenticate,
  requireRole('doctor'),
  param('id').isUUID(),
  validate,
  doctors.updateProfile
);

// ─────────────────────────────────────────────────────────
// APPOINTMENTS
// ─────────────────────────────────────────────────────────
router.post('/appointments',
  authenticate,
  requireRole('patient'),
  body('doctor_id').isUUID(),
  body('date').isDate().withMessage('date must be YYYY-MM-DD'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('time must be HH:MM'),
  body('consult_type').optional().isIn(['in_person', 'teleconsult']),
  validate,
  appts.book
);

router.get('/appointments',      authenticate, appts.list);
router.get('/appointments/:id',  authenticate, param('id').isUUID(), validate, appts.getOne);

router.patch('/appointments/:id/cancel',
  authenticate,
  param('id').isUUID(),
  validate,
  appts.cancel
);

router.patch('/appointments/:id/complete',
  authenticate,
  requireRole('doctor', 'admin'),
  param('id').isUUID(),
  validate,
  appts.complete
);

// ─────────────────────────────────────────────────────────
// REVIEWS
// ─────────────────────────────────────────────────────────
router.post('/reviews',
  authenticate,
  requireRole('patient'),
  body('appointment_id').isUUID(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isLength({ max: 1000 }),
  validate,
  reviews.create
);

router.get('/reviews/me', authenticate, requireRole('patient'), reviews.myReviews);

// ─────────────────────────────────────────────────────────
// USER PROFILE
// ─────────────────────────────────────────────────────────
router.get('/users/me',    authenticate, misc.getProfile);
router.patch('/users/me',  authenticate, misc.updateProfile);

// ─────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────
router.get('/admin/users',
  authenticate, requireRole('admin'), misc.adminListUsers);

router.patch('/admin/doctors/:id/verify',
  authenticate, requireRole('admin'),
  param('id').isUUID(), validate,
  misc.adminVerifyDoctor
);

module.exports = router;
