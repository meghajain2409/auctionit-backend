const db = require('../config/db');

const checkAndEndAuctions = async (io) => {
  try {
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
        await db.query(
          `UPDATE auctions SET status = 'ended', actual_end_time = NOW(), updated_at = NOW()
           WHERE id = $1`, [auction.id]
        );

        // Mark lots without winners as unsold
        await db.query(
          `UPDATE auction_lots SET status = 'unsold', updated_at = NOW()
           WHERE auction_id = $1 AND status = 'active' AND winning_bidder_id IS NULL`,
          [auction.id]
        );

        // Mark lots with winners as sold
        await db.query(
          `UPDATE auction_lots SET status = 'sold', updated_at = NOW()
           WHERE auction_id = $1 AND status = 'active' AND winning_bidder_id IS NOT NULL`,
          [auction.id]
        );

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
  checkAndEndAuctions(io);
  setInterval(() => checkAndEndAuctions(io), 60 * 1000);
};

module.exports = { startScheduler, checkAndEndAuctions };
