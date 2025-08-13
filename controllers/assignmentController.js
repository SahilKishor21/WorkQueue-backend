const Assignment = require('../models/assignmentModel');
const AdminAssignment = require('../models/adminAssignmentModel');
const User = require('../models/userModels');
const sendMail = require('../config/emailService');

// MIGRATION Helper function to handle deadline time component migration for AdminAssignments
const getAdminAssignmentWithMigration = async (assignment) => {
    try {
        // Check if assignment needs migration
        if (assignment.hasTimeComponent === undefined || assignment.hasTimeComponent === null) {
            console.log(`🔄 Migrating admin assignment: ${assignment.title}`);
            
            let hasTimeComponent = false;
            
            if (assignment.deadline) {
                const deadlineDate = new Date(assignment.deadline);
                
                // Check if the time is exactly midnight (00:00:00) or end of day (23:59:xx)
                const hours = deadlineDate.getHours();
                const minutes = deadlineDate.getMinutes();
                const seconds = deadlineDate.getSeconds();
                
                // If time is not 00:00:00 and not 23:59:xx, it likely has a specific time
                if (!(hours === 0 && minutes === 0 && seconds === 0) && 
                    !(hours === 23 && minutes === 59)) {
                    hasTimeComponent = true;
                }
                
                // Additional check: if deadline was stored with specific time
                const originalDeadlineString = assignment.deadline.toString();
                if (originalDeadlineString.includes('T') && 
                    !originalDeadlineString.endsWith('T00:00:00.000Z') &&
                    !originalDeadlineString.includes('T23:59:')) {
                    hasTimeComponent = true;
                }
            }
            
            // Update the assignment with migration
            assignment.hasTimeComponent = hasTimeComponent;
            assignment.updatedAt = new Date();
            await assignment.save();
            
            console.log(`✅ Migrated admin assignment: ${assignment.title} (hasTimeComponent: ${hasTimeComponent})`);
        }
        
        return assignment;
    } catch (error) {
        console.error(`❌ Error migrating admin assignment ${assignment._id}:`, error.message);
        return assignment; // Return original assignment if migration fails
    }
};

// MIGRATION Helper function to find users by label (handles both old and new label formats)
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
        
        return uniqueUsers;
        
    } catch (error) {
        console.error('❌ Error finding users by label:', error);
        return [];
    }
};

// Helper function to parse deadline with time
const parseDeadlineWithTime = (deadlineInput) => {
    try {
        if (deadlineInput instanceof Date) {
            return deadlineInput;
        }
        
        if (typeof deadlineInput === 'string' && deadlineInput.includes('T')) {
            const deadline = new Date(deadlineInput);
            if (!isNaN(deadline.getTime())) {
                return deadline;
            }
        }
        
        if (typeof deadlineInput === 'string') {
            const date = new Date(deadlineInput);
            if (!isNaN(date.getTime())) {
                date.setHours(23, 59, 59, 999);
                return date;
            }
        }
        
        throw new Error('Invalid date format');
    } catch (error) {
        throw new Error('Invalid deadline format');
    }
};

// ==================== EXISTING ASSIGNMENT FUNCTIONS ====================

