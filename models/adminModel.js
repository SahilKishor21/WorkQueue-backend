const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, required: false, unique: true, sparse: true },
    password: { type: String, required: true },
    googleId: { type: String },
    githubId: { type: String },
    role: { type: String, enum: ['User', 'Admin', 'HOD', 'Head'], default: 'Admin' },
    
    // OTP fields for password reset
    resetOTP: { type: String },
    resetOTPExpires: { type: Date },
    resetOTPAttempts: { type: Number, default: 0 },
    
    // Profile fields
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date },
    profilePicture: { type: String },
    department: { type: String },
    permissions: [{ type: String }]
});

// Index for faster queries
adminSchema.index({ email: 1 });
adminSchema.index({ resetOTP: 1 });

module.exports = mongoose.model('Admin', adminSchema);