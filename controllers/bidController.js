const db = require('../config/db');

// ─── GET BID HISTORY FOR A LOT ───────────────────────────────────────────────
const getLotBids = async (req, res) => {
  try {
    const { lotId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT b.id, b.bid_amount, b.bid_time, b.is_winning,
        u.name AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1
       ORDER BY b.bid_amount DESC
       LIMIT $2 OFFSET $3`,
      [lotId, limit, offset]
    );

    const count = await db.query('SELECT COUNT(*) FROM bids WHERE lot_id = $1', [lotId]);

    res.json({ success: true, data: {
      bids: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page), limit: parseInt(limit),
        totalPages: Math.ceil(count.rows[0].count / limit)
      }
    }});
  } catch (err) {
    console.error('getLotBids error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get bids' });
  }
};

// ─── GET MY BIDS ─────────────────────────────────────────────────────────────
const getMyBids = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT b.id, b.bid_amount, b.bid_time, b.is_winning,
        al.lot_display_name, al.lot_number, al.status AS lot_status,
        al.current_highest_bid, al.winning_bidder_id,
        a.title AS auction_title, a.auction_number, a.status AS auction_status
       FROM bids b
       JOIN auction_lots al ON al.id = b.lot_id
       JOIN auctions a ON a.id = b.auction_id
       WHERE b.user_id = $1
       ORDER BY b.bid_time DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const count = await db.query('SELECT COUNT(*) FROM bids WHERE user_id = $1', [req.user.id]);

    res.json({ success: true, data: {
      bids: result.rows,
      pagination: {
        total: parseInt(count.rows[0].count),
        page: parseInt(page), limit: parseInt(limit),
        totalPages: Math.ceil(count.rows[0].count / limit)
      }
    }});
  } catch (err) {
    console.error('getMyBids error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get your bids' });
  }
};

// ─── GET MY WINS ─────────────────────────────────────────────────────────────
const getMyWins = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT al.id AS lot_id, al.lot_number, al.lot_display_name,
        al.winning_bid, al.won_at, al.status,
        a.id AS auction_id, a.auction_number, a.title AS auction_title, a.status AS auction_status
       FROM auction_lots al
       JOIN auctions a ON a.id = al.auction_id
       WHERE al.winning_bidder_id = $1
       ORDER BY al.won_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getMyWins error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get wins' });
  }
};

// ─── REGISTER FOR AUCTION (simplified - no auction_registrations table) ──────
const registerForAuction = async (req, res) => {
  try {
    // Since there's no auction_registrations table, just verify user can bid
    const { auctionId } = req.params;

    const auction = await db.query('SELECT * FROM auctions WHERE id = $1', [auctionId]);
    if (auction.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Auction not found' });

    if (!['published','live'].includes(auction.rows[0].status))
      return res.status(400).json({ success: false, message: 'Auction is not open' });

    res.json({ success: true, message: 'You can participate in this auction', data: { auctionId } });
  } catch (err) {
    console.error('registerForAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

module.exports = { getLotBids, getMyBids, getMyWins, registerForAuction };
