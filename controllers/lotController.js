const db = require('../config/db');

// ─── ADD LOT ─────────────────────────────────────────────────────────────────
const addLot = async (req, res) => {
  try {
    const { auctionId } = req.params;
    console.log('📦 Add lot body:', JSON.stringify(req.body));
    
    const {
      lotDisplayName, title, description, materialId,
      quantity, unit = 'MT', qualityGrade, materialGrade,
      physicalLocation, location, reservePrice,
      startingBid, startPrice
    } = req.body;

    // Accept both new and old field names
    const name = lotDisplayName || title;
    const bid = startingBid || startPrice;
    const grade = qualityGrade || materialGrade;
    const loc = physicalLocation || location;

    console.log('📦 Parsed:', { name, bid, quantity, unit });

    if (!name || !bid || !quantity || !unit) {
      return res.status(400).json({ success: false, message: 'Lot name, starting bid, quantity and unit are required' });
    }

    // Check auction exists and is editable
    const auction = await db.query('SELECT * FROM auctions WHERE id = $1', [auctionId]);
    if (auction.rows.length === 0) return res.status(404).json({ success: false, message: 'Auction not found' });
    if (!['draft','published'].includes(auction.rows[0].status))
      return res.status(400).json({ success: false, message: 'Cannot add lots to live or ended auction' });

    // Auto-generate lot number
    const lotCount = await db.query('SELECT COUNT(*) FROM auction_lots WHERE auction_id = $1', [auctionId]);
    const lotNumber = `LOT-${String(parseInt(lotCount.rows[0].count) + 1).padStart(3, '0')}`;

    const result = await db.query(
      `INSERT INTO auction_lots (
        auction_id, lot_number, lot_display_name, description,
        material_id, quantity, unit, quality_grade,
        physical_location, reserve_price, starting_bid,
        current_highest_bid, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'draft')
      RETURNING *`,
      [
        auctionId, lotNumber, name, description || null,
        materialId || null, quantity, unit, grade || null,
        loc || null, reservePrice || null, bid
      ]
    );

    console.log('✅ Lot added:', lotNumber, 'to auction', auctionId);
    res.status(201).json({ success: true, message: 'Lot added', data: result.rows[0] });

  } catch (err) {
    console.error('addLot error:', err.message, '| Detail:', err.detail || 'none');
    res.status(500).json({ success: false, message: 'Failed to add lot',
      ...(process.env.NODE_ENV === 'development' && { error: err.message }) });
  }
};

// ─── GET LOTS FOR AUCTION ────────────────────────────────────────────────────
const getLots = async (req, res) => {
  try {
    const { auctionId } = req.params;
    const isAdmin = req.user && ['super_admin','account_manager'].includes(req.user.role);

    const result = await db.query(
      `SELECT al.*,
        COUNT(b.id) AS total_bids,
        MAX(b.bid_amount) AS highest_bid
       FROM auction_lots al
       LEFT JOIN bids b ON b.lot_id = al.id
       WHERE al.auction_id = $1
       GROUP BY al.id
       ORDER BY al.lot_number ASC`,
      [auctionId]
    );

    const lots = result.rows.map(lot => ({
      ...lot,
      reserve_price: isAdmin ? lot.reserve_price : undefined
    }));

    res.json({ success: true, data: lots });
  } catch (err) {
    console.error('getLots error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get lots' });
  }
};

// ─── GET SINGLE LOT ──────────────────────────────────────────────────────────
const getLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;
    const isAdmin = req.user && ['super_admin','account_manager'].includes(req.user.role);

    const result = await db.query(
      `SELECT al.*,
        COUNT(b.id) AS total_bids, MAX(b.bid_amount) AS highest_bid
       FROM auction_lots al
       LEFT JOIN bids b ON b.lot_id = al.id
       WHERE al.id = $1 AND al.auction_id = $2
       GROUP BY al.id`,
      [lotId, auctionId]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Lot not found' });

    const lot = { ...result.rows[0], reserve_price: isAdmin ? result.rows[0].reserve_price : undefined };

    // Recent bids
    const bids = await db.query(
      `SELECT b.id, b.bid_amount, b.bid_time, b.is_winning, u.name AS bidder_name
       FROM bids b JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1 ORDER BY b.bid_amount DESC LIMIT 20`,
      [lotId]
    );

    res.json({ success: true, data: { ...lot, recentBids: bids.rows } });
  } catch (err) {
    console.error('getLot error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get lot' });
  }
};

