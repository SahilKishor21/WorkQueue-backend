const mongoose = require('mongoose');

const AdminAssignmentSchema = new mongoose.Schema({
    admin: { type: String, ref: 'Admin', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    label: { type: String, required: true },
    deadline: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    warningEmailSent: {
        type: Boolean,
        default: false
    },
    sentWarningEmails: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        sentAt: {
            type: Date,
            default: Date.now
        }
    }]
});

module.exports = mongoose.model('AdminAssignment', AdminAssignmentSchema);