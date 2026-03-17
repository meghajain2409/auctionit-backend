const db = require('../config/db');
const { generateOTP } = require('../utils/generateOTP');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateToken');

// ─── SEND OTP ─────────────────────────────────────────────────────────────────

const sendOTP = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required'
      });
    }

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Indian mobile number'
      });
    }

    // Check max attempts in last 10 minutes
    const recentAttempts = await db.query(
      `SELECT COUNT(*) FROM otps
       WHERE phone = $1
       AND created_at > NOW() - INTERVAL '10 minutes'`,
      [mobile]
    );

    if (parseInt(recentAttempts.rows[0].count) >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please wait 10 minutes.'
      });
    }

    // Check if user exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE phone = $1',
      [mobile]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mobile number not registered. Please contact admin.'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP
    await db.query(
      `INSERT INTO otps (phone, otp_code, expires_at)
       VALUES ($1, $2, $3)`,
      [mobile, otp, expiresAt]
    );

    // Log OTP
    console.log(`  📱 OTP for ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: `OTP sent to ${mobile}`,
      ...(process.env.NODE_ENV === 'development' && { otp })
    });

  } catch (err) {
    console.error('sendOTP error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
};

// ─── VERIFY OTP & LOGIN ───────────────────────────────────────────────────────

const verifyOTPAndLogin = async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Mobile and OTP are required'
      });
    }

    // Get latest valid OTP
    const otpResult = await db.query(
      `SELECT * FROM otps
       WHERE phone = $1
       AND otp_code = $2
       AND is_used = FALSE
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [mobile, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    await db.query(
      'UPDATE otps SET is_used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
    );

    // Get user
    const userResult = await db.query(
      `SELECT * FROM users WHERE phone = $1`,
      [mobile]
    );

    const user = userResult.rows[0];

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      mobile: user.phone
    });

    const refreshToken = generateRefreshToken();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          mobile: user.phone,
          email: user.email,
          name: user.name,
          role: user.role,
          kycStatus: user.kyc_status
        }
      }
    });

  } catch (err) {
    console.error('verifyOTPAndLogin error:', err);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// ─── GET ME ───────────────────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, phone, email, name, role, kyc_status, is_active, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get user info'
    });
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

const logout = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    console.error('logout error:', err);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

module.exports = {
  sendOTP,
  verifyOTPAndLogin,
  getMe,
  logout
};