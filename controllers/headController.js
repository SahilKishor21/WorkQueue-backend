const Head = require('../models/headModel');
const Assignment = require('../models/assignmentModel');
const AdminAssignment = require('../models/adminAssignmentModel');
const Notes = require('../models/adminNotesModel');
const Lectures = require('../models/adminLectureModel');  
const Tests = require('../models/adminTestModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose'); 
const sendMail = require('../config/emailService');

// Generate JWT
const generateToken = (id,role ,name) => {
  return jwt.sign({ id, role, name }, process.env.JWT_SECRET, { expiresIn: '1d' });
}; 

// Register
exports.registerHead = async (req, res) => {
  const { name, email, password, username, role } = req.body; 
  console.log('Request Body:', req.body);

  try {
    if (!name || !email || !password || !username) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (role !== 'Head') {
      return res.status(400).json({ message: 'Invalid role provided for registration' });
    }

    const existingHead = await Head.findOne({ email });
    if (existingHead) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const head = new Head({
      name,
      email,
      password: hashedPassword, 
      username,
    });
    await head.save();
    
    res.status(201).json({
      message: 'Head registered successfully',
      head: {
        id: head._id,
        name: head.name,
        email: head.email,
        username: head.username,
      },
    });
  } catch (error) {
    console.error('Error registering Head:', error.message);
    res.status(500).json({ message: 'Registration failed', details: error.message });
  }
};

