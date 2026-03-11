const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const hashOTP = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

const verifyOTP = async (otp, hash) => {
  return bcrypt.compare(otp, hash);
};

module.exports = { generateOTP, hashOTP, verifyOTP };