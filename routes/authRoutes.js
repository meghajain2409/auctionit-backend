const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTPAndLogin);
router.post('/register', authController.registerBidder);

// Protected routes
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);

module.exports = router;