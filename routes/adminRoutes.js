const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const upload = require('../middleware/upload');
const assignmentController = require('../controllers/assignmentController');
const auth = require('../middleware/auth');

// Authentication routes
router.post('/register', adminController.register);
router.post('/login', adminController.login);

// ====================
// PROFILE MANAGEMENT ROUTES
// ====================

// Get admin profile
// Make sure this exact line exists:
router.get('/profile', auth('Admin'), adminController.getAdminProfile);

// Update admin profile
router.put('/profile/update', auth('Admin'), adminController.updateAdminProfile);

// Change admin password
router.put('/profile/change-password', auth('Admin'), adminController.changeAdminPassword);

// Password reset routes for admin
router.post('/password/send-otp', adminController.sendAdminResetOTP);
router.post('/password/verify-otp', adminController.verifyAdminResetOTP);
router.post('/password/reset', adminController.resetAdminPassword);

// ====================
// EXISTING ROUTES
// ====================

// ✅ Add auth middleware to GET feedback route
router.get('/feedback/:id', auth('Admin'), assignmentController.fetchFeedbacks);

// Student assignments submitted to admin
router.get('/assignments', auth('Admin'), adminController.getAdminAssignmentsByName);
router.post('/assignments/:id/accept', auth('Admin'), adminController.acceptAssignment);
router.post('/assignments/:id/reject', auth('Admin'), adminController.rejectAssignment);

// Admin content uploads (assignments, notes, lectures, tests)
router.post('/assignments/upload', auth('Admin'), adminController.uploadAssignmentForLabel);
router.post('/notes/upload', auth('Admin'), upload.single('file'), adminController.uploadNotesForLabel);
router.post('/lectures/upload', auth('Admin'), upload.single('file'), adminController.uploadLectureForLabel);
router.post('/tests/upload', auth('Admin'), adminController.uploadTestForLabel);

// Get admin content by type
router.get('/content/:type', auth('Admin'), adminController.getAdminContentByType);

// ✅ Make sure these routes are properly formatted
router.put('/feedback/admin/:id', auth('Admin'), adminController.provideFeedback);
router.put('/feedback/head/:id', auth('HOD'), adminController.provideFeedback);

// Deadline reminder system routes
router.get('/test-reminder', auth('Admin'), adminController.manualReminderTrigger);
router.post('/reset-warning-flags', auth('Admin'), adminController.resetWarningFlags);
router.get('/upcoming-deadlines', auth('Admin'), adminController.getUpcomingDeadlines);

module.exports = router;