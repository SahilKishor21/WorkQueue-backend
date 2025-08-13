const cron = require('node-cron');
const AdminAssignment = require('../models/adminAssignmentModel');
const User = require('../models/userModels');
const sendMail = require('../config/emailService');

class AssignmentReminderService {
    
    static initializeReminderScheduler() {
        console.log('🔔 Assignment reminder scheduler initialized');
        
        cron.schedule('0 * * * *', async () => {
            console.log('⏰ Running assignment deadline check...');
            await this.checkAndSendDeadlineReminders();
        });
    }
    
    static async checkAndSendDeadlineReminders() {
        try {
            const now = new Date();
            const in24Hours = new Date(now.getTime() + (24 * 60 * 60 * 1000));
            const in23Hours = new Date(now.getTime() + (23 * 60 * 60 * 1000));
            
            console.log('🕐 Checking assignments with deadlines between:', in23Hours, 'and', in24Hours);
            
            const upcomingAssignments = await AdminAssignment.find({
                deadline: {
                    $gte: in23Hours,
                    $lte: in24Hours
                },
                warningEmailSent: { $ne: true }
            });
            
            console.log(`📋 Found ${upcomingAssignments.length} assignments with upcoming deadlines`);
            
            if (upcomingAssignments.length === 0) {
                console.log('✅ No upcoming assignments found');
                return;
            }
            
            for (const assignment of upcomingAssignments) {
                await this.sendReminderForAssignment(assignment);
            }
            
        } catch (error) {
            console.error('❌ Error in deadline reminder service:', error);
        }
    }
    
    static async sendReminderForAssignment(assignment) {
        try {
            console.log(`📬 Processing reminder for assignment: ${assignment.title}`);
            
            const users = await User.find({ label: assignment.label });
            
            if (users.length === 0) {
                console.log(`⚠️ No users found with label: ${assignment.label}`);
                return;
            }
            
            console.log(`👥 Found ${users.length} users for label: ${assignment.label}`);
            
            const emailPromises = users.map(user => this.sendReminderEmail(user, assignment));
            const emailResults = await Promise.allSettled(emailPromises);
            
            const successCount = emailResults.filter(result => result.status === 'fulfilled').length;
            const failureCount = emailResults.filter(result => result.status === 'rejected').length;
            
            console.log(`📧 Reminder emails sent: ${successCount} successful, ${failureCount} failed`);
            
            await AdminAssignment.updateOne(
                { _id: assignment._id },
                { 
                    warningEmailSent: true,
                    sentWarningEmails: users.map(user => ({
                        userId: user._id,
                        sentAt: new Date()
                    }))
                }
            );
            
            console.log(`✅ Assignment ${assignment.title} marked as warning email sent`);
            
        } catch (error) {
            console.error(`❌ Error sending reminder for assignment ${assignment.title}:`, error);
        }
    }
    
    static async sendReminderEmail(user, assignment) {
        try {
            const deadlineDate = new Date(assignment.deadline);
            const formattedDeadline = deadlineDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const timeUntilDeadline = this.getTimeUntilDeadline(deadlineDate);
            
            const emailSubject = `⚠️ Deadline Reminder: ${assignment.title} - Due in 24 Hours!`;
            
            const emailText = `Hello ${user.name},

This is a friendly reminder that your assignment "${assignment.title}" is due in approximately 24 hours.

Assignment Details:
- Title: ${assignment.title}
- Description: ${assignment.description}
- Deadline: ${formattedDeadline}
- Time Remaining: ${timeUntilDeadline}

Please make sure to submit your assignment before the deadline to avoid any penalties.

Best regards,
Assignment Management System`;

            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                    <div style="background: linear-gradient(135deg, #ffc107 0%, #fd7e14 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 24px;">⚠️ Assignment Deadline Reminder</h2>
                    </div>
                    
                    <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hello <strong>${user.name}</strong>,</p>
                        
                        <p style="color: #333; font-size: 16px;">This is a friendly reminder that your assignment deadline is approaching soon:</p>
                        
                        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
                            <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 18px;">📚 ${assignment.title}</h3>
                            <p style="color: #856404; margin: 5px 0;"><strong>Description:</strong> ${assignment.description}</p>
                            <p style="color: #856404; margin: 5px 0;"><strong>Label:</strong> ${assignment.label}</p>
                        </div>
                        
                        <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <h4 style="color: #721c24; margin: 0 0 10px 0;">⏰ Deadline Information:</h4>
                            <p style="color: #721c24; margin: 5px 0; font-size: 16px;"><strong>Due Date:</strong> ${formattedDeadline}</p>
                            <p style="color: #721c24; margin: 5px 0; font-size: 16px; font-weight: bold;"><strong>Time Remaining:</strong> ${timeUntilDeadline}</p>
                        </div>
                        
                        <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="color: #0c5460; margin: 0;"><strong>📝 Reminder:</strong> Please submit your assignment before the deadline to avoid any penalties. Late submissions may not be accepted.</p>
                        </div>
                        
                        <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="color: #155724; margin: 0;"><strong>💡 Tips for Last-Minute Submission:</strong></p>
                            <ul style="color: #155724; margin: 10px 0; padding-left: 20px;">
                                <li>Review all requirements before submitting</li>
                                <li>Check file format and size requirements</li>
                                <li>Submit a few minutes early to avoid technical issues</li>
                                <li>Keep a backup copy of your work</li>
                            </ul>
                        </div>
                        
                        <p style="color: #333; margin-top: 20px;">Please log into the assignment portal to submit your work.</p>
                        
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                            <p style="color: #666; font-size: 14px; margin: 0;">Best regards,<br><strong>Assignment Management System</strong></p>
                        </div>
                    </div>
                </div>`;
            
            await sendMail(user.email, emailSubject, emailText, emailHtml);
            console.log(`✅ Reminder email sent to ${user.name} (${user.email})`);
            
        } catch (error) {
            console.error(`❌ Failed to send reminder email to ${user.name}:`, error);
            throw error;
        }
    }
    
    static getTimeUntilDeadline(deadline) {
        const now = new Date();
        const timeDiff = deadline.getTime() - now.getTime();
        
        if (timeDiff <= 0) {
            return "Assignment is overdue!";
        }
        
        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours < 1) {
            return `${minutes} minutes`;
        } else if (hours < 24) {
            return `${hours} hours and ${minutes} minutes`;
        } else {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `${days} day(s) and ${remainingHours} hours`;
        }
    }
    
    static async sendTestReminder() {
        console.log('🧪 Testing reminder system...');
        await this.checkAndSendDeadlineReminders();
    }
}

module.exports = AssignmentReminderService;