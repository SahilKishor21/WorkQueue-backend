const mongoose = require('mongoose');
const User = require('./userModels');

const AssignmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user: { type: String, required: true },
    admin: { type: String, ref: 'Admin', required: true },
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'Head' },
    title: { type: String, required: true },
    filePath: { type: String, required: true },
    fileUrl: {
        type: String, 
        required: true,
    },
    createdAt: { type: Date, default: Date.now },
    
    feedback: {
        adminFeedback: { type: String, default: '' },
        headFeedback: { type: String, default: '' }
    },

    status: { 
        type: String, 
        enum: ['Pending', 'Accepted', 'Rejected'], 
        default: 'Pending' 
    },
    label: { type: String, default: '' }, // Optional label for additional info. It has nothing to do with other functionalities
    adminDecision: {
        type: String,
        enum: ['Accepted', 'Rejected', 'Pending'],
        default: 'Pending'
    },
    headDecision: {
        type: String,
        enum: ['Accepted', 'Rejected', 'Overturned', 'Pending'],
        default: 'Pending'
    },
    appealStatus: { 
        type: String, 
        enum: ['Pending', 'Accepted', 'Rejected'], 
        default: null 
    },
    appealDetails: {
        subject: { type: String, default: null },
        description: { type: String, default: null },
    }
});

module.exports = mongoose.model('Assignment', AssignmentSchema);
