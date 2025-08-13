const express = require('express');
const { submitAppeal } = require('../controllers/assignmentController');
const auth = require('../middleware/auth');
const { getAppeals, handleAppealDecision } = require('../controllers/headController');
const assignmentController = require('../controllers/assignmentController');
const headController = require('../controllers/headController');

const router = express.Router();

// ==================== EXISTING ROUTES (UNCHANGED) ====================
router.get('/head/appeals', getAppeals); 
router.patch('/:assignmentId/accept', auth('Admin'), assignmentController.acceptAssignment);
router.patch('/:assignmentId/reject', auth('Admin'), assignmentController.rejectAssignment);
router.patch('/:assignmentId/overturn', auth('Head'), headController.overturnDecision);
router.post('/head/appeals/:id/decision', auth('Head'), headController.handleAppealDecision);

// ==================== NEW DEADLINE MANAGEMENT ROUTES ====================

// Change assignment deadline (HEAD/HOD only)
router.put('/:assignmentId/change-deadline', auth('Head'), assignmentController.changeAssignmentDeadline);

// Get assignment deadline history (HEAD/HOD and Admin can view)
router.get('/:assignmentId/deadline-history', auth(['Head', 'Admin']), assignmentController.getAssignmentDeadlineHistory);

// Get upcoming deadlines (Admin and Head can view)
router.get('/deadlines/upcoming', auth(['Admin', 'Head']), assignmentController.getUpcomingDeadlines);

// ==================== ADDITIONAL ROUTES WITH PROPER AUTH ====================

// Submit appeal (Users only)
router.post('/:assignmentId/appeal', auth('User'), assignmentController.submitAppeal);

// Fetch feedbacks (Users can view their own, Admin/Head can view any)
router.get('/:id/feedback', auth(['User', 'Admin', 'Head']), assignmentController.fetchFeedbacks);

// Get all admin assignments (Admin and Head can view)
router.get('/admin/all', auth(['Admin', 'Head']), assignmentController.getAllAdminAssignments);

// Get admin assignments by label (Admin and Head can view)
router.get('/admin/label/:label', auth(['Admin', 'Head']), assignmentController.getAdminAssignmentsByLabel);

module.exports = router;