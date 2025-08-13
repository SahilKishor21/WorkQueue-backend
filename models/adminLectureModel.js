const mongoose = require('mongoose');

const AdminLectureSchema = new mongoose.Schema({
    admin: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    label: { type: String, required: true },
    fileUrl: { type: String, required: true },
    filePath: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AdminLecture', AdminLectureSchema);