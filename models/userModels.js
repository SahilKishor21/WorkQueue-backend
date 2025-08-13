const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, unique: true, sparse: true },
    googleId: { type: String },
    githubId: { type: String },
    labels: [{ type: String, default: [] }], // Changed to array for multiple labels
    role: { type: String, enum: ['User', 'Admin'], default: 'User' },
    
    // OTP fields for password reset
    resetOTP: { type: String },
    resetOTPExpires: { type: Date },
    resetOTPAttempts: { type: Number, default: 0 },
    
    // Profile fields
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date },
    profilePicture: { type: String }
});

// Virtual for backward compatibility
userSchema.virtual('label').get(function() {
    return this.labels && this.labels.length > 0 ? this.labels[0] : '';
});

userSchema.virtual('label').set(function(value) {
    if (value && !this.labels.includes(value)) {
        this.labels.push(value);
    }
});

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ resetOTP: 1 });

module.exports = mongoose.model('User', userSchema);