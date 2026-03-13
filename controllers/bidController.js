const db = require('../config/db');

// ─── GET BID HISTORY FOR A LOT ────────────────────────────────────────────────

const getLotBids = async (req, res) => {
  try {
    const { lotId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT
        b.id, b.amount, b.created_at, b.is_winning, b.bid_source,
        u.full_name AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1
       ORDER BY b.amount DESC
       LIMIT $2 OFFSET $3`,
      [lotId, limit, offset]
    );

    const count = await db.query(
      'SELECT COUNT(*) FROM bids WHERE lot_id = $1',
      [lotId]
    );

    res.json({
      success: true,
      data: {
        bids: result.rows,
        pagination: {
          total: parseInt(count.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count.rows[0].count / limit)
        }
      }
    });

  } catch (err) {
    console.error('getLotBids error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get bids'
    });
  }
};

// ─── GET MY BIDS ──────────────────────────────────────────────────────────────

const getMyBids = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT
        b.id, b.amount, b.created_at, b.is_winning,
        l.title AS lot_title, l.lot_number, l.status AS lot_status,
        l.current_price, l.winner_user_id,
        a.title AS auction_title, a.auction_number, a.status AS auction_status
       FROM bids b
       JOIN lots l ON l.id = b.lot_id
       JOIN auctions a ON a.id = b.auction_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const count = await db.query(
      'SELECT COUNT(*) FROM bids WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        bids: result.rows,
        pagination: {
          total: parseInt(count.rows[0].count),
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count.rows[0].count / limit)
        }
      }
    });

  } catch (err) {
    console.error('getMyBids error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get your bids'
    });
  }
};

// ─── GET MY WINS ──────────────────────────────────────────────────────────────

const getMyWins = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        l.id AS lot_id, l.lot_number, l.title AS lot_title,
        l.winning_amount, l.awarded_at, l.status,
        a.id AS auction_id, a.auction_number, a.title AS auction_title,
        a.status AS auction_status,
        sp.company_name AS seller_company
       FROM lots l
       JOIN auctions a ON a.id = l.auction_id
       LEFT JOIN seller_profiles sp ON sp.user_id = a.seller_id
       WHERE l.winner_user_id = $1
       ORDER BY l.awarded_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error('getMyWins error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get your wins'
    });
  }
};

// ─── REGISTER FOR AUCTION ─────────────────────────────────────────────────────

const registerForAuction = async (req, res) => {
  const client = await db.getClient();
  try {
    const { auctionId } = req.params;

    // Check auction exists and is open for registration
    const auction = await client.query(
      'SELECT * FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auction.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    const auctionData = auction.rows[0];

    if (!['published', 'emd_collection'].includes(auctionData.status)) {
      return res.status(400).json({
        success: false,
        message: 'Auction is not open for registration'
      });
    }

    // Check bidder KYC is approved
    const profile = await client.query(
      'SELECT kyc_status FROM bidder_profiles WHERE user_id = $1',
      [req.user.id]
    );

    if (profile.rows.length === 0 || profile.rows[0].kyc_status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your KYC must be approved before registering for auctions'
      });
    }

    // Check not already registered
    const existing = await client.query(
      'SELECT id FROM auction_registrations WHERE auction_id = $1 AND user_id = $2',
      [auctionId, req.user.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already registered for this auction'
      });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO auction_registrations
       (auction_id, user_id, emd_amount, status)
       VALUES ($1, $2, $3, 'pending_payment')
       RETURNING *`,
      [auctionId, req.user.id, auctionData.emd_amount]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Registered successfully. Please pay EMD to activate your registration.',
      data: {
        registration: result.rows[0],
        emdAmount: auctionData.emd_amount,
        nextStep: 'Pay EMD to complete registration'
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('registerForAuction error:', err);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getLotBids,
  getMyBids,
  getMyWins,
  registerForAuction
};