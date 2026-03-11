const db = require('../config/db');

// ─── ADD LOT TO AUCTION ───────────────────────────────────────────────────────

const addLot = async (req, res) => {
  try {
    const { auctionId } = req.params;
    const {
      title,
      description,
      categoryId,
      materialGrade,
      quantity,
      unit,
      estimatedWeightMt,
      reservePrice,
      startPrice,
      priceUnit = 'per MT',
      minIncrement = 100,
      location,
      inspectionDate
    } = req.body;

    if (!title || !startPrice) {
      return res.status(400).json({
        success: false,
        message: 'Title and start price are required'
      });
    }

    // Check auction exists and is in draft/published status
    const auction = await db.query(
      'SELECT * FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auction.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (!['draft', 'published'].includes(auction.rows[0].status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add lots to a live or completed auction'
      });
    }

    // Auto generate lot number
    const lotCount = await db.query(
      'SELECT COUNT(*) FROM lots WHERE auction_id = $1',
      [auctionId]
    );

    const lotNumber = `LOT-${String(parseInt(lotCount.rows[0].count) + 1).padStart(3, '0')}`;

    const result = await db.query(
      `INSERT INTO lots (
        auction_id, lot_number, title, description,
        category_id, material_grade, quantity, unit,
        estimated_weight_mt, reserve_price, start_price,
        current_price, price_unit, min_increment,
        location, inspection_date, sort_order
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $11, $12, $13, $14, $15,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lots WHERE auction_id = $1)
      ) RETURNING *`,
      [
        auctionId, lotNumber, title, description,
        categoryId, materialGrade, quantity, unit,
        estimatedWeightMt, reservePrice, startPrice,
        priceUnit, minIncrement, location, inspectionDate
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Lot added successfully',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('addLot error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to add lot'
    });
  }
};

// ─── GET LOTS FOR AUCTION ─────────────────────────────────────────────────────

const getLots = async (req, res) => {
  try {
    const { auctionId } = req.params;

    const isAdmin = req.user &&
      ['super_admin', 'auction_manager'].includes(req.user.role);

    const result = await db.query(
      `SELECT
        l.*,
        mc.name AS category_name,
        COUNT(DISTINCT b.id) AS total_bids,
        MAX(b.amount) AS highest_bid,
        COALESCE(
          json_agg(
            json_build_object('url', li.url, 'sort_order', li.sort_order)
            ORDER BY li.sort_order
          ) FILTER (WHERE li.url IS NOT NULL),
          '[]'
        ) AS images
       FROM lots l
       LEFT JOIN material_categories mc ON mc.id = l.category_id
       LEFT JOIN bids b ON b.lot_id = l.id
       LEFT JOIN lot_images li ON li.lot_id = l.id
       WHERE l.auction_id = $1
       GROUP BY l.id, mc.name
       ORDER BY l.sort_order ASC`,
      [auctionId]
    );

    const lots = result.rows.map(lot => ({
      ...lot,
      reserve_price: isAdmin ? lot.reserve_price : undefined
    }));

    res.json({
      success: true,
      data: lots
    });

  } catch (err) {
    console.error('getLots error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get lots'
    });
  }
};

// ─── GET SINGLE LOT ───────────────────────────────────────────────────────────

const getLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;

    const isAdmin = req.user &&
      ['super_admin', 'auction_manager'].includes(req.user.role);

    const result = await db.query(
      `SELECT
        l.*,
        mc.name AS category_name,
        COUNT(DISTINCT b.id) AS total_bids,
        MAX(b.amount) AS highest_bid,
        COALESCE(
          json_agg(
            json_build_object('url', li.url, 'caption', li.caption, 'sort_order', li.sort_order)
            ORDER BY li.sort_order
          ) FILTER (WHERE li.url IS NOT NULL),
          '[]'
        ) AS images
       FROM lots l
       LEFT JOIN material_categories mc ON mc.id = l.category_id
       LEFT JOIN bids b ON b.lot_id = l.id
       LEFT JOIN lot_images li ON li.lot_id = l.id
       WHERE l.id = $1 AND l.auction_id = $2
       GROUP BY l.id, mc.name`,
      [lotId, auctionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lot not found'
      });
    }

    const lot = {
      ...result.rows[0],
      reserve_price: isAdmin ? result.rows[0].reserve_price : undefined
    };

    // Get bid history
    const bids = await db.query(
      `SELECT
        b.id, b.amount, b.created_at, b.is_winning,
        u.full_name AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1
       ORDER BY b.amount DESC
       LIMIT 20`,
      [lotId]
    );

    res.json({
      success: true,
      data: {
        ...lot,
        recentBids: bids.rows
      }
    });

  } catch (err) {
    console.error('getLot error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get lot'
    });
  }
};

// ─── UPDATE LOT ───────────────────────────────────────────────────────────────

const updateLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;

    const existing = await db.query(
      'SELECT * FROM lots WHERE id = $1 AND auction_id = $2',
      [lotId, auctionId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lot not found'
      });
    }

    if (!['draft', 'active'].includes(existing.rows[0].status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a sold or withdrawn lot'
      });
    }

    const {
      title, description, categoryId, materialGrade,
      quantity, unit, estimatedWeightMt, reservePrice,
      startPrice, priceUnit, minIncrement, location, inspectionDate
    } = req.body;

    const result = await db.query(
      `UPDATE lots SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        category_id = COALESCE($3, category_id),
        material_grade = COALESCE($4, material_grade),
        quantity = COALESCE($5, quantity),
        unit = COALESCE($6, unit),
        estimated_weight_mt = COALESCE($7, estimated_weight_mt),
        reserve_price = COALESCE($8, reserve_price),
        start_price = COALESCE($9, start_price),
        price_unit = COALESCE($10, price_unit),
        min_increment = COALESCE($11, min_increment),
        location = COALESCE($12, location),
        inspection_date = COALESCE($13, inspection_date),
        updated_at = NOW()
       WHERE id = $14 AND auction_id = $15
       RETURNING *`,
      [
        title, description, categoryId, materialGrade,
        quantity, unit, estimatedWeightMt, reservePrice,
        startPrice, priceUnit, minIncrement, location, inspectionDate,
        lotId, auctionId
      ]
    );

    res.json({
      success: true,
      message: 'Lot updated successfully',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('updateLot error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update lot'
    });
  }
};

// ─── DELETE LOT ───────────────────────────────────────────────────────────────

const deleteLot = async (req, res) => {
  try {
    const { auctionId, lotId } = req.params;

    const existing = await db.query(
      'SELECT * FROM lots WHERE id = $1 AND auction_id = $2',
      [lotId, auctionId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lot not found'
      });
    }

    if (existing.rows[0].status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an active lot. Withdraw it first.'
      });
    }

    await db.query(
      'DELETE FROM lots WHERE id = $1 AND auction_id = $2',
      [lotId, auctionId]
    );

    res.json({
      success: true,
      message: 'Lot deleted successfully'
    });

  } catch (err) {
    console.error('deleteLot error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete lot'
    });
  }
};

// ─── DECLARE WINNER ───────────────────────────────────────────────────────────

const declareWinner = async (req, res) => {
  const client = await db.getClient();
  try {
    const { auctionId, lotId } = req.params;

    const lotResult = await client.query(
      `SELECT l.*, a.status AS auction_status, a.title AS auction_title
       FROM lots l
       JOIN auctions a ON a.id = l.auction_id
       WHERE l.id = $1 AND l.auction_id = $2`,
      [lotId, auctionId]
    );

    if (lotResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lot not found'
      });
    }

    const lot = lotResult.rows[0];

    if (!['ended', 'live'].includes(lot.auction_status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only declare winner for ended or live auctions'
      });
    }

    // Get highest bid
    const highestBid = await client.query(
      `SELECT b.*, u.full_name AS bidder_name, u.mobile AS bidder_mobile
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.lot_id = $1
       ORDER BY b.amount DESC
       LIMIT 1`,
      [lotId]
    );

    if (highestBid.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No bids found for this lot'
      });
    }

    const winningBid = highestBid.rows[0];

    // Check reserve price
    if (lot.reserve_price && winningBid.amount < lot.reserve_price) {
      return res.status(400).json({
        success: false,
        message: `Highest bid ₹${winningBid.amount} is below reserve price ₹${lot.reserve_price}`,
        data: {
          highestBid: winningBid.amount,
          reservePrice: lot.reserve_price
        }
      });
    }

    await client.query('BEGIN');

    // Update lot with winner
    await client.query(
      `UPDATE lots SET
        status = 'sold',
        winner_user_id = $1,
        winning_bid_id = $2,
        winning_amount = $3,
        awarded_at = NOW(),
        updated_at = NOW()
       WHERE id = $4`,
      [winningBid.user_id, winningBid.id, winningBid.amount, lotId]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity_type, entity_id, description, metadata)
       VALUES ($1, $2, 'lot.winner_declared', 'lot', $3, $4, $5)`,
      [
        req.user.id, req.user.role, lotId,
        `Winner declared for ${lot.title}`,
        JSON.stringify({
          winnerId: winningBid.user_id,
          winnerName: winningBid.bidder_name,
          winningAmount: winningBid.amount
        })
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Winner declared successfully',
      data: {
        lotId,
        lotTitle: lot.title,
        winner: {
          userId: winningBid.user_id,
          name: winningBid.bidder_name,
          mobile: winningBid.bidder_mobile,
          winningAmount: winningBid.amount
        }
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('declareWinner error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to declare winner'
    });
  } finally {
    client.release();
  }
};

module.exports = {
  addLot,
  getLots,
  getLot,
  updateLot,
  deleteLot,
  declareWinner
};