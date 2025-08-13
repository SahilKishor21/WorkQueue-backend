const User = require('../models/userModels');
const Admin = require('../models/adminModel');
const Assignment = require('../models/assignmentModel');
const AdminAssignment = require('../models/adminAssignmentModel');
const AdminNotes = require('../models/adminNotesModel');
const AdminLecture = require('../models/adminLectureModel');
const AdminTest = require('../models/adminTestModel');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendMail = require('../config/emailService');
const { registerValidation, loginValidation } = require('../validators/userValidator');

const generateToken = (id, name, role, labels) => {
    // For backward compatibility, send first label as 'label'
    const label = labels && labels.length > 0 ? labels[0] : '';
    return jwt.sign({ id, name, role, label, labels }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper function to normalize labels for matching
const normalizeLabel = (label) => {
    return label.trim().toLowerCase();
};

// HELPER FUNCTION: Ensure user has correct labels format (for migration scenarios)
const ensureUserLabelsFormat = async (userId, userLabelsFromJWT) => {
    try {
        console.log(`🔍 Ensuring correct labels format for user: ${userId}`);
        
        // Get fresh user data from database
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found in database');
            return userLabelsFromJWT || [];
        }

        let finalLabels = [];

        // Get labels from the labels array (new format)
        if (user.labels && Array.isArray(user.labels) && user.labels.length > 0) {
            finalLabels = [...user.labels];
            console.log(`✅ User has new format labels: [${finalLabels.join(', ')}]`);
        }
        // Check for old format label field
        else if (user.label && user.label.trim()) {
            console.log(`🔄 User has old format label: "${user.label}", migrating...`);
            
            // Migrate user from old to new format
            user.labels = [user.label];
            user.label = undefined; // Remove old field
            await user.save();
            
            finalLabels = user.labels;
            console.log(`✅ Migrated user to new format: [${finalLabels.join(', ')}]`);
        }
        // Fallback to JWT labels if database doesn't have any
        else if (userLabelsFromJWT && Array.isArray(userLabelsFromJWT) && userLabelsFromJWT.length > 0) {
            finalLabels = userLabelsFromJWT;
            console.log(`📋 Using labels from JWT: [${finalLabels.join(', ')}]`);
        }

        // Remove duplicates and empty values
        finalLabels = [...new Set(finalLabels.filter(label => label && label.trim()))];
        
        console.log(`✅ Final labels for user ${userId}: [${finalLabels.join(', ')}]`);
        return finalLabels;
        
    } catch (error) {
        console.error('Error ensuring user labels format:', error);
        return userLabelsFromJWT || [];
    }
};

// Helper function to find flexible label matches
const findFlexibleMatches = async (userLabels, collection) => {
    try {
        // First, let's see what labels actually exist in the database
        const distinctLabels = await collection.distinct('label');
        console.log(`📊 Available labels in ${collection.modelName}:`, distinctLabels);
        
        // Normalize user labels for comparison
        const normalizedUserLabels = userLabels.map(normalizeLabel);
        console.log(`🔍 Normalized user labels:`, normalizedUserLabels);
        
        // Try exact match first
        let content = await collection.find({ 
            label: { $in: userLabels } 
        });
        
        if (content.length > 0) {
            console.log(`✅ Found ${content.length} items with exact match`);
            return content;
        }
        
        // If no exact match, try case-insensitive match
        console.log(`⚠️ No exact matches found, trying case-insensitive search...`);
        
        const flexibleMatches = [];
        for (const dbLabel of distinctLabels) {
            const normalizedDbLabel = normalizeLabel(dbLabel);
            if (normalizedUserLabels.includes(normalizedDbLabel)) {
                flexibleMatches.push(dbLabel);
                console.log(`🎯 Flexible match found: "${dbLabel}" matches user label`);
            }
        }
        
        if (flexibleMatches.length > 0) {
            content = await collection.find({ 
                label: { $in: flexibleMatches } 
            });
            console.log(`✅ Found ${content.length} items with flexible matching`);
            return content;
        }
        
        console.log(`❌ No matches found for user labels: [${userLabels.join(', ')}]`);
        console.log(`💡 Available database labels: [${distinctLabels.join(', ')}]`);
        
        return [];
        
    } catch (error) {
        console.error(`❌ Error in flexible label search:`, error);
        return [];
    }
};

// User Registration (updated for multiple labels)
exports.register = async (req, res) => {
    try {
        const { name, email, password, label, role, username } = req.body;
        console.log('Request Body:', req.body);

        // Validate input
        const { error } = registerValidation(req.body);
        if (error) return res.status(400).json({ msg: error.details[0].message });

        // Check if email already exists
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });

        // Generate a unique username
        let Username = username || email.split('@')[0];
        if (!Username) {
            return res.status(400).json({ msg: 'Invalid username generated. Please provide a valid email.' });
        }

        let existingUser = await User.findOne({ username: Username });
        let counter = 1;

        // If a user with the same username exists, append a number to make it unique
        while (existingUser) {
            Username = `${email.split('@')[0]}_${counter}`;
            existingUser = await User.findOne({ username: Username });
            counter++;
        } 

        // Create labels array
        const labels = label ? [label] : [];

        // Create new user
        user = new User({
            name,
            email,
            password,
            labels,
            role,
            username: Username,
            lastLogin: new Date()
        });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        // Save user to database
        await user.save();

        res.status(201).json({ msg: 'User registered successfully', user: {
            id: user._id,
            name: user.name,
            email: user.email,
            labels: user.labels,
            role: user.role
        }});
    } catch (err) {
        console.error('Error during registration:', err.message);

        // Handle duplicate key error
        if (err.code === 11000) {
            const duplicateField = Object.keys(err.keyValue)[0];
            return res.status(400).json({ msg: `Duplicate value for ${duplicateField}. Please choose a different value.` });
        }

        res.status(500).send('Server error');
    }
};