// Login
exports.hodLogin = async (req, res) => {
    const { email, password } = req.body;
    console.log('Request Body:', req.body);

    try {
        // Find HOD by email
        const newHead = await Head.findOne({ email });
        if (!newHead) {
            return res.status(404).json({ msg: 'HOD not found' });
        }

        // Compare provided password with stored hashed password
        const isMatch = await bcrypt.compare(password, newHead.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        // Check for an active HOD
        const existingHead = await Head.findOne({ isActive: true });
        if (existingHead && existingHead.email !== email) {
            // If another HOD is active, send an approval request
            const token = jwt.sign(
                { oldHeadId: existingHead._id, newHeadId: newHead._id },
                process.env.JWT_SECRET,
                { expiresIn: '1d' }
            );

            const transporter = nodemailer.createTransport({
                service: 'Gmail',
                auth: {
                    user: process.env.SMTP_EMAIL,
                    pass: process.env.SMTP_PASSWORD,
                },
            });

            const mailOptions = {
                from: process.env.SMTP_EMAIL,
                to: existingHead.email,
                subject: 'HOD Login Request',
                html: `
                    <p>Someone is trying to log in as HOD. Click the button below to approve and log out yourself.</p>
                    <a href="http://localhost:5000/api/head/approve-login/${token}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">Approve Login</a>
                `,
            };

            await transporter.sendMail(mailOptions);
            return res.status(200).json({ msg: 'Login request sent to current HOD for approval.' });
        }

        // If no active HOD or the same HOD is logging in, set them as active
        newHead.isActive = true;
        await newHead.save();

        // Generate JWT for successful login
        const jwtToken = jwt.sign(
            { id: newHead._id, role: 'HOD' },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(200).json({
            msg: 'Login successful',
            token: jwtToken,
            head: {
                id: newHead._id,
                name: newHead.name,
                email: newHead.email,
            },
        });
    } catch (error) {
        console.error('Error during HOD login:', error.message);
        res.status(500).json({ msg: 'Server error', details: error.message });
    }
};

exports.approveLogin = async (req, res) => {
    const { token } = req.params;

    try {
        const { oldHeadId, newHeadId } = jwt.verify(token, process.env.JWT_SECRET);

        // Deactivate current Head
        await Head.findByIdAndUpdate(oldHeadId, { isActive: false });

        // Activate new Head
        await Head.findByIdAndUpdate(newHeadId, { isActive: true });

        res.status(200).json({ msg: 'HOD login approved. New Head is now active.' });
    } catch (error) {
        console.error(error);
        res.status(400).json({ msg: 'Invalid or expired token.' });
    }
};


// Login
exports.loginHead = async (req, res) => {
  const { email, password } = req.body;

  try {
    const head = await Head.findOne({ email });
    if (!head) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, head.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(head._id, head.role, head.name);
    res.status(200).json({ message: 'Login successful', token });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
}; 

// Get recent assignments
exports.getRecentAssignments = async (req, res) => {
  try {
    const assignments = await Assignment.find({})
      .sort({ createdAt: -1 }) 
      .limit(10); 

    res.status(200).json({ assignments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assignments', details: error.message });
  }
};



// Updated getAllAssignments 
exports.getAllAssignments = async (req, res) => {
  try {
    console.log('Authenticated user:', req.user);
    
   
    const assignments = await Assignment.find({})
      .populate('userId')  
      .populate('head');  
    
    console.log('Total assignments found:', assignments.length);


    assignments.forEach((assignment, index) => {
      if (index < 2) { 
        console.log(`Assignment ${index + 1}:`, {
          id: assignment._id,
          status: assignment.status,
          admin: assignment.admin, 
          appealDetails: assignment.appealDetails,
          hasAppeal: assignment.appealDetails && (assignment.appealDetails.subject || assignment.appealDetails.description)
        });
      }
    });

    const appeals = assignments.filter(
      (assignment) => assignment.appealDetails && 
                     (assignment.appealDetails.subject || assignment.appealDetails.description)
    );
    console.log('Assignments with appeals:', appeals.length);
    
    // Filter accepted or rejected assignments
    const acceptedOrRejected = assignments.filter(
      (assignment) => assignment.status === 'Accepted' || assignment.status === 'Rejected'
    );
    console.log('Accepted or Rejected assignments:', acceptedOrRejected.length); 

    res.status(200).json({
      appeals,
      acceptedOrRejected,
    });
  } catch (error) {
    console.error('Error in getAllAssignments:', error);
    res.status(500).json({
      error: 'Failed to fetch assignments',
      details: error.message,
    });
  }
};



// Add Head Feedback
exports.addHeadFeedback = async (req, res) => {
    const { id } = req.params;
    const { feedback } = req.body;

    try {
        const assignment = await Assignment.findById(id);
        if (!assignment) return res.status(404).json({ msg: 'Assignment not found' });

        if (!assignment.feedback.adminFeedback) {
            return res.status(400).json({ msg: 'Admin feedback must be added first.' });
        }

        assignment.feedback.headFeedback = feedback;
        await assignment.save();

        res.status(200).json({ msg: 'Head feedback added successfully', assignment });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
};
// Accept an assignment
exports.acceptAssignment = async (req, res) => {
  const { id } = req.params;

  try {
    const assignment = await Assignment.findById(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    assignment.status = 'Accepted';
    assignment.overturnedBy = null; 
    await assignment.save();

    res.status(200).json({ message: 'Assignment accepted', assignment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept assignment', details: error.message });
  }
};

// Reject an assignment
exports.rejectAssignment = async (req, res) => {
  const { id } = req.params;

  try {
    const assignment = await Assignment.findById(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    assignment.status = 'Rejected';
    assignment.overturnedBy = null; 
    await assignment.save();

    res.status(200).json({ message: 'Assignment rejected', assignment });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject assignment', details: error.message });
  }
};

// Overturn Admin decision
// Updated overturnDecision function with email notification
exports.overturnDecision = async (req, res) => {
  const { id } = req.params;
  const { headDecision } = req.body;

  if (!['Accepted', 'Rejected'].includes(headDecision)) {
    return res.status(400).json({ error: 'Invalid decision. Must be "Accepted" or "Rejected"' });
  }

  try {
    // Find assignment and populate user info for email notification
    const assignment = await Assignment.findById(id).populate('userId', 'name email');
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    console.log('🎯 Overturning decision for assignment:', {
      title: assignment.title,
      currentStatus: assignment.status,
      newDecision: headDecision,
      student: assignment.user || assignment.userId?.name,
      studentEmail: assignment.userId?.email
    });

    // Store previous status for email notification
    const previousStatus = assignment.status;

    // Update assignment with head decision
    assignment.status = headDecision;
    assignment.headDecision = headDecision;  
    assignment.appealStatus = headDecision === 'Accepted' ? 'Accepted' : 'Rejected';
    assignment.head = req.user.id; // Set the head who made the decision
    
    await assignment.save();

    console.log('✅ Assignment decision overturned successfully');

    // 📧 SEND EMAIL NOTIFICATION TO STUDENT
    let emailResult = null;
    const recipientEmail = assignment.userId?.email;
    const recipientName = assignment.userId?.name || assignment.user || 'Student';
    const headName = req.user.name || 'Head of Department';

    if (recipientEmail) {
      console.log('📧 Preparing email notification for decision overturn...');

      // Create email content
      const emailSubject = `Assignment Decision Updated: ${assignment.title}`;
      
      const emailText = `Dear ${recipientName},

The decision on your assignment "${assignment.title}" has been reviewed and updated by the Head of Department.

Previous Status: ${previousStatus}
New Status: ${headDecision}

${headDecision === 'Accepted' 
  ? 'Congratulations! Your assignment has been accepted after review.' 
  : 'Your assignment has been reviewed and requires further attention.'}

${assignment.appealDetails && (assignment.appealDetails.subject || assignment.appealDetails.description) 
  ? 'This update is in response to your appeal submission.' 
  : ''}

Please check the assignment portal for more details.

Best regards,
${headName}
Assignment Management System`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background: linear-gradient(135deg, ${headDecision === 'Accepted' ? '#10b981 0%, #059669 100%' : '#ef4444 0%, #dc2626 100%'}); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 24px;">
              ${headDecision === 'Accepted' ? '✅' : '❌'} Assignment Decision Updated
            </h2>
          </div>
          
          <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Dear <strong>${recipientName}</strong>,</p>
            
            <p style="color: #333; font-size: 16px;">The decision on your assignment has been reviewed and updated by the Head of Department:</p>
            
            <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid ${headDecision === 'Accepted' ? '#10b981' : '#ef4444'};">
              <h3 style="color: #333; margin: 0 0 10px 0; font-size: 18px;">📚 ${assignment.title}</h3>
              <p style="color: #666; margin: 5px 0;"><strong>Reviewed by:</strong> ${headName}</p>
              <p style="color: #666; margin: 5px 0;"><strong>Admin:</strong> ${assignment.admin}</p>
            </div>
            
            <div style="background: #fff; border: 2px solid ${headDecision === 'Accepted' ? '#10b981' : '#ef4444'}; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <div style="text-align: center; flex: 1;">
                  <p style="margin: 0; color: #666; font-size: 14px;">Previous Status</p>
                  <p style="margin: 5px 0 0 0; font-weight: bold; color: ${previousStatus === 'Accepted' ? '#10b981' : '#ef4444'}; font-size: 16px;">${previousStatus}</p>
                </div>
                <div style="color: #666; font-size: 24px; margin: 0 20px;">→</div>
                <div style="text-align: center; flex: 1;">
                  <p style="margin: 0; color: #666; font-size: 14px;">New Status</p>
                  <p style="margin: 5px 0 0 0; font-weight: bold; color: ${headDecision === 'Accepted' ? '#10b981' : '#ef4444'}; font-size: 16px;">${headDecision}</p>
                </div>
              </div>
            </div>
            
            <div style="background: ${headDecision === 'Accepted' ? '#d1fae5' : '#fee2e2'}; border: 1px solid ${headDecision === 'Accepted' ? '#a7f3d0' : '#fecaca'}; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: ${headDecision === 'Accepted' ? '#065f46' : '#991b1b'}; margin: 0; font-weight: 500;">
                ${headDecision === 'Accepted' 
                  ? '🎉 Congratulations! Your assignment has been accepted after review by the Head of Department.' 
                  : '📝 Your assignment has been reviewed and requires further attention. Please check with your admin for next steps.'}
              </p>
            </div>

            ${assignment.appealDetails && (assignment.appealDetails.subject || assignment.appealDetails.description) 
              ? `<div style="background: #fef3c7; border: 1px solid #fde68a; padding: 15px; border-radius: 6px; margin: 20px 0;">
                   <p style="color: #92400e; margin: 0;"><strong>📋 Note:</strong> This update is in response to your appeal submission.</p>
                 </div>` 
              : ''}
            
            <p style="color: #333; margin-top: 20px;">Please check the assignment portal for more details and any additional feedback.</p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>${headName}</strong><br>Assignment Management System</p>
            </div>
          </div>
        </div>`;

      // Send email with proper error handling
      try {
        console.log('📧 Calling sendMail function...');
        console.log('📧 sendMail type:', typeof sendMail);
        
        if (typeof sendMail !== 'function') {
          throw new Error('sendMail is not properly imported as a function');
        }
        
        await sendMail(recipientEmail, emailSubject, emailText, emailHtml);
        console.log('✅ Email notification sent successfully to:', recipientEmail);
        emailResult = { success: true };
        
      } catch (emailError) {
        console.error('❌ Email sending failed but decision saved:', emailError.message);
        emailResult = { success: false, error: emailError.message };
      }
    } else {
      console.log('⚠️  No email found for user - skipping email notification');
    }

    // Emit notification to frontend (if socket.io is available)
    const io = req.app.get('io');
    if (io) {
      io.emit('notification', {
        message: `Assignment "${assignment.title}" decision overturned to ${headDecision}`,
        type: 'decision_overturn',
        assignmentId: id
      });
    }

    // Return success response (regardless of email status)
    const responseData = {
      message: `Assignment ${headDecision.toLowerCase()} successfully`, 
      assignment,
      emailSent: emailResult?.success || false
    };

    // Add email status info for debugging
    if (emailResult && !emailResult.success) {
      responseData.emailError = emailResult.error;
    }

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error in overturnDecision:', error);
    res.status(500).json({ 
      error: 'Failed to update decision', 
      details: error.message 
    });
  }
};

// Fixed getAppeals - works with object-based appealDetails
exports.getAppeals = async (req, res) => {
  try {
    // Fetch assignments where appealDetails has subject or description
    const appeals = await Assignment.find({
      $or: [
        { "appealDetails.subject": { $exists: true, $ne: null, $ne: "" } },
        { "appealDetails.description": { $exists: true, $ne: null, $ne: "" } }
      ]
    }).populate('userId head'); // Don't populate admin since it's a string

    console.log('Appeals found:', appeals.length);
    res.status(200).json(appeals);
  } catch (err) {
    console.error('Error fetching appeals:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Fixed handleAppealDecision - don't populate string admin field
exports.handleAppealDecision = async (req, res) => {
    try {
        const { id } = req.params; 
        const { decision } = req.body;
        console.log(`Handling appeal decision for Assignment ID: ${id}`);
        console.log(`Decision: ${decision}`);

        const assignment = await Assignment.findById(id); // Don't populate admin since it's a string
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.appealStatus = decision === 'Accepted' ? 'Accepted' : 'Rejected';
        assignment.headDecision = decision;  // Store the actual decision string
        assignment.status = decision === 'Accepted' ? 'Accepted' : 'Rejected';
        assignment.head = req.user.id; // Set the head who made the decision
        await assignment.save();

        // For email notification, we'll use the admin string directly
        if (decision === 'Accepted') {
            try {
                // Since admin is a string, we can't get email from it
                // You might want to handle this differently based on your needs
                console.log(`Assignment appeal accepted for admin: ${assignment.admin}`);
                console.log('Email notification would be sent if admin email was available');
                
                // If you have a way to get admin email from the string name, do it here
                // For now, just log the success
            } catch (mailError) {
                console.error('Error with email notification:', mailError);
                // Don't fail the request if email fails
            }
        }

        res.status(200).json({ message: 'Head decision recorded successfully', assignment });
    } catch (err) {
        console.error('Error handling appeal decision:', err);
        res.status(500).json({ message: 'Server error' });
    }
};


exports.handleAppealDecision = async (req, res) => {
    try {
        const { id } = req.params; 
        const { decision } = req.body;
        console.log(`Handling appeal decision for Assignment ID: ${id}`);
        console.log(`Decision: ${decision}`);

        const assignment = await Assignment.findById(id).populate('admin', 'email');
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        assignment.appealStatus = decision === 'Accepted' ? 'Accepted' : 'Rejected';
        assignment.headDecision = decision === 'Accepted';
        assignment.status = decision === 'Accepted' ? 'Accepted' : 'Rejected';
        await assignment.save();

        
        if (decision === 'Accepted') {
            try {
                const transporter = nodemailer.createTransport({
                    service: 'Gmail',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS,
                    },
                });

                await transporter.sendMail({
                    from: process.env.EMAIL,
                    to: assignment.admin.email,
                    subject: 'Head Decision: Assignment Appeal Overturned',
                    text: `The appeal for the assignment titled "${assignment.title}" has been accepted by the Head. Please re-examine the assignment and provide necessary feedback.`,
                });

                console.log('Notification email sent to admin:', assignment.admin.email);
            } catch (mailError) {
                console.error('Error sending email:', mailError);
                return res.status(500).json({ message: 'Failed to send notification email' });
            }
        }

        res.status(200).json({ message: 'Head decision recorded successfully', assignment });
    } catch (err) {
        console.error('Error handling appeal decision:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

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

exports.getAllAdminAssignments = async (req, res) => {
    try {
        const { role } = req.user;

        // Check if user is HEAD/HOD
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can view all assignments' 
            });
        }

        console.log('📋 Fetching all admin assignments for HEAD');
        
        // Find all admin assignments regardless of label
        const allAssignments = await AdminAssignment.find({}).sort({ createdAt: -1 });
        
        // Apply migration to all assignments
        const migratedAssignments = [];
        for (const assignment of allAssignments) {
            const migratedAssignment = await getAdminAssignmentWithMigration(assignment);
            migratedAssignments.push(migratedAssignment);
        }
        
        console.log(`📊 Found ${migratedAssignments.length} total admin assignments`);
        
        res.status(200).json({
            assignments: migratedAssignments,
            total: migratedAssignments.length
        });
    } catch (error) {
        console.error('❌ Error fetching all admin assignments:', error);
        res.status(500).json({ 
            message: 'Server error while fetching assignments', 
            error: error.message 
        });
    }
};

exports.getAllNotes = async (req, res) => {
    try {
        const { role } = req.user;

        // Check if user is HEAD/HOD
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can view all notes' 
            });
        }

        console.log('📚 Fetching all notes for HEAD');
        
        // Find all notes regardless of label
        const allNotes = await Notes.find({}).sort({ createdAt: -1 });
        
        console.log(`📊 Found ${allNotes.length} total notes`);
        
        res.status(200).json({
            notes: allNotes,
            total: allNotes.length
        });
    } catch (error) {
        console.error('❌ Error fetching all notes:', error);
        res.status(500).json({ 
            message: 'Server error while fetching notes', 
            error: error.message 
        });
    }
};
exports.getAllLectures = async (req, res) => {
    try {
        const { role } = req.user;

        // Check if user is HEAD/HOD
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can view all lectures' 
            });
        }

        console.log('🎥 Fetching all lectures for HEAD');
        
        // Find all lectures regardless of label
        const allLectures = await Lectures.find({}).sort({ createdAt: -1 });
        
        console.log(`📊 Found ${allLectures.length} total lectures`);
        
        res.status(200).json({
            lectures: allLectures,
            total: allLectures.length
        });
    } catch (error) {
        console.error('❌ Error fetching all lectures:', error);
        res.status(500).json({ 
            message: 'Server error while fetching lectures', 
            error: error.message 
        });
    }
};

// Get all tests from all labels - HEAD access
exports.getAllTests = async (req, res) => {
    try {
        const { role } = req.user;

        // Check if user is HEAD/HOD
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can view all tests' 
            });
        }

        console.log('📝 Fetching all tests for HEAD');
        
        // Find all tests regardless of label
        const allTests = await Tests.find({}).sort({ createdAt: -1 });
        
        console.log(`📊 Found ${allTests.length} total tests`);
        
        res.status(200).json({
            tests: allTests,
            total: allTests.length
        });
    } catch (error) {
        console.error('❌ Error fetching all tests:', error);
        res.status(500).json({ 
            message: 'Server error while fetching tests', 
            error: error.message 
        });
    }
};

// Get all content (consolidated endpoint)
exports.getAllContent = async (req, res) => {
    try {
        const { role } = req.user;
        const { type } = req.params; // notes, lectures, tests

        // Check if user is HEAD/HOD
        if (role !== 'Head' && role !== 'head' && role !== 'HOD' && role !== 'hod') {
            return res.status(403).json({ 
                message: 'Only Head of Department can view all content' 
            });
        }

        console.log(`📋 Fetching all ${type} for HEAD`);
        
        let content = [];
        let Model;
        
        switch (type) {
            case 'notes':
                Model = Notes;
                break;
            case 'lectures':
                Model = Lectures;
                break;
            case 'tests':
                Model = Tests;
                break;
            default:
                return res.status(400).json({ 
                    message: 'Invalid content type. Must be notes, lectures, or tests' 
                });
        }
        
        // Find all content regardless of label
        content = await Model.find({}).sort({ createdAt: -1 });
        
        console.log(`📊 Found ${content.length} total ${type}`);
        
        res.status(200).json(content);
    } catch (error) {
        console.error(`❌ Error fetching all ${req.params.type}:`, error);
        res.status(500).json({ 
            message: `Server error while fetching ${req.params.type}`, 
            error: error.message 
        });
    }
};

