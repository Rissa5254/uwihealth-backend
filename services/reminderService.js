const cron = require("node-cron");
const { getAppointmentRemainders} = require("../services/schedulingEngine")
const { sendEmail} = require("../services/notificationService");

cron.schedule("* * * * *", async() => {
    // run every hour for testing
    console.log("Checking appointments for remainders...");

    const appointments = await getAppointmentRemainders();
    for(const apt of appointments){
        await sendEmail(
            apt.email, 
            "Appointment Remainder", 
        `Good day ${apt.fname},
        This is a friendly reminder that you have an upcoming appointment today for ${apt.sdate} at ${apt.stime}.
        
        Please ensure you arrive on time. If you are unable to attend, kindly cancel or reschedule through the system.
        
        Thank you and have a great day.
        
        Regards,
        UWI Health Centre`
        );
    }
});

    