// Accept Assignment
exports.acceptAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        console.log('Assignment ID:', assignmentId);

        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.status = 'Accepted';
        await assignment.save();

        res.status(200).json({ message: 'Assignment accepted successfully', assignment });
    } catch (error) {
        console.error('Error accepting assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reject Assignment
exports.rejectAssignment = async (req, res) => {
    try {
        const { assignmentId } = req.params;

        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.status = 'Rejected';
        await assignment.save();

        res.status(200).json({ message: 'Assignment rejected successfully', assignment });
    } catch (error) {
        console.error('Error rejecting assignment:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Submit Appeal
exports.submitAppeal = async (req, res) => {
    try {
        const id = req.params.assignmentId; 
        const { subject, description } = req.body;
        console.log('Submitting appeal for assignment ID:', id);
        console.log('Subject:', subject);

        const assignment = await Assignment.findById(id);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        if (assignment.status !== 'Rejected') {
            return res.status(400).json({ message: 'Only rejected assignments can be appealed' });
        }

        assignment.appealStatus = 'Pending';
        assignment.appealDetails = { subject, description };
        await assignment.save();

        res.status(200).json({ message: 'Appeal submitted successfully', assignment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Fetch Feedbacks
exports.fetchFeedbacks = async (req, res) => {
    try {
        const { id } = req.params;
        console.log('🔍 Fetching feedback for assignment ID:', id);

        if (!id) {
            return res.status(400).json({ message: 'Assignment ID is required.' });
        }

        // Validate MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            console.log('❌ Invalid ObjectId format:', id);
            return res.status(400).json({ message: 'Invalid assignment ID format.' });
        }

        const assignment = await Assignment.findById(id);
        if (!assignment) {
            console.log('❌ Assignment not found for ID:', id);
            return res.status(404).json({ message: 'Assignment not found' });
        }

        console.log('✅ Assignment found:', {
            id: assignment._id,
            title: assignment.title,
            hasFeedback: !!assignment.feedback,
            feedbackKeys: assignment.feedback ? Object.keys(assignment.feedback) : 'No feedback object'
        });

        // Safe access to feedback fields with fallbacks
        const feedback = {
            adminFeedback: assignment.feedback?.adminFeedback || null,
            headFeedback: assignment.feedback?.headFeedback || null,
        };

        console.log('📋 Returning feedback:', feedback);

        res.status(200).json({ feedback });
        
    } catch (error) {
        console.error('❌ Error fetching feedbacks:', error);
        
        // Handle specific MongoDB errors
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid assignment ID format.' });
        }
        
        res.status(500).json({ 
            message: 'Failed to fetch feedbacks', 
            error: error.message 
        });
    }
};

// ==================== NEW DEADLINE MANAGEMENT FUNCTIONS ====================

// Change Assignment Deadline (HEAD/HOD Only) - WITH MIGRATION SUPPORT
exports.changeAssignmentDeadline = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { newDeadline, reason } = req.body;
        const { role, name } = req.user;

        console.log('🔄 Changing deadline for assignment:', assignmentId);
        console.log('👤 User Role:', role);
        console.log('📅 New Deadline:', newDeadline);

        // Auth middleware already checked role, but double-check for Head
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can change assignment deadlines' 
            });
        }

        if (!assignmentId) {
            return res.status(400).json({ message: 'Assignment ID is required' });
        }

        if (!newDeadline) {
            return res.status(400).json({ message: 'New deadline is required' });
        }

        // Parse new deadline
        let parsedNewDeadline;
        let hasTimeComponent = false;

        try {
            if (newDeadline.includes('T')) {
                parsedNewDeadline = new Date(newDeadline);
                hasTimeComponent = true;
            } else {
                parsedNewDeadline = parseDeadlineWithTime(newDeadline);
                hasTimeComponent = false;
            }

            if (isNaN(parsedNewDeadline.getTime())) {
                throw new Error('Invalid date');
            }
        } catch (error) {
            return res.status(400).json({ message: 'Invalid deadline format' });
        }

        if (parsedNewDeadline <= new Date()) {
            return res.status(400).json({ message: 'New deadline must be in the future' });
        }

        // Find the assignment and apply migration if needed
        let assignment = await AdminAssignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Apply migration to the assignment
        assignment = await getAdminAssignmentWithMigration(assignment);

        // Store old deadline for history
        const oldDeadline = assignment.deadline;
        const oldHasTimeComponent = assignment.hasTimeComponent;

        // Update assignment deadline with history tracking
        assignment.deadlineHistory.push({
            oldDeadline,
            newDeadline: parsedNewDeadline,
            changedBy: name,
            changedAt: new Date(),
            reason: reason || 'No reason provided'
        });

        assignment.deadline = parsedNewDeadline;
        assignment.hasTimeComponent = hasTimeComponent;
        assignment.updatedAt = new Date();
        
        await assignment.save();

        console.log('✅ Assignment deadline updated successfully');

        // Find users by label to notify them
        const users = await findUsersByLabel(assignment.label);
        
        // Send email notifications about deadline change
        if (users.length > 0) {
            try {
                const oldDeadlineText = oldHasTimeComponent 
                    ? oldDeadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : oldDeadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });

                const newDeadlineText = hasTimeComponent 
                    ? parsedNewDeadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : parsedNewDeadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });

                const emailPromises = users.map((user) => {
                    const emailSubject = `Assignment Deadline Changed: ${assignment.title}`;
                    const emailText = `Hello ${user.name},\n\nThe deadline for assignment "${assignment.title}" has been changed.\n\nOld Deadline: ${oldDeadlineText}\nNew Deadline: ${newDeadlineText}\n\nReason: ${reason || 'No reason provided'}\n\nPlease plan accordingly.\n\nBest regards,\n${name}\nHead of Department`;
                    
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                            <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                                <h2 style="margin: 0; font-size: 24px;">⏰ Assignment Deadline Changed</h2>
                            </div>
                            
                            <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                                
                                <p style="color: #333; font-size: 16px;">The deadline for your assignment has been updated:</p>
                                
                                <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                                    <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 18px;">📚 ${assignment.title}</h3>
                                    <p style="color: #856404; margin: 5px 0;"><strong>Changed by:</strong> ${name} (Head of Department)</p>
                                </div>
                                
                                <div style="background: #fee2e2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                        <div style="text-align: center; flex: 1;">
                                            <p style="margin: 0; color: #991b1b; font-size: 14px;">Previous Deadline</p>
                                            <p style="margin: 5px 0 0 0; font-weight: bold; color: #dc2626; font-size: 16px;">${oldDeadlineText}</p>
                                        </div>
                                        <div style="color: #991b1b; font-size: 24px; margin: 0 20px;">→</div>
                                        <div style="text-align: center; flex: 1;">
                                            <p style="margin: 0; color: #991b1b; font-size: 14px;">New Deadline</p>
                                            <p style="margin: 5px 0 0 0; font-weight: bold; color: #dc2626; font-size: 16px;">${newDeadlineText}</p>
                                        </div>
                                    </div>
                                </div>
                                
                                ${reason ? `
                                <div style="background: #e0f2fe; border: 1px solid #b3e5fc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                    <p style="color: #01579b; margin: 0;"><strong>📝 Reason:</strong> ${reason}</p>
                                </div>
                                ` : ''}
                                
                                <div style="background: #fef3c7; border: 1px solid #fde68a; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                    <p style="color: #92400e; margin: 0;"><strong>⚠️ Important:</strong> Please adjust your schedule accordingly and ensure timely submission.</p>
                                </div>
                                
                                <p style="color: #333; margin-top: 20px;">Please check the assignment platform for the updated deadline.</p>
                                
                                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                                    <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>${name}</strong><br>Head of Department</p>
                                </div>
                            </div>
                        </div>`;
                    
                    return sendMail(user.email, emailSubject, emailText, emailHtml);
                });

                await Promise.all(emailPromises);
                console.log('✅ Deadline change notification emails sent successfully');
            } catch (emailError) {
                console.error('❌ Error sending deadline change emails:', emailError.message);
            }
        }

        res.status(200).json({
            message: 'Assignment deadline updated successfully',
            assignment: {
                ...assignment.toObject(),
                formattedDeadline: assignment.hasTimeComponent 
                    ? assignment.deadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : assignment.deadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })
            },
            deadlineChange: {
                oldDeadline: oldDeadlineText,
                newDeadline: newDeadlineText,
                changedBy: name
            }
        });

    } catch (error) {
        console.error('❌ Error changing assignment deadline:', error);
        res.status(500).json({ 
            message: 'Server error while changing deadline', 
            error: error.message 
        });
    }
};

// Get Assignment Deadline History - WITH MIGRATION SUPPORT
exports.getAssignmentDeadlineHistory = async (req, res) => {
    try {
        const { assignmentId } = req.params;

        let assignment = await AdminAssignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Apply migration to the assignment
        assignment = await getAdminAssignmentWithMigration(assignment);

        res.status(200).json({
            assignment: {
                id: assignment._id,
                title: assignment.title,
                currentDeadline: assignment.deadline,
                formattedDeadline: assignment.hasTimeComponent 
                    ? assignment.deadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : assignment.deadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    }),
                hasTimeComponent: assignment.hasTimeComponent
            },
            deadlineHistory: assignment.deadlineHistory || []
        });
    } catch (error) {
        console.error('Error fetching deadline history:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get Upcoming Deadlines - WITH MIGRATION SUPPORT
exports.getUpcomingDeadlines = async (req, res) => {
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
        
        // Apply migration to all upcoming assignments
        const migratedAssignments = [];
        for (const assignment of upcomingAssignments) {
            const migratedAssignment = await getAdminAssignmentWithMigration(assignment);
            migratedAssignments.push(migratedAssignment);
        }
        
        // Add time remaining calculation
        const assignmentsWithTimeRemaining = migratedAssignments.map(assignment => {
            const timeUntilDeadline = assignment.deadline.getTime() - now.getTime();
            const hoursRemaining = Math.floor(timeUntilDeadline / (1000 * 60 * 60));
            const minutesRemaining = Math.floor((timeUntilDeadline % (1000 * 60 * 60)) / (1000 * 60));
            
            return {
                ...assignment.toObject(),
                timeRemaining: {
                    hours: hoursRemaining,
                    minutes: minutesRemaining,
                    formatted: `${hoursRemaining}h ${minutesRemaining}m`
                },
                formattedDeadline: assignment.hasTimeComponent 
                    ? assignment.deadline.toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    })
                    : assignment.deadline.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })
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

// Get All Admin Assignments with Migration Support
exports.getAllAdminAssignments = async (req, res) => {
    try {
        const assignments = await AdminAssignment.find({}).sort({ createdAt: -1 });
        
        // Apply migration to all assignments
        const migratedAssignments = [];
        for (const assignment of assignments) {
            const migratedAssignment = await getAdminAssignmentWithMigration(assignment);
            migratedAssignments.push(migratedAssignment);
        }
        
        res.status(200).json(migratedAssignments);
    } catch (error) {
        console.error('Error fetching admin assignments:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get Admin Assignments by Label with Migration Support
exports.getAdminAssignmentsByLabel = async (req, res) => {
    try {
        const { label } = req.params;
        
        if (!label) {
            return res.status(400).json({ message: 'Label is required' });
        }
        
        const assignments = await AdminAssignment.find({ label }).sort({ createdAt: -1 });
        
        // Apply migration to all assignments
        const migratedAssignments = [];
        for (const assignment of assignments) {
            const migratedAssignment = await getAdminAssignmentWithMigration(assignment);
            migratedAssignments.push(migratedAssignment);
        }
        
        res.status(200).json(migratedAssignments);
    } catch (error) {
        console.error('Error fetching assignments by label:', error);
        res.status(500).json({ message: 'Server error' });
    }
};