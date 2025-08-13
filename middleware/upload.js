const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const folder = req.baseUrl?.includes('/admins') ? 'admin-assignments' : 'user-assignments';
        
        // Remove extension from filename to avoid double extensions
        const fileNameWithoutExt = file.originalname.replace(/\.[^/.]+$/, "");
        const cleanFileName = fileNameWithoutExt.replace(/\s+/g, '_');
        const publicId = `${Date.now()}-${cleanFileName}`;
        
        // Determine resource type based on file type
        const videoTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/mkv'];
        const documentTypes = ['application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        const imageTypes = ['image/jpeg', 'image/png', 'image/gif'];
        
        let resourceType = 'raw'; // default
        
        if (videoTypes.includes(file.mimetype)) {
            resourceType = 'video';
        } else if (imageTypes.includes(file.mimetype)) {
            resourceType = 'image';
        } else if (documentTypes.includes(file.mimetype)) {
            resourceType = 'raw';
        }
        
        return {
            folder: folder || 'default-folder',
            resource_type: resourceType,
            allowed_formats: ['pdf', 'ppt', 'pptx', 'csv', 'jpeg', 'png', 'mp4', 'avi', 'mov', 'wmv', 'mkv', 'doc', 'docx'],
            public_id: publicId,
            access_mode: 'public',
            use_filename: false,
        };
    },
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        console.log('File received for upload:', file);
        const allowedTypes = [
            'application/pdf', 
            'application/vnd.ms-powerpoint', 
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
            'text/csv', 
            'image/jpeg', 
            'image/png',
            'video/mp4',
            'video/avi',
            'video/mov',
            'video/wmv',
            'video/mkv',
            'application/msword', // .doc
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.error(`Rejected file: ${file.mimetype}`);
            cb(new Error('Only .pdf, .ppt, .pptx, .csv, .jpeg, .png, .mp4, .avi, .mov, .wmv, .mkv, .doc, and .docx files are allowed.'));
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB for video files
    },
});

module.exports = upload;