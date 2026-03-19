const db = require('../config/db');

// ─── GENERATE AUCTION NUMBER ─────────────────────────────────────────────────
const generateAuctionNumber = async () => {
  const result = await db.query('SELECT COUNT(*) FROM auctions');
  const count = parseInt(result.rows[0].count) + 1;
  return `AUC-${String(count).padStart(5, '0')}`;
};

// ─── CREATE AUCTION ──────────────────────────────────────────────────────────
const createAuction = async (req, res) => {
  try {
    const {
      title, description, clientId,
      startTime, endTime,
      autoExtendEnabled = true, extendByMinutes = 5,
      termsAndConditions, pickupDeadline
    } = req.body;

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'Title, start time and end time are required' });
    }

    if (new Date(startTime) >= new Date(endTime)) {
      return res.status(400).json({ success: false, message: 'End time must be after start time' });
    }

    const auctionNumber = await generateAuctionNumber();

    const result = await db.query(
      `INSERT INTO auctions (
        auction_number, title, description, client_id,
        start_time, end_time,
        auto_extend_enabled, extend_by_minutes,
        terms_and_conditions, pickup_deadline,
        created_by, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
      RETURNING *`,
      [
        auctionNumber, title, description || null, clientId || null,
        new Date(startTime), new Date(endTime),
        autoExtendEnabled, extendByMinutes,
        termsAndConditions || null, pickupDeadline || null,
        req.user.id
      ]
    );

    console.log('✅ Auction created:', result.rows[0].auction_number);
    res.status(201).json({ success: true, message: 'Auction created successfully', data: result.rows[0] });

  } catch (err) {
    console.error('createAuction error:', err.message, '| Detail:', err.detail || 'none');
    res.status(500).json({ success: false, message: 'Failed to create auction',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }) });
  }
};

// ─── GET ALL AUCTIONS ────────────────────────────────────────────────────────
const getAuctions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let p = 1;

    if (status) { conditions.push(`a.status = $${p++}`); params.push(status); }
    if (search) {
      conditions.push(`(a.title ILIKE $${p} OR a.auction_number ILIKE $${p})`);
      params.push(`%${search}%`); p++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*) FROM auctions a ${where}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await db.query(
      `SELECT a.id, a.auction_number, a.title, a.description,
        a.status, a.start_time, a.end_time, a.actual_end_time,
        a.auto_extend_enabled, a.extend_by_minutes,
        a.client_id, a.created_at,
        c.company_name AS client_name,
        COUNT(DISTINCT al.id) AS total_lots
       FROM auctions a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN auction_lots al ON al.auction_id = a.id
       ${where}
       GROUP BY a.id, c.company_name
       ORDER BY a.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      params
    );

    res.json({ success: true, data: { auctions: result.rows, pagination: {
      total: totalCount, page: parseInt(page), limit: parseInt(limit),
      totalPages: Math.ceil(totalCount / limit)
    }}});
  } catch (err) {
    console.error('getAuctions error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get auctions' });
  }
};

// ─── GET SINGLE AUCTION ──────────────────────────────────────────────────────
const getAuction = async (req, res) => {
  try {
    const { id } = req.params;

    const auctionResult = await db.query(
      `SELECT a.*, c.company_name AS client_name, u.name AS created_by_name
       FROM auctions a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE a.id = $1`, [id]
    );

    if (auctionResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }

    const lotsResult = await db.query(
      `SELECT al.*,
        COUNT(b.id) AS total_bids, MAX(b.bid_amount) AS highest_bid
       FROM auction_lots al
       LEFT JOIN bids b ON b.lot_id = al.id
       WHERE al.auction_id = $1
       GROUP BY al.id
       ORDER BY al.lot_number ASC`, [id]
    );

    const isAdmin = req.user && ['super_admin','account_manager'].includes(req.user.role);
    const lots = lotsResult.rows.map(lot => ({
      ...lot, reserve_price: isAdmin ? lot.reserve_price : undefined
    }));

    res.json({ success: true, data: { ...auctionResult.rows[0], lots } });
  } catch (err) {
    console.error('getAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get auction' });
  }
};

// ─── UPDATE AUCTION ──────────────────────────────────────────────────────────
const updateAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT * FROM auctions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (!['draft','published'].includes(existing.rows[0].status))
      return res.status(400).json({ success: false, message: 'Cannot edit live or completed auction' });

    const { title, description, startTime, endTime, clientId, autoExtendEnabled, extendByMinutes, termsAndConditions, pickupDeadline } = req.body;

    const result = await db.query(
      `UPDATE auctions SET
        title = COALESCE($1,title), description = COALESCE($2,description),
        start_time = COALESCE($3,start_time), end_time = COALESCE($4,end_time),
        client_id = COALESCE($5,client_id),
        auto_extend_enabled = COALESCE($6,auto_extend_enabled),
        extend_by_minutes = COALESCE($7,extend_by_minutes),
        terms_and_conditions = COALESCE($8,terms_and_conditions),
        pickup_deadline = COALESCE($9,pickup_deadline),
        updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [title, description, startTime ? new Date(startTime) : null, endTime ? new Date(endTime) : null,
       clientId, autoExtendEnabled, extendByMinutes, termsAndConditions, pickupDeadline, id]
    );

    res.json({ success: true, message: 'Auction updated', data: result.rows[0] });
  } catch (err) {
    console.error('updateAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update auction' });
  }
};

