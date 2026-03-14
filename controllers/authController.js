const db = require('../config/db');
const { generateOTP, hashOTP, verifyOTP } = require('../utils/generateOTP');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateToken');
const bcrypt = require('bcryptjs');

// ─── SEND OTP ─────────────────────────────────────────────────────────────────

const sendOTP = async (req, res) => {
  try {
    const { mobile, purpose = 'login' } = req.body;

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
      `SELECT COUNT(*) FROM otp_sessions
       WHERE mobile = $1
       AND created_at > NOW() - INTERVAL '10 minutes'`,
      [mobile]
    );

    if (parseInt(recentAttempts.rows[0].count) >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please wait 10 minutes.'
      });
    }

    // For registration — check if user exists
    if (purpose === 'register') {
      const existingUser = await db.query(
        'SELECT id FROM users WHERE mobile = $1 AND deleted_at IS NULL',
        [mobile]
      );
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number already registered. Please login.'
        });
      }
    }

    // For login — check if user exists
    if (purpose === 'login') {
      const existingUser = await db.query(
        'SELECT id FROM users WHERE mobile = $1 AND deleted_at IS NULL',
        [mobile]
      );
      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Mobile number not registered. Please register first.'
        });
      }
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP session
    await db.query(
      `INSERT INTO otp_sessions (mobile, otp_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [mobile, otpHash, purpose, expiresAt]
    );

    // TODO: Send OTP via MSG91 (will integrate in Phase 6)
    // For now log to console in development
    console.log(`  📱 OTP for ${mobile}: ${otp}`);

    res.json({
      success: true,
      message: `OTP sent to ${mobile}`,
      // Only return OTP in development for testing
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

    // Get latest valid OTP session
    const sessionResult = await db.query(
      `SELECT * FROM otp_sessions
       WHERE mobile = $1
       AND purpose = 'login'
       AND verified = FALSE
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [mobile]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request a new OTP.'
      });
    }

    const session = sessionResult.rows[0];

    // Check max attempts
    if (session.attempts >= 5) {
      return res.status(400).json({
        success: false,
        message: 'Too many wrong attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    const isValid = await verifyOTP(otp, session.otp_hash);

    if (!isValid) {
      // Increment attempts
      await db.query(
        'UPDATE otp_sessions SET attempts = attempts + 1 WHERE id = $1',
        [session.id]
      );
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Mark OTP as verified
    await db.query(
      'UPDATE otp_sessions SET verified = TRUE WHERE id = $1',
      [session.id]
    );

    // Get user
    const userResult = await db.query(
      `SELECT u.*, bp.kyc_status, bp.emd_wallet_balance
       FROM users u
       LEFT JOIN bidder_profiles bp ON bp.user_id = u.id
       WHERE u.mobile = $1 AND u.deleted_at IS NULL`,
      [mobile]
    );

    const user = userResult.rows[0];

    // Update last login
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      mobile: user.mobile
    });

    const refreshToken = generateRefreshToken();
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Save refresh token
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        refreshHash,
        req.headers['user-agent'],
        req.ip,
        refreshExpiry
      ]
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          mobile: user.mobile,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          kycStatus: user.kyc_status || null,
          emdWalletBalance: user.emd_wallet_balance || 0
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

// ─── REGISTER BIDDER ──────────────────────────────────────────────────────────

const registerBidder = async (req, res) => {
  const client = await db.getClient();
  try {
    const { mobile, otp, fullName, email } = req.body;

    if (!mobile || !otp || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Mobile, OTP and full name are required'
      });
    }

    // Verify OTP
    const sessionResult = await client.query(
      `SELECT * FROM otp_sessions
       WHERE mobile = $1
       AND purpose = 'register'
       AND verified = FALSE
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [mobile]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found'
      });
    }

    const session = sessionResult.rows[0];
    const isValid = await verifyOTP(otp, session.otp_hash);

    if (!isValid) {
      await client.query(
        'UPDATE otp_sessions SET attempts = attempts + 1 WHERE id = $1',
        [session.id]
      );
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Create user
    const userResult = await client.query(
      `INSERT INTO users (mobile, email, full_name, role, account_status)
       VALUES ($1, $2, $3, 'bidder', 'active')
       RETURNING *`,
      [mobile, email || null, fullName]
    );

    const user = userResult.rows[0];

    // Create bidder profile
    await client.query(
      `INSERT INTO bidder_profiles (user_id, kyc_status)
       VALUES ($1, 'pending')`,
      [user.id]
    );

    // Create notification preferences
    await client.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)`,
      [user.id]
    );

    // Mark OTP verified
    await client.query(
      'UPDATE otp_sessions SET verified = TRUE WHERE id = $1',
      [session.id]
    );

    await client.query('COMMIT');

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      mobile: user.mobile
    });

    const refreshToken = generateRefreshToken();
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshHash, req.headers['user-agent'], req.ip, refreshExpiry]
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please complete your KYC.',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          mobile: user.mobile,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          kycStatus: 'pending'
        }
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('registerBidder error:', err);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  } finally {
    client.release();
  }
};

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────

const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Find matching token
    const tokens = await db.query(
      `SELECT rt.*, u.id as user_id, u.role, u.mobile, u.account_status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.expires_at > NOW()
       AND rt.revoked_at IS NULL`,
    );

    let matchedToken = null;
    for (const token of tokens.rows) {
      const isMatch = await bcrypt.compare(refreshToken, token.token_hash);
      if (isMatch) {
        matchedToken = token;
        break;
      }
    }

    if (!matchedToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    if (matchedToken.account_status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is suspended'
      });
    }

    // Revoke old token
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [matchedToken.id]
    );

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      userId: matchedToken.user_id,
      role: matchedToken.role,
      mobile: matchedToken.mobile
    });

    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = await bcrypt.hash(newRefreshToken, 10);
    const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [matchedToken.user_id, newRefreshHash, req.headers['user-agent'], req.ip, refreshExpiry]
    );

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (err) {
    console.error('refreshToken error:', err);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokens = await db.query(
        `SELECT * FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.user.id]
      );

      for (const token of tokens.rows) {
        const isMatch = await bcrypt.compare(refreshToken, token.token_hash);
        if (isMatch) {
          await db.query(
            'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
            [token.id]
          );
          break;
        }
      }
    }

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

// ─── GET ME ───────────────────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.mobile, u.email, u.full_name, u.role,
              u.account_status, u.last_login_at, u.created_at,
              bp.kyc_status, bp.emd_wallet_balance,
              bp.company_name, bp.city, bp.state
       FROM users u
       LEFT JOIN bidder_profiles bp ON bp.user_id = u.id
       WHERE u.id = $1`,
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

module.exports = {
  sendOTP,
  verifyOTPAndLogin,
  registerBidder,
  refreshToken,
  logout,
  getMe
};