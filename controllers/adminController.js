const Assignment = require('../models/assignmentModel');
const AdminAssignment = require('../models/adminAssignmentModel');
const AdminNotes = require('../models/adminNotesModel');
const AdminLecture = require('../models/adminLectureModel');
const AdminTest = require('../models/adminTestModel');
const User = require('../models/userModels');
const Admin = require('../models/adminModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendMail = require('../config/emailService');
const AssignmentReminderService = require('../services/assignmentReminderService');
console.log('🔍 sendMail function type:', typeof sendMail); 

// Generate JWT
const generateToken = (id, role, name, label) => {
    return jwt.sign({ id, role, name, label }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// CORRECTED Helper function to find users by label (handles both old and new label formats)
const findUsersByLabel = async (label) => {
    try {
        console.log(`🔍 Searching for users with label: "${label}"`);
        
        // Search for users with BOTH old and new formats simultaneously
        let newFormatUsers = await User.find({ 
            labels: { $in: [label] } 
        });
        
        let oldFormatUsers = await User.find({ 
            label: label,
            $or: [
                { labels: { $exists: false } },
                { labels: { $size: 0 } },
                { labels: null }
            ]
        });

        console.log(`📊 Found ${newFormatUsers.length} users with new format (labels array)`);
        console.log(`📊 Found ${oldFormatUsers.length} users with old format (single label field)`);

        // Migrate old format users to new format
        if (oldFormatUsers.length > 0) {
            console.log(`🔄 Migrating ${oldFormatUsers.length} users from old label format...`);
            
            for (const user of oldFormatUsers) {
                try {
                    // Migrate: move single label to labels array
                    user.labels = [user.label];
                    user.label = undefined; // Remove old field
                    await user.save();
                    console.log(`✅ Migrated user: ${user.name} (${user.email})`);
                } catch (migrationError) {
                    console.error(`❌ Failed to migrate user ${user.name}:`, migrationError.message);
                }
            }
            
            // Add migrated users to the new format users list
            newFormatUsers = [...newFormatUsers, ...oldFormatUsers];
        }

        // Remove duplicates (in case a user appears in both lists somehow)
        const uniqueUsers = newFormatUsers.filter((user, index, self) => 
            index === self.findIndex(u => u._id.toString() === user._id.toString())
        );

        console.log(`✅ Total unique users found for label "${label}": ${uniqueUsers.length}`);
        
        // Log user details for debugging
        uniqueUsers.forEach(user => {
            console.log(`👤 User: ${user.name} (${user.email}) - Labels: [${user.labels?.join(', ') || 'none'}]`);
        });

        return uniqueUsers;
        
    } catch (error) {
        console.error('❌ Error finding users by label:', error);
        return [];
    }
};

// ====================
// PROFILE MANAGEMENT FUNCTIONS
// ====================

// Get Admin Profile
const getAdminProfile = async (req, res) => {
    try {
        console.log('getAdminProfile - req.user:', req.user);
        
        const admin = await Admin.findById(req.user.id).select('-password -resetOTP -resetOTPExpires');
        if (!admin) {
            console.error('getAdminProfile - Admin not found with ID:', req.user.id);
            return res.status(404).json({ message: 'Admin not found' });
        }

        console.log('getAdminProfile - Admin found:', admin.name);
        
        const profileData = {
            id: admin._id,
            name: admin.name,
            email: admin.email,
            username: admin.username,
            role: admin.role,
            department: admin.department,
            permissions: admin.permissions,
            createdAt: admin.createdAt,
            lastLogin: admin.lastLogin,
            profilePicture: admin.profilePicture
        };

        console.log('getAdminProfile - Sending profile data:', profileData);

        res.status(200).json({
            profile: profileData
        });
    } catch (error) {
        console.error('Error fetching admin profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update Admin Profile
const updateAdminProfile = async (req, res) => {
    try {
        const { name, username, profilePicture, department } = req.body;
        const adminId = req.user.id;

        const updateData = {};
        if (name) updateData.name = name;
        if (username) updateData.username = username;
        if (profilePicture) updateData.profilePicture = profilePicture;
        if (department) updateData.department = department;

        // Check if username is already taken by another admin
        if (username) {
            const existingAdmin = await Admin.findOne({ 
                username, 
                _id: { $ne: adminId } 
            });
            if (existingAdmin) {
                return res.status(400).json({ message: 'Username already taken' });
            }
        }

        const admin = await Admin.findByIdAndUpdate(
            adminId, 
            updateData, 
            { new: true }
        ).select('-password -resetOTP -resetOTPExpires');

        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Generate new token with updated info
        const token = generateToken(admin.id, admin.role, admin.name, admin.label);

        res.status(200).json({
            message: 'Profile updated successfully',
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                username: admin.username,
                role: admin.role,
                department: admin.department,
                lastLogin: admin.lastLogin,
                profilePicture: admin.profilePicture
            },
            token
        });
    } catch (error) {
        console.error('Error updating admin profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Change Admin Password
const changeAdminPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const adminId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long' });
        }

        const admin = await Admin.findById(adminId);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, admin.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedNewPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        admin.password = hashedNewPassword;
        await admin.save();

        // Send confirmation email
        const emailSubject = 'Password Changed Successfully';
        const emailText = `Hello ${admin.name},\n\nYour admin password has been successfully changed.\n\nIf you did not make this change, please contact support immediately.\n\nBest regards,\nWorkQueue Admin Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">🔒 Admin Password Changed Successfully</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${admin.name}</strong>,</p>
                    
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #28a745;">
                        <p style="color: #155724; margin: 0;"><strong>✅ Your admin password has been successfully changed.</strong></p>
                    </div>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0;"><strong>⚠️ Security Notice:</strong> If you did not make this change, please contact support immediately.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Admin Team</strong></p>
                    </div>
                </div>
            </div>`;

        try {
            await sendMail(admin.email, emailSubject, emailText, emailHtml);
        } catch (emailError) {
            console.error('Error sending admin password change confirmation email:', emailError);
        }

        res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing admin password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Send Reset OTP for Admin
const sendAdminResetOTP = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(404).json({ message: 'Admin with this email does not exist' });
        }

        // Check for rate limiting (max 3 attempts per hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (admin.resetOTPExpires > oneHourAgo && admin.resetOTPAttempts >= 3) {
            return res.status(429).json({ 
                message: 'Too many reset attempts. Please try again later.' 
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Update admin with OTP
        admin.resetOTP = otp;
        admin.resetOTPExpires = otpExpires;
        admin.resetOTPAttempts = (admin.resetOTPAttempts || 0) + 1;
        await admin.save();

        // Send email
        const emailSubject = 'Admin Password Reset OTP - WorkQueue';
        const emailText = `Hello ${admin.name},\n\nYour admin password reset OTP is: ${otp}\n\nThis OTP will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nBest regards,\nWorkQueue Admin Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">🔐 Admin Password Reset OTP</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${admin.name}</strong>,</p>
                    
                    <p style="color: #333; font-size: 16px;">You have requested to reset your admin password. Please use the following OTP:</p>
                    
                    <div style="background: #f8f9fa; border: 2px solid #007bff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <h1 style="color: #007bff; margin: 0; font-size: 36px; letter-spacing: 5px; font-family: monospace;">${otp}</h1>
                    </div>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0;"><strong>⏰ Important:</strong> This OTP will expire in 10 minutes.</p>
                    </div>
                    
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #721c24; margin: 0;"><strong>🚨 Security Notice:</strong> If you did not request this password reset, please ignore this email.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Admin Team</strong></p>
                    </div>
                </div>
            </div>`;

        await sendMail(admin.email, emailSubject, emailText, emailHtml);

        res.status(200).json({ 
            message: 'OTP sent to your email successfully',
            email: email
        });
    } catch (error) {
        console.error('Error sending admin reset OTP:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Verify Admin Reset OTP
const verifyAdminResetOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }

        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Check if OTP is valid and not expired
        if (!admin.resetOTP || admin.resetOTP !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        if (admin.resetOTPExpires < new Date()) {
            return res.status(400).json({ message: 'OTP has expired' });
        }

        // Generate temporary token for password reset
        const resetToken = jwt.sign(
            { id: admin._id, purpose: 'admin_password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.status(200).json({
            message: 'OTP verified successfully',
            resetToken: resetToken
        });
    } catch (error) {
        console.error('Error verifying admin OTP:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reset Admin Password
const resetAdminPassword = async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        if (!resetToken || !newPassword) {
            return res.status(400).json({ message: 'Reset token and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }

        // Verify reset token
        let decoded;
        try {
            decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(400).json({ message: 'Invalid or expired reset token' });
        }

        if (decoded.purpose !== 'admin_password_reset') {
            return res.status(400).json({ message: 'Invalid reset token' });
        }

        const admin = await Admin.findById(decoded.id);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password and clear OTP fields
        admin.password = hashedPassword;
        admin.resetOTP = undefined;
        admin.resetOTPExpires = undefined;
        admin.resetOTPAttempts = 0;
        await admin.save();

        // Send confirmation email
        const emailSubject = 'Admin Password Reset Successfully - WorkQueue';
        const emailText = `Hello ${admin.name},\n\nYour admin password has been reset successfully.\n\nIf you did not make this change, please contact support immediately.\n\nBest regards,\nWorkQueue Admin Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">✅ Admin Password Reset Successfully</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${admin.name}</strong>,</p>
                    
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #28a745;">
                        <p style="color: #155724; margin: 0;"><strong>✅ Your admin password has been reset successfully!</strong></p>
                    </div>
                    
                    <p style="color: #333; font-size: 16px;">You can now log in with your new password.</p>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0;"><strong>🔐 Security Reminder:</strong> Keep your password secure and don't share it with anyone.</p>
                    </div>
                    
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #721c24; margin: 0;"><strong>⚠️ Important:</strong> If you did not reset your password, please contact support immediately.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Admin Team</strong></p>
                    </div>
                </div>
            </div>`;

        try {
            await sendMail(admin.email, emailSubject, emailText, emailHtml);
        } catch (emailError) {
            console.error('Error sending admin password reset confirmation email:', emailError);
        }

        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        console.error('Error resetting admin password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ====================
// EXISTING FUNCTIONS (UPDATED FOR LABEL MIGRATION)
// ====================

// Accept an assignment
const acceptAssignment = async (req, res) => {
    const { assignmentId } = req.params;

    try {
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.status = 'accepted';
        await assignment.save();

        const io = req.app.get('io'); // Access the io instance from server.js
        io.emit('notification', { message: `Assignment "${assignment.title}" has been accepted.` });

        const recipientName = assignment.userId?.name || 'Student';
        const emailSubject = `Assignment Accepted: ${assignment.title}`;
        
        const emailText = `Dear ${recipientName}, your assignment "${assignment.title}" has been accepted.`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">✅ Assignment Accepted</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Dear <strong>${recipientName}</strong>,</p>
                    
                    <p style="color: #333; font-size: 16px;">Great news! Your assignment has been accepted:</p>
                    
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #28a745;">
                        <h3 style="color: #155724; margin: 0 0 10px 0; font-size: 18px;">📚 ${assignment.title}</h3>
                        <p style="color: #155724; margin: 5px 0;"><strong>Status:</strong> Accepted ✅</p>
                    </div>
                    
                    <p style="color: #333; margin-top: 20px;">Congratulations on your successful submission! Please check the assignment portal for any additional feedback or next steps.</p>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Assignment Management System</strong></p>
                    </div>
                </div>
            </div>`;

        await sendMail(assignment.userId.email, emailSubject, emailText, emailHtml);

        return res.status(200).json({ message: 'Assignment accepted successfully.', assignment });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Reject an assignment
const rejectAssignment = async (req, res) => {
    const { assignmentId } = req.params;
    
    try {
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.status = 'rejected';
        await assignment.save();

        const io = req.app.get('io'); // Access the io instance from server.js
        io.emit('notification', { message: `Assignment "${assignment.title}" has been rejected.` });

        const recipientName = assignment.userId?.name || 'Student';
        const emailSubject = `Assignment Rejected: ${assignment.title}`;
        
        const emailText = `Dear ${recipientName}, your assignment "${assignment.title}" has been rejected.`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">❌ Assignment Rejected</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Dear <strong>${recipientName}</strong>,</p>
                    
                    <p style="color: #333; font-size: 16px;">We regret to inform you that your assignment has been rejected:</p>
                    
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc3545;">
                        <h3 style="color: #721c24; margin: 0 0 10px 0; font-size: 18px;">📚 ${assignment.title}</h3>
                        <p style="color: #721c24; margin: 5px 0;"><strong>Status:</strong> Rejected ❌</p>
                    </div>
                    
                    <p style="color: #333; margin-top: 20px;">Please review the requirements and resubmit your assignment. Check the assignment portal for detailed feedback and guidelines.</p>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Assignment Management System</strong></p>
                    </div>
                </div>
            </div>`;

        await sendMail(assignment.userId.email, emailSubject, emailText, emailHtml);

        return res.status(200).json({ message: 'Assignment rejected successfully.', assignment });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Provide Feedback (Admin or Head)
const provideFeedback = async (req, res) => {
    const { id } = req.params;
    const { feedback } = req.body;
    const { role, name } = req.user;

    console.log('🎯 Providing feedback for assignment ID:', id);
    console.log('💬 Feedback:', feedback);
    console.log('👤 User Role:', role);
    console.log('👤 User Name:', name);

    if (!id) {
        return res.status(400).json({ message: 'Assignment ID is missing in the request.' });
    }

    if (!feedback || feedback.trim() === '') {
        return res.status(400).json({ message: 'Feedback cannot be empty.' });
    }

    try {
        const assignment = await Assignment.findById(id).populate('userId', 'name email');
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        console.log('📋 Assignment found:', {
            title: assignment.title,
            student: assignment.user || assignment.userId?.name,
            studentEmail: assignment.userId?.email
        });

        let updateField = '';
        let feedbackType = '';
        
        if (role === 'Admin' || role === 'admin') {
            updateField = 'feedback.adminFeedback';
            feedbackType = 'Admin';
        } else if (role === 'Head' || role === 'head' || role === 'HOD' || role === 'hod') {
            updateField = 'feedback.headFeedback';
            feedbackType = 'Head';
        } else {
            return res.status(403).json({ 
                message: `You are not authorized to provide feedback. Your role: ${role}` 
            });
        }

        const updateResult = await Assignment.updateOne(
            { _id: id },
            { 
                $set: { [updateField]: feedback.trim() }
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Assignment not found for update' });
        }

        if (updateResult.modifiedCount === 0) {
            return res.status(400).json({ message: 'No changes were made to the assignment' });
        }

        console.log('✅ Feedback updated successfully in database');

        const updatedAssignment = await Assignment.findById(id).populate('userId', 'name email');

        const io = req.app.get('io');
        if (io) {
            io.emit('notification', {
                message: `${feedbackType} feedback added to assignment "${updatedAssignment.title}"`,
                type: 'feedback',
                assignmentId: id
            });
        }

        let emailResult = null;
        const recipientEmail = updatedAssignment.userId?.email;
        const recipientName = updatedAssignment.userId?.name || 'Student';

        if (recipientEmail) {
            console.log('📧 Preparing email notification...');

            const emailSubject = `Feedback Received: ${updatedAssignment.title}`;
            
            const emailText = `Dear ${recipientName},

You have received new feedback on your assignment "${updatedAssignment.title}".

Feedback from ${feedbackType} (${name}):
"${feedback}"

Please check the assignment portal for more details.

Best regards,
Assignment Management System`;

            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 24px;">📋 Assignment Feedback</h2>
                    </div>
                    
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Dear <strong>${recipientName}</strong>,</p>
                        
                        <p style="color: #333; font-size: 16px;">You have received new feedback on your assignment:</p>
                        
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #667eea;">
                            <h3 style="color: #333; margin: 0 0 10px 0; font-size: 18px;">📚 ${updatedAssignment.title}</h3>
                            <p style="color: #666; margin: 5px 0;"><strong>Feedback from:</strong> ${feedbackType} (${name})</p>
                        </div>
                        
                        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <h4 style="color: #856404; margin: 0 0 10px 0;">💬 Feedback:</h4>
                            <p style="color: #856404; font-style: italic; margin: 0;">"${feedback}"</p>
                        </div>
                        
                        <p style="color: #333; margin-top: 20px;">Please check the assignment portal for more details and to view all feedback.</p>
                        
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                            <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Assignment Management System</strong></p>
                        </div>
                    </div>
                </div>`;

            try {
                console.log('📧 Calling sendMail function...');
                console.log('📧 sendMail type:', typeof sendMail);
                
                if (typeof sendMail !== 'function') {
                    throw new Error('sendMail is not properly imported as a function');
                }
                
                await sendMail(recipientEmail, emailSubject, emailText, emailHtml);
                console.log('✅ Email notification sent successfully');
                emailResult = { success: true };
                
            } catch (emailError) {
                console.error('❌ Email sending failed but feedback saved:', emailError.message);
                emailResult = { success: false, error: emailError.message };
            }
        } else {
            console.log('⚠️  No email found for user - skipping email notification');
        }

        const responseData = {
            message: 'Feedback added successfully.',
            assignment: updatedAssignment,
            feedback: updatedAssignment.feedback || {},
            emailSent: emailResult?.success || false
        };

        if (emailResult && !emailResult.success) {
            responseData.emailError = emailResult.error || emailResult.reason;
        }

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('❌ Error providing feedback:', error);
        return res.status(500).json({ 
            message: 'Server error while providing feedback', 
            error: error.message 
        });
    }
};

// Registration
const register = async (req, res) => {
    try {
        const { name, email, password, role, username } = req.body;
        console.log(req.body);

        let admin = await Admin.findOne({ email });
        if (admin) return res.status(400).json({ message: 'Admin already exists' });

        admin = new Admin({ name, email, password, role, username });

        const salt = await bcrypt.genSalt(10);  
        admin.password = await bcrypt.hash(password, salt);

        await admin.save();

        return res.status(201).json({
            message: 'Admin registered successfully.',
            admin: {
                id: admin.id,
                name: admin.name,
                email: admin.email,
            },
        });
        

    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
};

// Login (ORIGINAL VERSION - RESTORED)
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const admin = await Admin.findOne({ email });
        if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        const token = generateToken(admin.id, admin.role, admin.name, admin.label);

        return res.status(200).json({
            token,
            admin: {
                id: admin.id,
                name: admin.name,
                role: admin.role,
                email: admin.email,
            },
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
};

// Get Assignments for a Specific Admin
const getAdminAssignmentsByName = async (req, res) => {
    try {
        const { name } = req.user;
         console.log('Admin name:', name); // Debugging: Log the admin name

        if (!name) {
            return res.status(400).json({ message: 'Admin name is required' });
        }

        // Find assignments by admin's name
        const assignments = await Assignment.find({ admin: name }).sort({ createdAt: -1 });

        if (!assignments.length) {
            return res.status(404).json({ message: 'No assignments found for this admin' });
        }

        res.status(200).json(assignments);
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Assignment for Label (UPDATED WITH LABEL MIGRATION)
const uploadAssignmentForLabel = async (req, res) => {
    try {
        const { title, description, label, deadline, deadlineTime } = req.body;

        // Validate fields
        if (!title || !description || !label || !deadline) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        console.log('Request body:', req.body);

        // Parse deadline with time
        let parsedDeadline;
        let hasTimeComponent = false;

        try {
            if (deadlineTime && deadline) {
                // Combine date and time
                const deadlineDateTime = `${deadline}T${deadlineTime}`;
                parsedDeadline = new Date(deadlineDateTime);
                hasTimeComponent = true;
                console.log(`📅 Combined deadline: ${deadlineDateTime} -> ${parsedDeadline}`);
            } else if (deadline.includes('T')) {
                // datetime-local format
                parsedDeadline = new Date(deadline);
                hasTimeComponent = true;
                console.log(`📅 DateTime deadline: ${deadline} -> ${parsedDeadline}`);
            } else {
                // Just date - set to end of day
                parsedDeadline = parseDeadlineWithTime(deadline);
                hasTimeComponent = false;
                console.log(`📅 Date-only deadline: ${deadline} -> ${parsedDeadline}`);
            }

            if (isNaN(parsedDeadline.getTime())) {
                throw new Error('Invalid date');
            }
        } catch (error) {
            console.error('❌ Deadline parsing error:', error);
            return res.status(400).json({ message: 'Invalid deadline format' });
        }

        // Check if deadline is in the future
        if (parsedDeadline <= new Date()) {
            return res.status(400).json({ message: 'Deadline must be in the future' });
        }

        // Create admin assignment
        const adminAssignment = new AdminAssignment({
            admin: req.user.name,
            title,
            description,
            label,
            deadline: parsedDeadline,
            hasTimeComponent, // Explicitly set for new assignments
            createdAt: new Date(),
        });

        await adminAssignment.save();
        console.log('✅ Admin assignment created:', {
            title: adminAssignment.title,
            deadline: adminAssignment.deadline,
            hasTimeComponent: adminAssignment.hasTimeComponent,
            formattedDeadline: hasTimeComponent 
                ? adminAssignment.deadline.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
                : adminAssignment.deadline.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
        });

        // Find users by label using migration-aware function
        const users = await findUsersByLabel(label);
        if (users.length === 0) {
            return res.status(404).json({ message: 'No users found with this label.' });
        }

        console.log(`👥 Found ${users.length} users for assignment notification`);

        // Send email notifications with time information
        try {
            const deadlineText = hasTimeComponent 
                ? parsedDeadline.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
                : parsedDeadline.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

            const emailPromises = users.map((user) => {
                const emailSubject = 'New Assignment Assigned';
                const emailText = `Hello ${user.name},\n\nA new assignment titled "${title}" has been assigned to you. The deadline for submission is ${deadlineText}. Please check the platform for more details.\n\nBest regards,\nAdmin Team`;
                
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                        <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                            <h2 style="margin: 0; font-size: 24px;">📝 New Assignment Assigned</h2>
                        </div>
                        
                        <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                            
                            <p style="color: #333; font-size: 16px;">A new assignment has been assigned to you:</p>
                            
                            <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #007bff;">
                                <h3 style="color: #0c5460; margin: 0 0 10px 0; font-size: 18px;">📚 ${title}</h3>
                                <p style="color: #0c5460; margin: 5px 0;"><strong>Description:</strong> ${description}</p>
                                <p style="color: #0c5460; margin: 5px 0;"><strong>Category:</strong> ${label}</p>
                                <p style="color: #dc3545; margin: 5px 0; font-weight: bold;">
                                    <strong>⏰ Deadline:</strong> ${deadlineText}
                                    ${hasTimeComponent ? ' (Specific time)' : ' (End of day)'}
                                </p>
                            </div>
                            
                            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                <p style="color: #856404; margin: 0;">
                                    <strong>⚠️ Important:</strong> Please submit your assignment before the deadline to avoid any penalties.
                                    ${hasTimeComponent ? ' Please note the specific time requirement.' : ' Submissions accepted until end of day.'}
                                </p>
                            </div>
                            
                            <p style="color: #333; margin-top: 20px;">Please check the assignment platform for more details and to submit your work.</p>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                                <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Admin Team</strong></p>
                            </div>
                        </div>
                    </div>`;
                
                return sendMail(user.email, emailSubject, emailText, emailHtml);
            });

            await Promise.all(emailPromises);
            console.log('✅ Assignment notification emails sent successfully');
        } catch (emailError) {
            console.error('❌ Error sending assignment emails:', emailError.message);
        }

        res.status(201).json({ 
            message: 'Assignment uploaded and users notified successfully.',
            assignment: {
                ...adminAssignment.toObject(),
                formattedDeadline: hasTimeComponent 
                    ? adminAssignment.deadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : adminAssignment.deadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })
            }
        });
    } catch (error) {
        console.error('❌ Error uploading assignment:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Notes for Label (UPDATED WITH LABEL MIGRATION)
const uploadNotesForLabel = async (req, res) => {
    try {
        const { title, description, label } = req.body;

        // Validate fields
        if (!title || !description || !label) {
            return res.status(400).json({ message: 'Title, description, and label are required' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'File upload failed or file is missing.' });
        }

        console.log('Notes upload request body:', req.body);
        console.log('Cloudinary file details:', req.file);

        // Create admin notes
        const adminNotes = new AdminNotes({
            admin: req.user.name,
            title,
            description,
            label,
            fileUrl: req.file.path,
            filePath: req.file.path,
            createdAt: new Date(),
        });

        await adminNotes.save();
        console.log('Admin notes created:', adminNotes);

        // Find users by label using migration-aware function
        const users = await findUsersByLabel(label);
        if (users.length === 0) {
            return res.status(404).json({ message: 'No users found with this label.' });
        }

        console.log('Users found for notes:', users);

        // Send email notifications
        try {
            const emailPromises = users.map((user) => {
                const emailSubject = 'New Notes Available';
                const emailText = `Hello ${user.name},\n\nNew notes titled "${title}" have been uploaded for you. Please check the platform to access the notes.\n\nBest regards,\nAdmin Team`;
                
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                        <div style="background: linear-gradient(135deg, #17a2b8 0%, #138496 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                            <h2 style="margin: 0; font-size: 24px;">📄 New Notes Available</h2>
                        </div>
                        
                        <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                            
                            <p style="color: #333; font-size: 16px;">New study notes have been uploaded for you:</p>
                            
                            <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
                                <h3 style="color: #0c5460; margin: 0 0 10px 0; font-size: 18px;">📚 ${title}</h3>
                                <p style="color: #0c5460; margin: 5px 0;"><strong>Description:</strong> ${description}</p>
                                <p style="color: #0c5460; margin: 5px 0;"><strong>Label:</strong> ${label}</p>
                                <p style="color: #0c5460; margin: 5px 0;"><strong>File:</strong> Available for download</p>
                            </div>
                            
                            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                <p style="color: #155724; margin: 0;"><strong>💡 Tip:</strong> Download and review these notes to enhance your understanding of the subject.</p>
                            </div>
                            
                            <p style="color: #333; margin-top: 20px;">Please check the platform to access and download the notes.</p>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                                <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Admin Team</strong></p>
                            </div>
                        </div>
                    </div>`;
                
                return sendMail(user.email, emailSubject, emailText, emailHtml);
            });

            await Promise.all(emailPromises);
            console.log('Notes notification emails sent successfully');
        } catch (emailError) {
            console.error('Error sending notes emails:', emailError.message);
        }

        res.status(201).json({ message: 'Notes uploaded and users notified successfully.' });
    } catch (error) {
        console.error('Error uploading notes:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Lecture for Label (UPDATED WITH LABEL MIGRATION)
const uploadLectureForLabel = async (req, res) => {
    try {
        const { title, description, label } = req.body;

        // Validate fields
        if (!title || !description || !label) {
            return res.status(400).json({ message: 'Title, description, and label are required' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Video file upload failed or file is missing.' });
        }

        console.log('Lecture upload request body:', req.body);
        console.log('Cloudinary file details:', req.file);

        // Create admin lecture
        const adminLecture = new AdminLecture({
            admin: req.user.name,
            title,
            description,
            label,
            fileUrl: req.file.path,
            filePath: req.file.path,
            createdAt: new Date(),
        });

        await adminLecture.save();
        console.log('Admin lecture created:', adminLecture);

        // Find users by label using migration-aware function
        const users = await findUsersByLabel(label);
        if (users.length === 0) {
            return res.status(404).json({ message: 'No users found with this label.' });
        }

        console.log('Users found for lecture:', users);

        // Send email notifications
        try {
            const emailPromises = users.map((user) => {
                const emailSubject = 'New Video Lecture Available';
                const emailText = `Hello ${user.name},\n\nA new video lecture titled "${title}" has been uploaded for you. Please check the platform to watch the lecture.\n\nBest regards,\nAdmin Team`;
                
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                        <div style="background: linear-gradient(135deg, #fd7e14 0%, #e55a4e 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                            <h2 style="margin: 0; font-size: 24px;">🎥 New Video Lecture Available</h2>
                        </div>
                        
                        <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                            
                            <p style="color: #333; font-size: 16px;">A new video lecture has been uploaded for you:</p>
                            
                            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #fd7e14;">
                                <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 18px;">🎬 ${title}</h3>
                                <p style="color: #856404; margin: 5px 0;"><strong>Description:</strong> ${description}</p>
                                <p style="color: #856404; margin: 5px 0;"><strong>Label:</strong> ${label}</p>
                                <p style="color: #856404; margin: 5px 0;"><strong>Type:</strong> Video Lecture</p>
                            </div>
                            
                            <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                <p style="color: #0c5460; margin: 0;"><strong>🎓 Learning Tip:</strong> Take notes while watching the lecture and don't hesitate to replay sections for better understanding.</p>
                            </div>
                            
                            <p style="color: #333; margin-top: 20px;">Please check the platform to watch the video lecture and enhance your learning experience.</p>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                                <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Admin Team</strong></p>
                            </div>
                        </div>
                    </div>`;
                
                return sendMail(user.email, emailSubject, emailText, emailHtml);
            });

            await Promise.all(emailPromises);
            console.log('Lecture notification emails sent successfully');
        } catch (emailError) {
            console.error('Error sending lecture emails:', emailError.message);
        }

        res.status(201).json({ message: 'Lecture uploaded and users notified successfully.' });
    } catch (error) {
        console.error('Error uploading lecture:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Test for Label (UPDATED WITH LABEL MIGRATION)
const uploadTestForLabel = async (req, res) => {
    try {
        const { title, description, label, testUrl, deadline, deadlineTime } = req.body;

        // Validate fields
        if (!title || !description || !label || !testUrl || !deadline) {
            return res.status(400).json({ message: 'All fields are required for test upload' });
        }

        console.log('Test upload request body:', req.body);

        // Parse deadline with time
        let parsedDeadline;
        let hasTimeComponent = false;

        try {
            if (deadlineTime && deadline) {
                // Combine date and time
                const deadlineDateTime = `${deadline}T${deadlineTime}`;
                parsedDeadline = new Date(deadlineDateTime);
                hasTimeComponent = true;
                console.log(`📅 Combined test deadline: ${deadlineDateTime} -> ${parsedDeadline}`);
            } else if (deadline.includes('T')) {
                // datetime-local format
                parsedDeadline = new Date(deadline);
                hasTimeComponent = true;
                console.log(`📅 DateTime test deadline: ${deadline} -> ${parsedDeadline}`);
            } else {
                // Just date - set to end of day
                parsedDeadline = parseDeadlineWithTime(deadline);
                hasTimeComponent = false;
                console.log(`📅 Date-only test deadline: ${deadline} -> ${parsedDeadline}`);
            }

            if (isNaN(parsedDeadline.getTime())) {
                throw new Error('Invalid date');
            }
        } catch (error) {
            console.error('❌ Test deadline parsing error:', error);
            return res.status(400).json({ message: 'Invalid deadline format' });
        }

        // Check if deadline is in the future
        if (parsedDeadline <= new Date()) {
            return res.status(400).json({ message: 'Test deadline must be in the future' });
        }

        // Validate test URL
        try {
            new URL(testUrl);
        } catch (urlError) {
            return res.status(400).json({ message: 'Invalid test URL format' });
        }

        // Create admin test
        const adminTest = new AdminTest({
            admin: req.user.name,
            title,
            description,
            label,
            testUrl,
            deadline: parsedDeadline,
            hasTimeComponent, // Add time component tracking for tests too
            createdAt: new Date(),
        });

        await adminTest.save();
        console.log('✅ Admin test created:', {
            title: adminTest.title,
            testUrl: adminTest.testUrl,
            deadline: adminTest.deadline,
            hasTimeComponent: adminTest.hasTimeComponent,
            formattedDeadline: hasTimeComponent 
                ? adminTest.deadline.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
                : adminTest.deadline.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
        });

        // Find users by label using migration-aware function
        const users = await findUsersByLabel(label);
        if (users.length === 0) {
            return res.status(404).json({ message: 'No users found with this label.' });
        }

        console.log(`👥 Found ${users.length} users for test notification`);

        // Send email notifications with time information
        try {
            const deadlineText = hasTimeComponent 
                ? parsedDeadline.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                })
                : parsedDeadline.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

            const emailPromises = users.map((user) => {
                const emailSubject = 'New Test Assigned';
                const emailText = `Hello ${user.name},\n\nA new test titled "${title}" has been assigned to you. The deadline for completion is ${deadlineText}. Please check the platform to take the test.\n\nTest Link: ${testUrl}\n\nBest regards,\nAdmin Team`;
                
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                        <div style="background: linear-gradient(135deg, #6f42c1 0%, #6610f2 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                            <h2 style="margin: 0; font-size: 24px;">📝 New Test Assigned</h2>
                        </div>
                        
                        <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                            
                            <p style="color: #333; font-size: 16px;">A new test has been assigned to you:</p>
                            
                            <div style="background: #e2e3f3; border: 1px solid #c6c8e8; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #6f42c1;">
                                <h3 style="color: #4a2c70; margin: 0 0 10px 0; font-size: 18px;">📋 ${title}</h3>
                                <p style="color: #4a2c70; margin: 5px 0;"><strong>Description:</strong> ${description}</p>
                                <p style="color: #4a2c70; margin: 5px 0;"><strong>Category:</strong> ${label}</p>
                                <p style="color: #dc3545; margin: 5px 0; font-weight: bold;">
                                    <strong>⏰ Deadline:</strong> ${deadlineText}
                                    ${hasTimeComponent ? ' (Specific time)' : ' (End of day)'}
                                </p>
                            </div>
                            
                            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                <p style="color: #155724; margin: 0 0 10px 0;"><strong>🔗 Test Link:</strong></p>
                                <a href="${testUrl}" style="color: #155724; text-decoration: underline; word-break: break-all; font-weight: bold;">${testUrl}</a>
                            </div>
                            
                            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                <p style="color: #721c24; margin: 0;">
                                    <strong>⚠️ Important:</strong> Please complete the test before the deadline. 
                                    ${hasTimeComponent ? 'Note the specific time requirement.' : 'Submissions accepted until end of day.'} 
                                    Late submissions may not be accepted.
                                </p>
                            </div>
                            
                            <p style="color: #333; margin-top: 20px;">Click the link above to access the test and submit your responses before the deadline.</p>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                                <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Admin Team</strong></p>
                            </div>
                        </div>
                    </div>`;
                
                return sendMail(user.email, emailSubject, emailText, emailHtml);
            });

            await Promise.all(emailPromises);
            console.log('✅ Test notification emails sent successfully');
        } catch (emailError) {
            console.error('❌ Error sending test emails:', emailError.message);
        }

        res.status(201).json({ 
            message: 'Test uploaded and users notified successfully.',
            test: {
                ...adminTest.toObject(),
                formattedDeadline: hasTimeComponent 
                    ? adminTest.deadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : adminTest.deadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })
            }
        });
    } catch (error) {
        console.error('❌ Error uploading test:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
};


// Get All Admin Content by Type
const getAdminContentByType = async (req, res) => {
    try {
        const { type } = req.params;
        const { name } = req.user;

        if (!name) {
            return res.status(400).json({ message: 'Admin name is required' });
        }

        let content = [];
        
        switch (type) {
            case 'assignments':
                content = await AdminAssignment.find({ admin: name }).sort({ createdAt: -1 });
                break;
            case 'notes':
                content = await AdminNotes.find({ admin: name }).sort({ createdAt: -1 });
                break;
            case 'lectures':
                content = await AdminLecture.find({ admin: name }).sort({ createdAt: -1 });
                break;
            case 'tests':
                content = await AdminTest.find({ admin: name }).sort({ createdAt: -1 });
                break;
            default:
                return res.status(400).json({ message: 'Invalid content type' });
        }

        res.status(200).json(content);
    } catch (error) {
        console.error('Error fetching admin content:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// REMINDER MANAGEMENT FUNCTIONS
const manualReminderTrigger = async (req, res) => {
    try {
        console.log('🧪 Manual reminder trigger initiated by admin');
        await AssignmentReminderService.sendTestReminder();
        res.json({ 
            message: 'Manual reminder check completed successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error in manual reminder trigger:', error);
        res.status(500).json({ 
            error: error.message,
            message: 'Failed to trigger manual reminder check'
        });
    }
};

const resetWarningFlags = async (req, res) => {
    try {
        console.log('🔄 Resetting warning flags for all assignments');
        const result = await AdminAssignment.updateMany(
            {},
            { 
                $unset: { 
                    warningEmailSent: 1,
                    sentWarningEmails: 1 
                }
            }
        );
        
        console.log(`✅ Reset warning flags for ${result.modifiedCount} assignments`);
        res.json({ 
            message: 'Warning flags reset successfully',
            modifiedCount: result.modifiedCount,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error resetting warning flags:', error);
        res.status(500).json({ 
            error: error.message,
            message: 'Failed to reset warning flags'
        });
    }
};

const getUpcomingDeadlines = async (req, res) => {
    try {
        const now = new Date();
        const in48Hours = new Date(now.getTime() + (48 * 60 * 60 * 1000));
        
        console.log('📅 Fetching assignments with deadlines in next 48 hours');
        
        const upcomingAssignments = await AdminAssignment.find({
            deadline: {
                $gte: now,
                $lte: in48Hours
            }
        }).sort({ deadline: 1 });
        
        // Add time remaining calculation
        const assignmentsWithTimeRemaining = upcomingAssignments.map(assignment => {
            const timeUntilDeadline = assignment.deadline.getTime() - now.getTime();
            const hoursRemaining = Math.floor(timeUntilDeadline / (1000 * 60 * 60));
            const minutesRemaining = Math.floor((timeUntilDeadline % (1000 * 60 * 60)) / (1000 * 60));
            
            return {
                ...assignment.toObject(),
                timeRemaining: {
                    hours: hoursRemaining,
                    minutes: minutesRemaining,
                    formatted: `${hoursRemaining}h ${minutesRemaining}m`
                }
            };
        });
        
        console.log(`📋 Found ${upcomingAssignments.length} upcoming assignments`);
        
        res.json({
            count: upcomingAssignments.length,
            assignments: assignmentsWithTimeRemaining,
            searchPeriod: {
                from: now.toISOString(),
                to: in48Hours.toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Error fetching upcoming deadlines:', error);
        res.status(500).json({ 
            error: error.message,
            message: 'Failed to fetch upcoming deadlines'
        });
    }
};

module.exports = {
    // Profile management functions
    getAdminProfile,
    updateAdminProfile,
    changeAdminPassword,
    sendAdminResetOTP,
    verifyAdminResetOTP,
    resetAdminPassword,
    
    // Existing functions
    acceptAssignment,
    rejectAssignment,
    provideFeedback,
    register,
    login,
    uploadAssignmentForLabel,
    uploadNotesForLabel,
    uploadLectureForLabel,
    uploadTestForLabel,
    getAdminAssignmentsByName,
    getAdminContentByType,
    manualReminderTrigger,
    resetWarningFlags,
    getUpcomingDeadlines,
};