// ─── PUBLISH ─────────────────────────────────────────────────────────────────
const publishAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const auction = await db.query(
      `SELECT a.*, COUNT(al.id) AS lot_count FROM auctions a
       LEFT JOIN auction_lots al ON al.auction_id = a.id
       WHERE a.id = $1 GROUP BY a.id`, [id]
    );
    if (auction.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (auction.rows[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft auctions can be published' });
    if (parseInt(auction.rows[0].lot_count) === 0) return res.status(400).json({ success: false, message: 'Add at least one lot before publishing' });

    const result = await db.query(`UPDATE auctions SET status='published', updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
    res.json({ success: true, message: 'Auction published', data: result.rows[0] });
  } catch (err) {
    console.error('publishAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to publish' });
  }
};

// ─── GO LIVE ─────────────────────────────────────────────────────────────────
const goLive = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT * FROM auctions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (existing.rows[0].status !== 'published') return res.status(400).json({ success: false, message: 'Must be published first' });

    await db.query(`UPDATE auction_lots SET status='active', updated_at=NOW() WHERE auction_id=$1 AND status='draft'`, [id]);
    const result = await db.query(`UPDATE auctions SET status='live', updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);

    const io = req.app.get('io');
    if (io) io.emit('auction:live', { auctionId: id, title: existing.rows[0].title });

    res.json({ success: true, message: 'Auction is now LIVE!', data: result.rows[0] });
  } catch (err) {
    console.error('goLive error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to go live' });
  }
};

// ─── END AUCTION ─────────────────────────────────────────────────────────────
const endAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT * FROM auctions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (existing.rows[0].status !== 'live') return res.status(400).json({ success: false, message: 'Only live auctions can be ended' });

    await db.query(`UPDATE auction_lots SET status='unsold', updated_at=NOW() WHERE auction_id=$1 AND status='active' AND winning_bidder_id IS NULL`, [id]);
    await db.query(`UPDATE auction_lots SET status='sold', updated_at=NOW() WHERE auction_id=$1 AND status='active' AND winning_bidder_id IS NOT NULL`, [id]);
    const result = await db.query(`UPDATE auctions SET status='ended', actual_end_time=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);

    const io = req.app.get('io');
    if (io) io.to(`auction:${id}`).emit('auction:ended', { auctionId: id, message: 'Auction has ended!' });

    res.json({ success: true, message: 'Auction ended', data: result.rows[0] });
  } catch (err) {
    console.error('endAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to end auction' });
  }
};

// ─── CANCEL AUCTION ──────────────────────────────────────────────────────────
const cancelAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required' });

    const existing = await db.query('SELECT * FROM auctions WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (['ended','cancelled'].includes(existing.rows[0].status))
      return res.status(400).json({ success: false, message: 'Already ended or cancelled' });

    const result = await db.query(
      `UPDATE auctions SET status='cancelled', closure_reason=$1, actual_end_time=NOW(), updated_at=NOW()
       WHERE id=$2 RETURNING *`, [reason, id]
    );
    res.json({ success: true, message: 'Auction cancelled', data: result.rows[0] });
  } catch (err) {
    console.error('cancelAuction error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to cancel' });
  }
};

// ─── GET MY AUCTIONS ─────────────────────────────────────────────────────────
const getMyAuctions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, COUNT(DISTINCT al.id) AS total_lots
       FROM auctions a LEFT JOIN auction_lots al ON al.auction_id = a.id
       WHERE a.created_by = $1 GROUP BY a.id ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getMyAuctions error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get auctions' });
  }
};

module.exports = { createAuction, getAuctions, getAuction, updateAuction, publishAuction, goLive, endAuction, cancelAuction, getMyAuctions };
