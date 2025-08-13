const nodemailer = require('nodemailer');
require('dotenv').config();

// Validate SMTP configuration
if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ Missing SMTP configuration in environment variables');
}

// Configure transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: parseInt(process.env.SMTP_PORT, 10) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Email sending function
const sendMail = async (to, subject, text, html) => {
    try {
        const mailOptions = {
            from: `"Admin Team" <${process.env.SMTP_USER}>`,
            to,
            subject,
            text,
            html: html || text, // Use HTML if provided, otherwise use text
        };
        
        console.log(`📧 Sending email to: ${to}`);
        const result = await transporter.sendMail(mailOptions);
        console.log('📧 Email sent successfully:', result.messageId);
        return result; // Return the result for success confirmation
        
    } catch (error) {
        console.error('❌ Error sending email:', error.message);
        throw new Error(`Failed to send email: ${error.message}`);
    }
};

// Export the function
module.exports = sendMail;