const mongoose = require('mongoose');

const AdminTestSchema = new mongoose.Schema({
    admin: { type: String, ref: 'Admin', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    label: { type: String, required: true },
    testUrl: { type: String, required: true },
    deadline: { type: Date, required: true },
    // Migration field to track if deadline includes time
    hasTimeComponent: { 
        type: Boolean, 
        default: true  // New tests will have time by default
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Middleware to update updatedAt on save
AdminTestSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Virtual to get formatted deadline with time
AdminTestSchema.virtual('formattedDeadline').get(function() {
    if (!this.deadline) return null;
    
    if (this.hasTimeComponent) {
        return this.deadline.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } else {
        // Legacy format - just date
        return this.deadline.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
});

module.exports = mongoose.model('AdminTest', AdminTestSchema);