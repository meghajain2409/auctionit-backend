const db = require('../config/db');

const checkAndEndAuctions = async (io) => {
  try {
    // Find all live auctions whose end_time has passed
    const result = await db.query(
      `SELECT id, title, auction_number
       FROM auctions
       WHERE status = 'live'
       AND end_time IS NOT NULL
       AND end_time <= NOW()`
    );

    if (result.rows.length === 0) return;

    for (const auction of result.rows) {
      try {
        // End the auction
        await db.query(
          `UPDATE auctions SET
            status = 'ended',
            actual_end_time = NOW(),
            updated_at = NOW()
           WHERE id = $1`,
          [auction.id]
        );

        // Update all active lots to ended
        await db.query(
          `UPDATE lots SET
            status = 'sold',
            updated_at = NOW()
           WHERE auction_id = $1
           AND status = 'active'
           AND winner_user_id IS NULL`,
          [auction.id]
        );

        // Log in audit
        await db.query(
          `INSERT INTO audit_logs
           (user_id, user_role, action, entity_type, entity_id, description)
           VALUES (
             (SELECT id FROM users WHERE role = 'super_admin' LIMIT 1),
             'super_admin', 'auction.auto_ended', 'auction', $1, $2
           )`,
          [auction.id, `Auction ${auction.auction_number} auto-ended by scheduler`]
        );

        // Notify all users in the auction room via WebSocket
        if (io) {
          io.to(`auction:${auction.id}`).emit('auction:ended', {
            auctionId: auction.id,
            message: 'Auction has ended!',
            endedAt: new Date().toISOString()
          });
        }

        console.log(`  ⏰  Auto-ended  : ${auction.auction_number} - ${auction.title}`);

      } catch (err) {
        console.error(`Failed to end auction ${auction.id}:`, err.message);
      }
    }

  } catch (err) {
    console.error('Scheduler error:', err.message);
  }
};

const startScheduler = (io) => {
  console.log('  ⏰  Scheduler  : Started (checking every 60 seconds)');

  // Run immediately on start
  checkAndEndAuctions(io);

  // Then run every 60 seconds
  setInterval(() => {
    checkAndEndAuctions(io);
  }, 60 * 1000);
};

module.exports = { startScheduler, checkAndEndAuctions };