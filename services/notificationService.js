const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USER,         
        pass: process.env.EMAIL_PASS          
    }
});

// Sending
const sendEmail = async(email, subject, message) => {
    try{
        await transporter.sendMail({
            from: '"UWI Health Centre" <no-reply@uwi.edu>',
            to: email,
            subject: subject,
            text: message
        });
        console.log(`Mail successfully trapped for: ${email}`);
    } catch(error){
        console.error("Mailtrap Connection Error:", error);
    }
};

module.exports = { sendEmail };