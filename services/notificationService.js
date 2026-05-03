import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "your_email",
        pass: "your_password"
    }
});

// Sending
export const sendEmail = async(email, subject, message) => {
    await transporter.sendMail({
        from: "UWI Health Centre",
        to: email,
        subject,
        text: message
    });
};

// Booking
async function bookAppointment(){
    await sendEmail(
        user.email,
        "Appointment Confirmed",
        `Your appointment is booked for ${date} at ${time}.`
    );
}

// Cancelling
async function bookAppointment(){
    await sendEmail(
        user.email,
        "Appointment Cancelled",
        `Your appointment for ${date} at ${time} has been cancelled.`  
    );
}

