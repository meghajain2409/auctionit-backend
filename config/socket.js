const db = require('./db');
const { verifyAccessToken } = require('../utils/generateToken');

module.exports = (io) => {

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyAccessToken(token);
      const result = await db.query(
        'SELECT id, full_name, role, account_status FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length === 0) return next(new Error('User not found'));
      if (result.rows[0].account_status !== 'active') return next(new Error('Account suspended'));
      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`  ⚡  Connected   : ${socket.user.full_name} (${socket.user.role})`);

    socket.on('auction:join', async (auctionId) => {
      try {
        const auction = await db.query(
          'SELECT id, title, status FROM auctions WHERE id = $1',
          [auctionId]
        );

        if (auction.rows.length === 0) {
          socket.emit('error', { message: 'Auction not found' });
          return;
        }

        if (socket.user.role === 'bidder') {
          const registration = await db.query(
            `SELECT id FROM auction_registrations
             WHERE auction_id = $1 AND user_id = $2 AND status = 'active'`,
            [auctionId, socket.user.id]
          );
          if (registration.rows.length === 0) {
            socket.emit('error', { message: 'You are not registered for this auction' });
            return;
          }
        }

        socket.join(`auction:${auctionId}`);
        console.log(`  🏠  Joined room : ${socket.user.full_name} → auction:${auctionId}`);

        const lots = await db.query(
          `SELECT
            l.id, l.lot_number, l.title, l.status,
            l.start_price, l.current_price, l.min_increment,
            l.quantity, l.unit, l.price_unit,
            COUNT(b.id) AS total_bids,
            MAX(b.amount) AS highest_bid
           FROM lots l
           LEFT JOIN bids b ON b.lot_id = l.id
           WHERE l.auction_id = $1
           GROUP BY l.id
           ORDER BY l.sort_order ASC`,
          [auctionId]
        );

        socket.emit('auction:state', {
          auctionId,
          auctionTitle: auction.rows[0].title,
          status: auction.rows[0].status,
          lots: lots.rows
        });

      } catch (err) {
        console.error('auction:join error:', err);
        socket.emit('error', { message: 'Failed to join auction' });
      }
    });

    socket.on('auction:leave', (auctionId) => {
      socket.leave(`auction:${auctionId}`);
      console.log(`  🚪  Left room   : ${socket.user.full_name} → auction:${auctionId}`);
    });

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

        const auction = await db.query(
          'SELECT * FROM auctions WHERE id = $1',
          [auctionId]
        );

        if (auction.rows[0]?.status !== 'live') {
          socket.emit('bid:error', { message: 'Auction is not live' });
          return;
        }

        const registration = await db.query(
          `SELECT id FROM auction_registrations
           WHERE auction_id = $1 AND user_id = $2 AND status = 'active'`,
          [auctionId, socket.user.id]
        );

        if (registration.rows.length === 0) {
          socket.emit('bid:error', { message: 'You are not registered for this auction' });
          return;
        }

        const lot = await db.query(
          'SELECT * FROM lots WHERE id = $1 AND auction_id = $2',
          [lotId, auctionId]
        );

        if (lot.rows.length === 0) {
          socket.emit('bid:error', { message: 'Lot not found' });
          return;
        }

        if (lot.rows[0].status !== 'active') {
          socket.emit('bid:error', { message: 'Lot is not active for bidding' });
          return;
        }

        const currentPrice  = parseFloat(lot.rows[0].current_price);
        const minIncrement  = parseFloat(lot.rows[0].min_increment);
        const minBid        = currentPrice + minIncrement;

        if (parseFloat(amount) < minBid) {
          socket.emit('bid:error', {
            message: `Minimum bid is ₹${minBid.toLocaleString('en-IN')}`,
            minBid
          });
          return;
        }

        const bidResult = await db.query(
          `INSERT INTO bids (lot_id, auction_id, user_id, amount, ip_address, bid_source)
           VALUES ($1, $2, $3, $4, $5, 'websocket')
           RETURNING *`,
          [lotId, auctionId, socket.user.id, amount, socket.handshake.address]
        );

        const newBid       = bidResult.rows[0];
        const auctionData  = auction.rows[0];
        let extended       = false;
        let newEndTime     = auctionData.end_time;

        if (auctionData.auto_extend_enabled && auctionData.end_time) {
          const timeLeft   = new Date(auctionData.end_time) - new Date();
          const triggerMs  = auctionData.auto_extend_trigger_mins * 60 * 1000;

          if (timeLeft <= triggerMs) {
            const extCount = await db.query(
              'SELECT COUNT(*) FROM auction_extensions WHERE auction_id = $1',
              [auctionId]
            );

            if (parseInt(extCount.rows[0].count) < auctionData.max_extensions) {
              const extendMs = auctionData.auto_extend_duration_mins * 60 * 1000;
              newEndTime     = new Date(new Date(auctionData.end_time).getTime() + extendMs);

              await db.query(
                'UPDATE auctions SET end_time = $1, updated_at = NOW() WHERE id = $2',
                [newEndTime, auctionId]
              );

              await db.query(
                `INSERT INTO auction_extensions
                 (auction_id, lot_id, trigger_bid_id, extended_by_mins, old_end_time, new_end_time, extension_number)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  auctionId, lotId, newBid.id,
                  auctionData.auto_extend_duration_mins,
                  auctionData.end_time, newEndTime,
                  parseInt(extCount.rows[0].count) + 1
                ]
              );
              extended = true;
            }
          }
        }

        const updatedLot = await db.query(
          `SELECT l.*, COUNT(b.id) AS total_bids
           FROM lots l
           LEFT JOIN bids b ON b.lot_id = l.id
           WHERE l.id = $1
           GROUP BY l.id`,
          [lotId]
        );

        const leaderboard = await db.query(
          `SELECT b.amount, b.created_at, u.full_name AS bidder_name, b.is_winning
           FROM bids b
           JOIN users u ON u.id = b.user_id
           WHERE b.lot_id = $1
           ORDER BY b.amount DESC
           LIMIT 5`,
          [lotId]
        );

        io.to(`auction:${auctionId}`).emit('bid:new', {
          lotId,
          auctionId,
          bid: {
            id         : newBid.id,
            amount     : newBid.amount,
            bidderName : socket.user.full_name,
            createdAt  : newBid.created_at
          },
          lot         : updatedLot.rows[0],
          leaderboard : leaderboard.rows,
          ...(extended && {
            extended   : true,
            newEndTime,
            message    : `⏰ Auction extended by ${auctionData.auto_extend_duration_mins} minutes!`
          })
        });

        socket.emit('bid:success', {
          message    : `Bid of ₹${parseFloat(amount).toLocaleString('en-IN')} placed successfully!`,
          bid        : newBid,
          isWinning  : true,
          ...(extended && { extended: true, newEndTime })
        });

        console.log(`  💰  New bid     : ₹${amount} by ${socket.user.full_name} on lot ${lotId}`);

      } catch (err) {
        console.error('bid:place error:', err.message);
        socket.emit('bid:error', {
          message: err.message.includes('Bid amount') ? err.message : 'Failed to place bid'
        });
      }
    });

    socket.on('lot:leaderboard', async (lotId) => {
      try {
        const leaderboard = await db.query(
          `SELECT b.id, b.amount, b.created_at, b.is_winning, u.full_name AS bidder_name
           FROM bids b
           JOIN users u ON u.id = b.user_id
           WHERE b.lot_id = $1
           ORDER BY b.amount DESC
           LIMIT 10`,
          [lotId]
        );
        socket.emit('lot:leaderboard', { lotId, leaderboard: leaderboard.rows });
      } catch (err) {
        socket.emit('error', { message: 'Failed to get leaderboard' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`  ❌  Disconnected: ${socket.user.full_name}`);
    });

  });

};