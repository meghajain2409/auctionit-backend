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

    // Check if user exists
    const userResult = await db.query(
      `SELECT * FROM users WHERE phone = $1`,
      [mobile]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please register first.'
      });
    }

    // Mark OTP as used
    await db.query(
      'UPDATE otps SET is_used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
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

// ─── REGISTER BIDDER (FIXED - with transaction) ──────────────────────────────

const registerBidder = async (req, res) => {
  const client = await db.getClient(); // Get a dedicated client for transaction

  try {
    const { phone, email, name, company_name, city, state, otp } = req.body;

    console.log('📝 Registration attempt:', { phone, name, email, company_name, city, state, otp: otp ? '***' : 'missing' });

    if (!phone || !name || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone, name, and OTP are required'
      });
    }

    // Verify OTP first (before starting transaction)
    const otpResult = await client.query(
      `SELECT * FROM otps
       WHERE phone = $1
       AND otp_code = $2
       AND is_used = FALSE
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, otp]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE phone = $1',
      [phone]
    );

    if (existingUser.rows.length > 0) {
      // ── FIX: Check if bidder profile exists too ──
      // If user exists but bidder profile is missing (orphaned from a previous failed attempt),
      // clean up and let them re-register
      const existingBidder = await client.query(
        'SELECT id FROM bidders WHERE user_id = $1',
        [existingUser.rows[0].id]
      );

      if (existingBidder.rows.length > 0) {
        // Both user and bidder exist — genuinely already registered
        return res.status(400).json({
          success: false,
          message: 'Mobile number already registered. Please login.'
        });
      }

      // User exists but no bidder profile — delete orphaned user and re-register
      console.log('🧹 Cleaning up orphaned user record for:', phone);
      await client.query('DELETE FROM users WHERE id = $1', [existingUser.rows[0].id]);
    }

    // ── BEGIN TRANSACTION ──
    await client.query('BEGIN');

    // Mark OTP as used
    await client.query(
      'UPDATE otps SET is_used = TRUE WHERE id = $1',
      [otpResult.rows[0].id]
    );

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (phone, email, name, role, kyc_status, is_active)
       VALUES ($1, $2, $3, 'bidder', 'pending', true)
       RETURNING *`,
      [phone, email || null, name]
    );

    const user = userResult.rows[0];
    console.log('✅ User created:', user.id);

    // Generate unique bidder code (BID-XXXXXX)
    const bidderCode = 'BID-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

    // Create bidder profile
    await client.query(
      `INSERT INTO bidders (user_id, bidder_code, company_name, contact_person)
       VALUES ($1, $2, $3, $4)`,
      [user.id, bidderCode, company_name || null, name]
    );

    console.log('✅ Bidder profile created for user:', user.id);

    // ── COMMIT TRANSACTION ──
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please login.',
      data: {
        userId: user.id,
        phone: user.phone
      }
    });

  } catch (err) {
    // ── ROLLBACK on any error ──
    await client.query('ROLLBACK');
    console.error('❌ registerBidder error:', err.message);
    console.error('   Detail:', err.detail || 'none');
    console.error('   Table:', err.table || 'unknown');
    console.error('   Column:', err.column || 'unknown');
    console.error('   Constraint:', err.constraint || 'none');

    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: err.message })
    });
  } finally {
    client.release(); // Always release the client back to pool
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
  registerBidder,
  getMe,
  logout
};
