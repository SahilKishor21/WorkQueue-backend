const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const HeadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    googleId: { type: String },
    githubId: { type: String },
    role: { type: String, enum: ['User', 'Admin'], default: 'User' },
    isActive: { type: Boolean, default: false },
});

// Hash password before saving
/* HeadSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next(); 
}); */

module.exports = mongoose.model('Head', HeadSchema);
