const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const assignmentController = require('../controllers/assignmentController');
const upload = require('../middleware/upload');
const auth = require('../middleware/auth');

// Authentication routes
router.post('/register', userController.register);
router.post('/login', userController.login);

// Password Reset Routes
router.post('/forgot-password', userController.sendResetOTP);
router.post('/verify-otp', userController.verifyResetOTP);
router.post('/reset-password', userController.resetPassword);

// Profile Management Routes - FIXED: Use 'User' to match JWT token
router.get('/profile', auth('User'), userController.getUserProfile);
router.put('/profile', auth('User'), userController.updateUserProfile);
router.post('/change-password', auth('User'), userController.changePassword);

// Label Management Routes - FIXED: Use 'User' to match JWT token
router.post('/labels/add', auth('User'), userController.addLabel);
router.delete('/labels/remove', auth('User'), userController.removeLabel);

// Assignment upload (keep as original since it's working)
router.post(
    '/upload',
    (req, res, next) => {
        console.log('Auth Middleware Start');
        next();
    },
    auth('User'), // Use 'User' to match JWT token
    (req, res, next) => {
        console.log('Auth Middleware Passed');
        next();
    },
    upload.single('taskFile'),
    (err, req, res, next) => {
        if (err) {
            console.error('Multer Error:', err.message);
            return res.status(400).json({ message: err.message });
        }
        next();
    },
    userController.uploadAssignment
);

// Test response upload (keep as original since it's working)
router.post(
    '/upload-test',
    (req, res, next) => {
        console.log('Test Upload Auth Middleware Start');
        next();
    },
    auth('User'), // Use 'User' to match JWT token
    (req, res, next) => {
        console.log('Test Upload Auth Middleware Passed');
        next();
    },
    upload.single('taskFile'),
    (err, req, res, next) => {
        if (err) {
            console.error('Multer Error:', err.message);
            return res.status(400).json({ message: err.message });
        }
        next();
    },
    userController.uploadTestResponse
);

// Content access routes (keep as original since they're working)
router.get('/content/:type', auth('User'), userController.getStudentContentByType);

// User submissions by type (keep as original since they're working)
router.get('/submissions/:type', auth('User'), userController.getUserSubmissionsByType);

// Existing routes (keep as original since they're working)
router.get('/admins', userController.getAllAdmins);
router.get('/submissions', auth('User'), userController.getUserSubmissions);
router.get('/admin-assignments', auth('User'), userController.fetchAssignmentsByLabel);
router.post('/:assignmentId/appeal', (req, res, next) => {
    console.log('route passed');
    next();
}, assignmentController.submitAppeal);
router.get('/debug/labels', auth('User'), userController.debugLabels);

router.get('/assignments/:id/download', auth(''), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Find the assignment
        const assignment = await Assignment.findById(id);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Check if user has permission to download (optional security)
        if (assignment.userId.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Extract filename from the title or use a default
        const fileName = `${assignment.title.replace(/[^a-zA-Z0-9.-]/g, '_')}.pdf`;
        
        // Set headers to force download
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        
        // Redirect to the Cloudinary URL
        res.redirect(assignment.filePath);
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ message: 'Download failed' });
    }
});

module.exports = router;