const db = require('../config/db');

// ─── GET ALL BIDDERS ──────────────────────────────────────────────────────────

const getAllBidders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE u.role = 'bidder'";
    const params = [];

    if (status) {
      params.push(status);
      whereClause += ` AND bp.kyc_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (u.full_name ILIKE $${params.length} OR u.mobile ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    params.push(limit);
    params.push(offset);

    const result = await db.query(
      `SELECT
        u.id, u.full_name, u.mobile, u.email, u.account_status,
        u.created_at,
        bp.kyc_status, bp.company_name, bp.pan_number,
        bp.city, bp.state, bp.kyc_reviewed_at,
        bp.kyc_rejection_reason,
        COUNT(b.id) AS total_bids
       FROM users u
       LEFT JOIN bidder_profiles bp ON bp.user_id = u.id
       LEFT JOIN bids b ON b.user_id = u.id
       ${whereClause}
       GROUP BY u.id, bp.id
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countResult = await db.query(
      `SELECT COUNT(*)
       FROM users u
       LEFT JOIN bidder_profiles bp ON bp.user_id = u.id
       ${whereClause}`,
      countParams
    );

    res.json({
      success: true,
      data: {
        bidders: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(countResult.rows[0].count / limit)
        }
      }
    });

  } catch (err) {
    console.error('getAllBidders error:', err);
    res.status(500).json({ success: false, message: 'Failed to get bidders' });
  }
};

// ─── GET SINGLE BIDDER ────────────────────────────────────────────────────────

const getBidder = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT
        u.id, u.full_name, u.mobile, u.email, u.account_status, u.created_at,
        bp.*
       FROM users u
       LEFT JOIN bidder_profiles bp ON bp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'bidder'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bidder not found' });
    }

    const bids = await db.query(
      `SELECT b.*, l.title AS lot_title, a.title AS auction_title
       FROM bids b
       JOIN lots l ON l.id = b.lot_id
       JOIN auctions a ON a.id = b.auction_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        recentBids: bids.rows
      }
    });

  } catch (err) {
    console.error('getBidder error:', err);
    res.status(500).json({ success: false, message: 'Failed to get bidder' });
  }
};

// ─── APPROVE KYC ─────────────────────────────────────────────────────────────

const approveKyc = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE bidder_profiles SET
        kyc_status = 'approved',
        kyc_reviewed_at = NOW(),
        kyc_rejection_reason = NULL,
        updated_at = NOW()
       WHERE user_id = $1`,
      [id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'kyc.approved', 'user', $3, 'KYC approved by admin')`,
      [req.user.id, req.user.role, id]
    );

    res.json({ success: true, message: 'KYC approved successfully' });

  } catch (err) {
    console.error('approveKyc error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve KYC' });
  }
};

// ─── REJECT KYC ──────────────────────────────────────────────────────────────

const rejectKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    await db.query(
      `UPDATE bidder_profiles SET
        kyc_status = 'rejected',
        kyc_reviewed_at = NOW(),
        kyc_rejection_reason = $1,
        updated_at = NOW()
       WHERE user_id = $2`,
      [reason, id]
    );

    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description)
       VALUES ($1, $2, 'kyc.rejected', 'user', $3, $4)`,
      [req.user.id, req.user.role, id, `KYC rejected: ${reason}`]
    );

    res.json({ success: true, message: 'KYC rejected' });

  } catch (err) {
    console.error('rejectKyc error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject KYC' });
  }
};

// ─── SUSPEND / ACTIVATE ACCOUNT ───────────────────────────────────────────────

const updateAccountStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    await db.query(
      'UPDATE users SET account_status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );

    res.json({
      success: true,
      message: `Account ${status === 'active' ? 'activated' : 'suspended'} successfully`
    });

  } catch (err) {
    console.error('updateAccountStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update account status' });
  }
};

module.exports = {
  getAllBidders,
  getBidder,
  approveKyc,
  rejectKyc,
  updateAccountStatus
};