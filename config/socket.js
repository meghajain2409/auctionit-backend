const db = require('./db');
const { verifyAccessToken } = require('../utils/generateToken');

module.exports = (io) => {

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyAccessToken(token);
      const result = await db.query(
        'SELECT id, name, role, is_active FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length === 0) return next(new Error('User not found'));
      if (!result.rows[0].is_active) return next(new Error('Account suspended'));
      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`  ⚡  Connected   : ${socket.user.name} (${socket.user.role})`);

    // ── JOIN AUCTION ROOM ──
    socket.on('auction:join', async (auctionId) => {
      try {
        const auction = await db.query(
          'SELECT id, title, status, start_time, end_time FROM auctions WHERE id = $1',
          [auctionId]
        );
        if (auction.rows.length === 0) {
          socket.emit('error', { message: 'Auction not found' });
          return;
        }

        socket.join(`auction:${auctionId}`);
        console.log(`  🏠  Joined room : ${socket.user.name} → auction:${auctionId}`);

        const lots = await db.query(
          `SELECT al.id, al.lot_number, al.lot_display_name, al.status,
            al.starting_bid, al.current_highest_bid,
            al.quantity, al.unit, al.quality_grade,
            COUNT(b.id) AS total_bids, MAX(b.bid_amount) AS highest_bid
           FROM auction_lots al
           LEFT JOIN bids b ON b.lot_id = al.id
           WHERE al.auction_id = $1
           GROUP BY al.id
           ORDER BY al.lot_number ASC`,
          [auctionId]
        );

        socket.emit('auction:state', {
          auctionId,
          auctionTitle: auction.rows[0].title,
          status: auction.rows[0].status,
          startTime: auction.rows[0].start_time,
          endTime: auction.rows[0].end_time,
          lots: lots.rows
        });
      } catch (err) {
        console.error('auction:join error:', err.message);
        socket.emit('error', { message: 'Failed to join auction' });
      }
    });

    socket.on('auction:leave', (auctionId) => {
      socket.leave(`auction:${auctionId}`);
    });

    // ── PLACE BID ──
    socket.on('bid:place', async ({ auctionId, lotId, amount }) => {
      try {
        if (socket.user.role !== 'bidder') {
          socket.emit('bid:error', { message: 'Only bidders can place bids' });
          return;
        }
        if (!auctionId || !lotId || !amount) {
          socket.emit('bid:error', { message: 'Auction ID, Lot ID and amount are required' });
          return;
        }

        const auction = await db.query('SELECT * FROM auctions WHERE id = $1', [auctionId]);
        if (auction.rows[0]?.status !== 'live') {
          socket.emit('bid:error', { message: 'Auction is not live' });
          return;
        }

        const lot = await db.query(
          'SELECT * FROM auction_lots WHERE id = $1 AND auction_id = $2',
          [lotId, auctionId]
        );
        if (lot.rows.length === 0) { socket.emit('bid:error', { message: 'Lot not found' }); return; }
        if (lot.rows[0].status !== 'active') { socket.emit('bid:error', { message: 'Lot is not active' }); return; }

        const currentPrice = parseFloat(lot.rows[0].current_highest_bid || lot.rows[0].starting_bid);
        const minBid = currentPrice + 100; // Default min increment of 100

        if (parseFloat(amount) < minBid) {
          socket.emit('bid:error', { message: `Minimum bid is ₹${minBid.toLocaleString('en-IN')}`, minBid });
          return;
        }

        // Get bidder_id from bidders table
        let bidderId = null;
        try {
          const bidderResult = await db.query('SELECT id FROM bidders WHERE user_id = $1', [socket.user.id]);
          if (bidderResult.rows.length > 0) bidderId = bidderResult.rows[0].id;
        } catch (e) { /* bidder_id is nullable, ok to skip */ }

        // Insert bid
        const bidResult = await db.query(
          `INSERT INTO bids (auction_id, lot_id, bidder_id, user_id, bid_amount, bid_time, is_winning, is_valid, ip_address)
           VALUES ($1, $2, $3, $4, $5, NOW(), true, true, $6)
           RETURNING *`,
          [auctionId, lotId, bidderId, socket.user.id, amount, socket.handshake.address]
        );

        // Update lot current highest bid
        await db.query(
          `UPDATE auction_lots SET current_highest_bid = $1, updated_at = NOW() WHERE id = $2`,
          [amount, lotId]
        );

        // Mark previous winning bids as not winning
        await db.query(
          `UPDATE bids SET is_winning = false WHERE lot_id = $1 AND id != $2`,
          [lotId, bidResult.rows[0].id]
        );

        const newBid = bidResult.rows[0];

        // Auto-extend logic
        const auctionData = auction.rows[0];
        let extended = false;
        let newEndTime = auctionData.end_time;

        if (auctionData.auto_extend_enabled && auctionData.end_time) {
          const timeLeft = new Date(auctionData.end_time) - new Date();
          const extendMins = auctionData.extend_by_minutes || 5;
          const triggerMs = extendMins * 60 * 1000;

          if (timeLeft <= triggerMs && timeLeft > 0) {
            newEndTime = new Date(new Date(auctionData.end_time).getTime() + triggerMs);
            await db.query('UPDATE auctions SET end_time = $1, updated_at = NOW() WHERE id = $2',
              [newEndTime, auctionId]);
            extended = true;
          }
        }

        // Get leaderboard
        const leaderboard = await db.query(
          `SELECT b.bid_amount, b.bid_time, u.name AS bidder_name
           FROM bids b JOIN users u ON u.id = b.user_id
           WHERE b.lot_id = $1 ORDER BY b.bid_amount DESC LIMIT 5`,
          [lotId]
        );

        // Broadcast to room
        io.to(`auction:${auctionId}`).emit('bid:new', {
          lotId, auctionId,
          bid: { id: newBid.id, amount: newBid.bid_amount, bidderName: socket.user.name, bidTime: newBid.bid_time },
          currentHighestBid: amount,
          leaderboard: leaderboard.rows,
          ...(extended && { extended: true, newEndTime })
        });

        socket.emit('bid:success', {
          message: `Bid of ₹${parseFloat(amount).toLocaleString('en-IN')} placed!`,
          bid: newBid, isWinning: true,
          ...(extended && { extended: true, newEndTime })
        });

        console.log(`  💰  New bid     : ₹${amount} by ${socket.user.name} on lot ${lotId}`);

      } catch (err) {
        console.error('bid:place error:', err.message);
        socket.emit('bid:error', { message: 'Failed to place bid' });
      }
    });

    // ── LEADERBOARD ──
    socket.on('lot:leaderboard', async (lotId) => {
      try {
        const leaderboard = await db.query(
          `SELECT b.id, b.bid_amount, b.bid_time, u.name AS bidder_name
           FROM bids b JOIN users u ON u.id = b.user_id
           WHERE b.lot_id = $1 ORDER BY b.bid_amount DESC LIMIT 10`,
          [lotId]
        );
        socket.emit('lot:leaderboard', { lotId, leaderboard: leaderboard.rows });
      } catch (err) {
        socket.emit('error', { message: 'Failed to get leaderboard' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`  ❌  Disconnected: ${socket.user.name}`);
    });
  });
};