// ─── UPDATE LOT ──────────────────────────────────────────────────────────────
const updateLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;
    const existing = await db.query('SELECT * FROM auction_lots WHERE id = $1 AND auction_id = $2', [lotId, auctionId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Lot not found' });
    if (!['draft','active'].includes(existing.rows[0].status))
      return res.status(400).json({ success: false, message: 'Cannot edit sold or withdrawn lot' });

    const { lotDisplayName, description, materialId, quantity, unit, qualityGrade, physicalLocation, reservePrice, startingBid } = req.body;

    const result = await db.query(
      `UPDATE auction_lots SET
        lot_display_name = COALESCE($1, lot_display_name),
        description = COALESCE($2, description),
        material_id = COALESCE($3, material_id),
        quantity = COALESCE($4, quantity),
        unit = COALESCE($5, unit),
        quality_grade = COALESCE($6, quality_grade),
        physical_location = COALESCE($7, physical_location),
        reserve_price = COALESCE($8, reserve_price),
        starting_bid = COALESCE($9, starting_bid),
        updated_at = NOW()
       WHERE id = $10 AND auction_id = $11 RETURNING *`,
      [lotDisplayName, description, materialId, quantity, unit, qualityGrade, physicalLocation, reservePrice, startingBid, lotId, auctionId]
    );

    res.json({ success: true, message: 'Lot updated', data: result.rows[0] });
  } catch (err) {
    console.error('updateLot error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update lot' });
  }
};

// ─── DELETE LOT ──────────────────────────────────────────────────────────────
const deleteLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;
    const existing = await db.query('SELECT * FROM auction_lots WHERE id = $1 AND auction_id = $2', [lotId, auctionId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Lot not found' });
    if (existing.rows[0].status === 'active')
      return res.status(400).json({ success: false, message: 'Cannot delete active lot' });

    await db.query('DELETE FROM auction_lots WHERE id = $1 AND auction_id = $2', [lotId, auctionId]);
    res.json({ success: true, message: 'Lot deleted' });
  } catch (err) {
    console.error('deleteLot error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete lot' });
  }
};

// ─── DECLARE WINNER ──────────────────────────────────────────────────────────
const declareWinner = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;

    const lot = await db.query(
      `SELECT al.*, a.status AS auction_status
       FROM auction_lots al JOIN auctions a ON a.id = al.auction_id
       WHERE al.id = $1 AND al.auction_id = $2`, [lotId, auctionId]
    );
    if (lot.rows.length === 0) return res.status(404).json({ success: false, message: 'Lot not found' });

    const highestBid = await db.query(
      `SELECT b.*, u.name AS bidder_name, u.phone AS bidder_phone
       FROM bids b JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1 ORDER BY b.bid_amount DESC LIMIT 1`, [lotId]
    );
    if (highestBid.rows.length === 0)
      return res.status(400).json({ success: false, message: 'No bids on this lot' });

    const winner = highestBid.rows[0];

    await db.query(
      `UPDATE auction_lots SET
        status = 'sold', winning_bidder_id = $1,
        winning_bid = $2, won_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [winner.user_id, winner.bid_amount, lotId]
    );

    res.json({ success: true, message: 'Winner declared', data: {
      lotId, winner: { name: winner.bidder_name, phone: winner.bidder_phone, amount: winner.bid_amount }
    }});
  } catch (err) {
    console.error('declareWinner error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to declare winner' });
  }
};

module.exports = { addLot, getLots, getLot, updateLot, deleteLot, declareWinner };
