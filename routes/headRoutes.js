const express = require('express');
const {
    registerHead,
    hodLogin,
    approveLogin,
    getRecentAssignments,
    getAllAssignments,
    addHeadFeedback,
    acceptAssignment,
    rejectAssignment,
    overturnDecision,
    getAppeals,
    handleAppealDecision,
    getAllAdminAssignments,
    getAllNotes,
    getAllLectures,
    getAllTests,
    getAllContent
} = require('../controllers/headController');

const adminController = require('../controllers/adminController');

const auth = require('../middleware/auth');

const router = express.Router();

// Public routes
router.post('/register', registerHead);
router.post('/login', hodLogin);
router.get('/approve-login/:token', approveLogin);

// Protected routes - Assignments
router.get('/assignments/recent', auth(), getRecentAssignments); 
router.get('/assignments', auth(), (req, res, next) => {
    console.log('Route Passed - Authenticated User:', req.user);
    next();
}, getAllAssignments); 

// Assignment management routes
router.put('/feedback/:id', auth(), (req, res, next) => {
    console.log('🔍 HEAD FEEDBACK ROUTE - User:', req.user);
    console.log('🔍 HEAD FEEDBACK ROUTE - Assignment ID:', req.params.id);
    console.log('🔍 HEAD FEEDBACK ROUTE - Body:', req.body);
    next();
}, adminController.provideFeedback);

router.put('/feedback/head/:id', auth(), addHeadFeedback);
router.post('/assignments/:id/accept', auth(), acceptAssignment); 
router.post('/assignments/:id/reject', auth(), rejectAssignment); 
router.post('/assignments/:id/overturn', auth(), overturnDecision); 
router.post('/assignments/:id/appeal-decision', auth(), handleAppealDecision);
router.get('/assignments/appeals', auth(), getAppeals);
router.get('/admin-assignments/all', auth(), getAllAdminAssignments);

// Content fetching routes - HEAD access to all labels
router.get('/content/notes', auth(), getAllNotes);
router.get('/content/lectures', auth(), getAllLectures);  
router.get('/content/tests', auth(), getAllTests);
router.get('/content/:type', auth(), getAllContent); 

module.exports = router;