const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = {
  email: process.env.SENDGRID_FROM_EMAIL || 'megha.jain@auctionit.in',
  name:  process.env.SENDGRID_FROM_NAME  || 'AuctionIt'
};

// ─── SEND OTP EMAIL ───────────────────────────────────────────────────────────
const sendOTPEmail = async (email, otp, name) => {
  if (!email) return;
  try {
    await sgMail.send({
      to:      email,
      from:    FROM,
      subject: 'Your AuctionIt OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1B3A6B; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">🏷️ AuctionIt</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Hello ${name || 'Bidder'},</h2>
            <p>Your OTP for AuctionIt login is:</p>
            <div style="background: #1B3A6B; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px;">
              ${otp}
            </div>
            <p style="color: #666; margin-top: 20px;">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
          </div>
          <div style="background: #E8722A; padding: 15px; text-align: center;">
            <p style="color: white; margin: 0;">© 2026 AuctionIt — O.P. Jindal Group</p>
          </div>
        </div>
      `
    });
    console.log(`  📧  Email sent  : OTP to ${email}`);
  } catch (err) {
    console.error('  📧  Email error:', err.response?.body || err.message);
  }
};

// ─── SEND AUCTION WIN EMAIL ───────────────────────────────────────────────────
const sendWinnerEmail = async (email, name, lotTitle, amount, auctionTitle) => {
  if (!email) return;
  try {
    await sgMail.send({
      to:      email,
      from:    FROM,
      subject: `Congratulations! You won ${lotTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1B3A6B; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">🏷️ AuctionIt</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>🏆 Congratulations, ${name}!</h2>
            <p>You have won the following lot:</p>
            <div style="background: white; border: 2px solid #E8722A; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #1B3A6B; margin: 0 0 10px 0;">${lotTitle}</h3>
              <p style="color: #666;">Auction: ${auctionTitle}</p>
              <p style="font-size: 24px; font-weight: bold; color: #E8722A;">
                Winning Bid: Rs.${parseFloat(amount).toLocaleString('en-IN')}
              </p>
            </div>
            <p>Our team will contact you shortly with payment and delivery details.</p>
          </div>
          <div style="background: #E8722A; padding: 15px; text-align: center;">
            <p style="color: white; margin: 0;">© 2026 AuctionIt — O.P. Jindal Group</p>
          </div>
        </div>
      `
    });
    console.log(`  📧  Email sent  : Winner notification to ${email}`);
  } catch (err) {
    console.error('  📧  Email error:', err.response?.body || err.message);
  }
};

// ─── SEND REGISTRATION EMAIL ──────────────────────────────────────────────────
const sendRegistrationEmail = async (email, name) => {
  if (!email) return;
  try {
    await sgMail.send({
      to:      email,
      from:    FROM,
      subject: 'Welcome to AuctionIt!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1B3A6B; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">🏷️ AuctionIt</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Welcome, ${name}!</h2>
            <p>Thank you for registering on AuctionIt — India's premier industrial auction platform.</p>
            <p>Your account is currently under KYC review. You will be notified once approved (usually 1-2 business days).</p>
            <div style="background: #1B3A6B; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <a href="https://auctionit-frontend.vercel.app" style="color: white; font-weight: bold; text-decoration: none; font-size: 16px;">
                Visit AuctionIt
              </a>
            </div>
          </div>
          <div style="background: #E8722A; padding: 15px; text-align: center;">
            <p style="color: white; margin: 0;">© 2026 AuctionIt — O.P. Jindal Group</p>
          </div>
        </div>
      `
    });
    console.log(`  📧  Email sent  : Welcome to ${email}`);
  } catch (err) {
    console.error('  📧  Email error:', err.response?.body || err.message);
  }
};

// ─── SEND KYC APPROVED EMAIL ──────────────────────────────────────────────────
const sendKycApprovedEmail = async (email, name) => {
  if (!email) return;
  try {
    await sgMail.send({
      to:      email,
      from:    FROM,
      subject: 'KYC Approved — Start Bidding on AuctionIt!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1B3A6B; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">🏷️ AuctionIt</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2>Great news, ${name}!</h2>
            <p style="color: #16a34a; font-weight: bold; font-size: 18px;">✅ Your KYC has been approved!</p>
            <p>You can now participate in all auctions on AuctionIt.</p>
            <div style="background: #E8722A; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <a href="https://auctionit-frontend.vercel.app/auctions" style="color: white; font-weight: bold; text-decoration: none; font-size: 16px;">
                Browse Live Auctions
              </a>
            </div>
          </div>
          <div style="background: #E8722A; padding: 15px; text-align: center;">
            <p style="color: white; margin: 0;">© 2026 AuctionIt — O.P. Jindal Group</p>
          </div>
        </div>
      `
    });
    console.log(`  📧  Email sent  : KYC approved to ${email}`);
  } catch (err) {
    console.error('  📧  Email error:', err.response?.body || err.message);
  }
};

module.exports = {
  sendOTPEmail,
  sendWinnerEmail,
  sendRegistrationEmail,
  sendKycApprovedEmail
};