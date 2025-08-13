const express = require('express');
const passport = require('passport');

const router = express.Router();

// Google Login
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard'); 
    }
);

// GitHub Login
router.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

router.get(
    '/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

module.exports = router;
