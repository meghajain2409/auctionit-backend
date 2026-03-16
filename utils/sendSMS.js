const axios = require('axios');

const sendOTPviaSMS = async (mobile, otp) => {
  try {
    // Always log OTP for debugging
    console.log(`  📱 OTP for ${mobile}: ${otp}`);

    // Skip real SMS in development
    if (process.env.NODE_ENV === 'development') {
      console.log('  📱 Dev mode — skipping real SMS');
      return { success: true, dev: true };
    }

    const response = await axios.post(
      'https://control.msg91.com/api/v5/otp',
      {
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile:      `91${mobile}`,
        authkey:     process.env.MSG91_AUTH_KEY,
        otp:         otp
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('  📱 SMS sent:', response.data);
    return { success: true, data: response.data };

  } catch (err) {
    console.error('  📱 SMS error:', err.response?.data || err.message);
    // Don't throw — fall back gracefully
    return { success: false, error: err.message };
  }
};

module.exports = { sendOTPviaSMS };