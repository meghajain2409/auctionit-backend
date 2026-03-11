const express = require('express');
const router = express.Router();
const {
  sendOTP,
  verifyOTPAndLogin,
  registerBidder,
  refreshToken,
  logout,
  getMe
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/send-otp',  sendOTP);
router.post('/verify-otp', verifyOTPAndLogin);
router.post('/register',  registerBidder);
router.post('/refresh',   refreshToken);
router.post('/logout',    protect, logout);
router.get('/me',         protect, getMe);

module.exports = router;