// User Login (updated)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        const { error } = loginValidation(req.body);
        if (error) return res.status(400).json({ msg: error.details[0].message });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user.id, user.name, user.role, user.labels);

        res.status(200).json({ 
            user:{
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                labels: user.labels,
                lastLogin: user.lastLogin
            },
            token,
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Get User Profile - UPDATED FOR PROFILE DROPDOWN (UNCHANGED as requested)
exports.getUserProfile = async (req, res) => {
    try {
        console.log('getUserProfile - req.user:', req.user);
        
        const user = await User.findById(req.user.id).select('-password -resetOTP -resetOTPExpires');
        if (!user) {
            console.error('getUserProfile - User not found with ID:', req.user.id);
            return res.status(404).json({ message: 'User not found' });
        }

        console.log('getUserProfile - User found:', user.name);
        console.log('getUserProfile - Raw user data:', user.toObject()); // See all fields
        
        // MIGRATION LOGIC: Handle old 'label' field
        let userLabels = user.labels || [];
        
        // Check if user has old 'label' field but no 'labels' array
        if ((!userLabels || userLabels.length === 0) && user.label) {
            console.log('getUserProfile - Found old label field:', user.label);
            userLabels = [user.label];
            
            // Migrate old label to new labels array
            try {
                user.labels = userLabels;
                user.label = undefined; // Remove old field
                await user.save();
                console.log('getUserProfile - Migrated old label to labels array');
            } catch (migrationError) {
                console.error('Migration error:', migrationError);
                // Continue anyway with the labels we found
            }
        }
        
        console.log('getUserProfile - Final labels:', userLabels);
        console.log('getUserProfile - Labels type:', typeof userLabels);
        console.log('getUserProfile - Labels length:', userLabels.length);

        const profileData = {
            id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            labels: userLabels,
            role: user.role,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            profilePicture: user.profilePicture
        };

        console.log('getUserProfile - Sending profile data:', profileData);

        res.status(200).json({
            profile: profileData
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update User Profile - UPDATED FOR PROFILE DROPDOWN (UNCHANGED)
exports.updateUserProfile = async (req, res) => {
    try {
        const { name, username, profilePicture } = req.body;
        const userId = req.user.id;

        const updateData = {};
        if (name) updateData.name = name;
        if (username) updateData.username = username;
        if (profilePicture) updateData.profilePicture = profilePicture;

        // Check if username is already taken by another user
        if (username) {
            const existingUser = await User.findOne({ 
                username, 
                _id: { $ne: userId } 
            });
            if (existingUser) {
                return res.status(400).json({ message: 'Username already taken' });
            }
        }

        const user = await User.findByIdAndUpdate(
            userId, 
            updateData, 
            { new: true }
        ).select('-password -resetOTP -resetOTPExpires');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate new token with updated info
        const token = generateToken(user.id, user.name, user.role, user.labels);

        res.status(200).json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                username: user.username,
                labels: user.labels,
                role: user.role,
                lastLogin: user.lastLogin,
                profilePicture: user.profilePicture
            },
            token
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Change Password - UPDATED FOR PROFILE DROPDOWN (UNCHANGED)
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedNewPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        user.password = hashedNewPassword;
        await user.save();

        // Send confirmation email
        const emailSubject = 'Password Changed Successfully';
        const emailText = `Hello ${user.name},\n\nYour password has been successfully changed.\n\nIf you did not make this change, please contact support immediately.\n\nBest regards,\nWorkQueue Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">🔒 Password Changed Successfully</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                    
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #28a745;">
                        <p style="color: #155724; margin: 0;"><strong>✅ Your password has been successfully changed.</strong></p>
                    </div>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0;"><strong>⚠️ Security Notice:</strong> If you did not make this change, please contact support immediately.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Team</strong></p>
                    </div>
                </div>
            </div>`;

        try {
            await sendMail(user.email, emailSubject, emailText, emailHtml);
        } catch (emailError) {
            console.error('Error sending password change confirmation email:', emailError);
        }

        res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Add Label - UPDATED FOR PROFILE DROPDOWN (UNCHANGED)
exports.addLabel = async (req, res) => {
    try {
        const { label } = req.body;
        const userId = req.user.id;

        console.log('addLabel - User ID:', userId, 'Label:', label);

        if (!label || label.trim() === '') {
            return res.status(400).json({ message: 'Label is required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if label already exists
        if (user.labels.includes(label)) {
            return res.status(400).json({ message: 'Label already exists' });
        }

        // Add label
        user.labels.push(label);
        await user.save();

        // Generate new token with updated labels
        const token = generateToken(user.id, user.name, user.role, user.labels);

        res.status(200).json({
            message: 'Label added successfully',
            labels: user.labels,
            token
        });
    } catch (error) {
        console.error('Error adding label:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Remove Label - UPDATED FOR PROFILE DROPDOWN (UNCHANGED)
exports.removeLabel = async (req, res) => {
    try {
        const { label } = req.body;
        const userId = req.user.id;

        console.log('removeLabel - User ID:', userId, 'Label:', label);

        if (!label) {
            return res.status(400).json({ message: 'Label is required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if label exists
        if (!user.labels.includes(label)) {
            return res.status(400).json({ message: 'Label not found' });
        }

        // Remove label
        user.labels = user.labels.filter(l => l !== label);
        await user.save();

        // Generate new token with updated labels
        const token = generateToken(user.id, user.name, user.role, user.labels);

        res.status(200).json({
            message: 'Label removed successfully',
            labels: user.labels,
            token
        });
    } catch (error) {
        console.error('Error removing label:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Forgot Password - Send OTP (UNCHANGED)
exports.sendResetOTP = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User with this email does not exist' });
        }

        // Check for rate limiting (max 3 attempts per hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (user.resetOTPExpires > oneHourAgo && user.resetOTPAttempts >= 3) {
            return res.status(429).json({ 
                message: 'Too many reset attempts. Please try again later.' 
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Update user with OTP
        user.resetOTP = otp;
        user.resetOTPExpires = otpExpires;
        user.resetOTPAttempts = (user.resetOTPAttempts || 0) + 1;
        await user.save();

        // Send email
        const emailSubject = 'Password Reset OTP - WorkQueue';
        const emailText = `Hello ${user.name},\n\nYour password reset OTP is: ${otp}\n\nThis OTP will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\nBest regards,\nWorkQueue Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">🔐 Password Reset OTP</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                    
                    <p style="color: #333; font-size: 16px;">You have requested to reset your password. Please use the following OTP:</p>
                    
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
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Team</strong></p>
                    </div>
                </div>
            </div>`;

        await sendMail(user.email, emailSubject, emailText, emailHtml);

        res.status(200).json({ 
            message: 'OTP sent to your email successfully',
            email: email
        });
    } catch (error) {
        console.error('Error sending reset OTP:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Verify OTP (UNCHANGED)
exports.verifyResetOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if OTP is valid and not expired
        if (!user.resetOTP || user.resetOTP !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        if (user.resetOTPExpires < new Date()) {
            return res.status(400).json({ message: 'OTP has expired' });
        }

        // Generate temporary token for password reset
        const resetToken = jwt.sign(
            { id: user._id, purpose: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );

        res.status(200).json({
            message: 'OTP verified successfully',
            resetToken: resetToken
        });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reset Password (UNCHANGED)
exports.resetPassword = async (req, res) => {
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

        if (decoded.purpose !== 'password_reset') {
            return res.status(400).json({ message: 'Invalid reset token' });
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password and clear OTP fields
        user.password = hashedPassword;
        user.resetOTP = undefined;
        user.resetOTPExpires = undefined;
        user.resetOTPAttempts = 0;
        await user.save();

        // Send confirmation email
        const emailSubject = 'Password Reset Successfully - WorkQueue';
        const emailText = `Hello ${user.name},\n\nYour password has been reset successfully.\n\nIf you did not make this change, please contact support immediately.\n\nBest regards,\nWorkQueue Team`;
        
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 24px;">✅ Password Reset Successfully</h2>
                </div>
                
                <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                    
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #28a745;">
                        <p style="color: #155724; margin: 0;"><strong>✅ Your password has been reset successfully!</strong></p>
                    </div>
                    
                    <p style="color: #333; font-size: 16px;">You can now log in with your new password.</p>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0;"><strong>🔐 Security Reminder:</strong> Keep your password secure and don't share it with anyone.</p>
                    </div>
                    
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="color: #721c24; margin: 0;"><strong>⚠️ Important:</strong> If you did not reset your password, please contact support immediately.</p>
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                        <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>WorkQueue Team</strong></p>
                    </div>
                </div>
            </div>`;

        try {
            await sendMail(user.email, emailSubject, emailText, emailHtml);
        } catch (emailError) {
            console.error('Error sending password reset confirmation email:', emailError);
        }

        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Assignment (updated for multiple labels) (UNCHANGED)
exports.uploadAssignment = async (req, res) => {
    try {
        const { title, adminName } = req.body;

        if (!req.file) {
            return res.status(400).json({ message: 'File upload failed or file is missing.' });
        }

        console.log('Cloudinary file details:', req.file);

        const userId = req.user.id;
        const user = req.user.name;
        const labels = req.user.labels || []; // Use multiple labels

        const admin = await Admin.findOne({ name: adminName });
        if (!admin) {
            return res.status(404).json({ message: `Admin with name "${adminName}" not found.` });
        }

        const assignment = new Assignment({
            userId,
            user,
            admin: admin.name,
            title,
            fileUrl: req.file.path,      
            filePath: req.file.path,    
            labels, // Store multiple labels
            createdAt: new Date(),
        });

        await assignment.save();
        
        console.log('Assignment saved:', assignment);
        res.status(201).json({ msg: 'Assignment uploaded successfully', assignment });
    } catch (error) {
        console.error('Error uploading assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Test Response (updated) (UNCHANGED)
exports.uploadTestResponse = async (req, res) => {
    try {
        const { title, adminName, testId } = req.body;

        if (!req.file) {
            return res.status(400).json({ message: 'File upload failed or file is missing.' });
        }

        console.log('Test response file details:', req.file);

        const userId = req.user.id;
        const user = req.user.name;
        const labels = req.user.labels || [];

        const admin = await Admin.findOne({ name: adminName });
        if (!admin) {
            return res.status(404).json({ message: `Admin with name "${adminName}" not found.` });
        }

        // Check if test exists and deadline hasn't passed
        const test = await AdminTest.findById(testId);
        if (!test) {
            return res.status(404).json({ message: 'Test not found.' });
        }

        if (new Date() > new Date(test.deadline)) {
            return res.status(400).json({ message: 'Test deadline has passed.' });
        }

        const testSubmission = new Assignment({
            userId,
            user,
            admin: admin.name,
            title: `Test: ${title}`,
            fileUrl: req.file.path,      
            filePath: req.file.path,    
            labels,
            createdAt: new Date(),
        });

        await testSubmission.save();
        
        console.log('Test response saved:', testSubmission);
        res.status(201).json({ msg: 'Test response uploaded successfully', assignment: testSubmission });
    } catch (error) {
        console.error('Error uploading test response:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// UPDATED: Get Content by Type and Label (with migration support and debugging)
exports.getStudentContentByType = async (req, res) => {
    try {
        const { type } = req.params;
        const userLabelsFromJWT = req.user.labels;
        const userId = req.user.id;

        console.log(`📚 Fetching ${type} for user ${userId}`);
        console.log(`🏷️ Labels from JWT: [${userLabelsFromJWT?.join(', ') || 'none'}]`);

        // Ensure user has correct labels format (with migration if needed)
        const labels = await ensureUserLabelsFormat(userId, userLabelsFromJWT);

        if (!labels || labels.length === 0) {
            console.log(`⚠️ No labels found for user ${userId}`);
            return res.status(400).json({ message: 'User labels are required' });
        }

        console.log(`🔍 Searching for ${type} with labels: [${labels.join(', ')}]`);

        let content = [];
        let collection;
        
        switch (type) {
            case 'assignments':
                collection = AdminAssignment;
                break;
            case 'notes':
                collection = AdminNotes;
                break;
            case 'lectures':
                collection = AdminLecture;
                break;
            case 'tests':
                collection = AdminTest;
                break;
            default:
                return res.status(400).json({ message: 'Invalid content type' });
        }

        // Use flexible matching function
        content = await findFlexibleMatches(labels, collection);
        
        // Sort the results
        if (type === 'assignments' || type === 'tests') {
            content = content.sort((a, b) => {
                // Sort by deadline first, then by creation date
                if (a.deadline && b.deadline) {
                    return new Date(a.deadline) - new Date(b.deadline);
                }
                return new Date(b.createdAt) - new Date(a.createdAt);
            });
        } else {
            content = content.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        console.log(`✅ Final result: Found ${content.length} ${type} for labels [${labels.join(', ')}]`);
        
        // Log some sample results for debugging
        if (content.length > 0) {
            console.log(`📋 Sample results:`, content.slice(0, 2).map(item => ({
                title: item.title,
                label: item.label,
                createdAt: item.createdAt
            })));
        }
        
        res.status(200).json(content);
    } catch (error) {
        console.error('Error fetching student content:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get User Submissions by Type (existing - no changes needed) (UNCHANGED)
exports.getUserSubmissionsByType = async (req, res) => {
    try {
        const { type } = req.params;
        const userId = req.user.id;

        let submissions = [];
        
        if (type === 'assignments') {
            // Get regular assignments (not tests)
            submissions = await Assignment.find({ 
                userId,
                title: { $not: /^Test:/ } // Exclude test submissions
            }).sort({ createdAt: -1 });
        } else if (type === 'tests') {
            // Get test submissions only
            submissions = await Assignment.find({ 
                userId,
                title: /^Test:/ // Only test submissions
            }).sort({ createdAt: -1 });
        }

        res.status(200).json({ submissions });
    } catch (error) {
        console.error('Error fetching user submissions:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// UPDATED: Get Assignments by Label (with migration support and debugging)
exports.fetchAssignmentsByLabel = async (req, res) => {
    try {
        const userLabelsFromJWT = req.user.labels || [];
        const userId = req.user.id;
        
        console.log(`📋 Fetching assignments for user ${userId}`);
        console.log(`🏷️ Labels from JWT: [${userLabelsFromJWT?.join(', ') || 'none'}]`);
        
        // Ensure user has correct labels format (with migration if needed)
        const userLabels = await ensureUserLabelsFormat(userId, userLabelsFromJWT);

        if (!userLabels || userLabels.length === 0) {
            console.log(`⚠️ No labels found for user ${userId}`);
            return res.status(400).json({ message: 'Labels not found for the user.' });
        }

        console.log(`🔍 Searching for assignments with labels: [${userLabels.join(', ')}]`);

        // Use flexible matching function
        const assignments = await findFlexibleMatches(userLabels, AdminAssignment);
        
        // Sort by creation date
        const sortedAssignments = assignments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        console.log(`✅ Found ${sortedAssignments.length} assignments for user ${userId}`);
        
        if (sortedAssignments.length > 0) {
            console.log(`📋 Sample assignments:`, sortedAssignments.slice(0, 2).map(item => ({
                title: item.title,
                label: item.label,
                deadline: item.deadline
            })));
        }
        
        res.status(200).json({ assignments: sortedAssignments });
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DEBUGGING FUNCTION: Add this as a new route to diagnose label issues
exports.debugLabels = async (req, res) => {
    try {
        const userId = req.user.id;
        const userLabelsFromJWT = req.user.labels || [];
        
        console.log(`🔧 DEBUG: Analyzing labels for user ${userId}`);
        
        // Get user's labels
        const userLabels = await ensureUserLabelsFormat(userId, userLabelsFromJWT);
        
        // Get all distinct labels from all collections
        const assignmentLabels = await AdminAssignment.distinct('label');
        const notesLabels = await AdminNotes.distinct('label');
        const lectureLabels = await AdminLecture.distinct('label');
        const testLabels = await AdminTest.distinct('label');
        
        // Combine and deduplicate
        const allDbLabels = [...new Set([
            ...assignmentLabels, 
            ...notesLabels, 
            ...lectureLabels, 
            ...testLabels
        ])];
        
        // Count content for each type
        const assignmentCount = await AdminAssignment.countDocuments();
        const notesCount = await AdminNotes.countDocuments();
        const lectureCount = await AdminLecture.countDocuments();
        const testCount = await AdminTest.countDocuments();
        
        const debugInfo = {
            user: {
                id: userId,
                labelsFromJWT: userLabelsFromJWT,
                finalLabels: userLabels,
                normalizedLabels: userLabels.map(normalizeLabel)
            },
            database: {
                totalContent: {
                    assignments: assignmentCount,
                    notes: notesCount,
                    lectures: lectureCount,
                    tests: testCount
                },
                availableLabels: {
                    all: allDbLabels,
                    assignments: assignmentLabels,
                    notes: notesLabels,
                    lectures: lectureLabels,
                    tests: testLabels
                },
                normalizedDbLabels: allDbLabels.map(normalizeLabel)
            },
            analysis: {
                exactMatches: [],
                flexibleMatches: [],
                possibleIssues: []
            }
        };
        
        // Analyze matches
        const normalizedUserLabels = userLabels.map(normalizeLabel);
        const normalizedDbLabels = allDbLabels.map(normalizeLabel);
        
        // Check for exact matches
        for (const userLabel of userLabels) {
            if (allDbLabels.includes(userLabel)) {
                debugInfo.analysis.exactMatches.push(userLabel);
            }
        }
        
        // Check for flexible matches
        for (const dbLabel of allDbLabels) {
            const normalizedDbLabel = normalizeLabel(dbLabel);
            if (normalizedUserLabels.includes(normalizedDbLabel)) {
                debugInfo.analysis.flexibleMatches.push({
                    userLabel: userLabels.find(ul => normalizeLabel(ul) === normalizedDbLabel),
                    dbLabel: dbLabel
                });
            }
        }
        
        // Identify possible issues
        if (debugInfo.analysis.exactMatches.length === 0 && debugInfo.analysis.flexibleMatches.length === 0) {
            debugInfo.analysis.possibleIssues.push("No label matches found");
        }
        
        if (allDbLabels.length === 0) {
            debugInfo.analysis.possibleIssues.push("No content exists in database");
        }
        
        res.status(200).json(debugInfo);
        
    } catch (error) {
        console.error('Error in debug labels:', error);
        res.status(500).json({ message: 'Debug error', error: error.message });
    }
};

// Get All Admins (existing) (UNCHANGED)
exports.getAllAdmins = async (req, res) => {
    try {
        const admins = await Admin.find({}, 'name email');
        res.json(admins);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Get User Submissions (existing) (UNCHANGED)
exports.getUserSubmissions = async (req, res) => {
    try {
        const userId = req.user.id;

        const submissions = await Assignment.find({ userId });

        if (!submissions || submissions.length === 0) {
            return res.status(404).json({ message: 'No submissions found.' });
        }

        res.status(200).json({ submissions });
    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({ message: 'Server error. Please try again later.' });
    }
};