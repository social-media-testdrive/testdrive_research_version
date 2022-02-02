const User = require('./models/User.js');
const Class = require('./models/Class.js');
const mongoose = require('mongoose');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

// Console.log color shortcuts
const color_start = '\x1b[33m%s\x1b[0m'; // yellow
const color_success = '\x1b[32m%s\x1b[0m'; // green
const color_error = '\x1b[31m%s\x1b[0m'; // red

// establish initial Mongoose connection
mongoose.connect(process.env.PRO_MONGODB_URI, { useNewUrlParser: true });
// listen for errors after establishing initial connection
const db = mongoose.connection;
db.on('error', (err) => {
    console.error(err);
    console.log('%s MongoDB connection error.');
    process.exit(1);
});

const moduleDictionary = {
    'accounts': 'Accounts and Passwords',
    'advancedlit': 'Responding to Breaking News!',
    'cyberbullying': 'How to be an Upstander',
    'digfoot': 'Shaping your Digital Footprint',
    'digital-literacy': 'News in Social Media',
    'esteem': 'The Ups and Downs of Social Media',
    'habits': 'Healthy Social Media Habits',
    'phishing': 'Scams and Phishing',
    'presentation': 'Online Identities',
    'privacy': 'Social Media Privacy',
    'safe-posting': 'Is it Private Information?',
    'targeted': 'Ads on Social Media'
}

/*
  Finds the name of the class this user belongs to via their class access code.
*/
async function getClassNameForUser(user) {
    const classObject = await Class.findOne({ accessCode: user.accessCode }).exec();
    const className = classObject.className;
    return className;
};

async function getDataExport() {

    // STUDY 2 ACCESS CODES:
    const study2_sp_accessCodes = []
    const study2_fa_accessCodes = []

    console.log(`Successfully connected to db.`)
    console.log(`Starting the data export script...`)
    const currentDate = new Date();
    const outputFilename = `outomeEvaluation-studyProgress` +
        `.${currentDate.getMonth()+1}-${currentDate.getDate()}-${currentDate.getFullYear()}` +
        `.${currentDate.getHours()}-${currentDate.getMinutes()}-${currentDate.getSeconds()}`;
    const outputFilepath = `outputFiles/exportData/studyProgress/${outputFilename}.csv`;
    const csvWriter = createCsvWriter({
        path: outputFilepath,
        header: [
            { id: 'class_name', title: 'Class Name' },
            { id: 'access_code', title: 'Access Code' },
            { id: 'username', title: 'Username' },
            { id: 'login', title: 'Most Recent Login' },

            { id: 'module_1', title: 'Module 1' },
            { id: 'status_1', title: 'Status' },
            { id: 'date_1', title: 'Date' },

            { id: 'module_2', title: 'Module 2' },
            { id: 'status_2', title: 'Status' },
            { id: 'date_2', title: 'Date' },

            { id: 'module_3', title: 'Module 3' },
            { id: 'status_3', title: 'Status' },
            { id: 'date_3', title: 'Date' },

            { id: 'module_4', title: 'Module 4' },
            { id: 'status_4', title: 'Status' },
            { id: 'date_4', title: 'Date' },
        ]
    });
    const records = [];
    const users = await User.find({ isStudent: true }).exec();
    // For each student found by the query
    for (const user of users) {
        const className = await getClassNameForUser(user);
        const accessCode = user.accessCode;
        const username = user.username;

        // only do a data export of students in study 2 - Fall 
        if (!study2_fa_accessCodes.includes(accessCode)) {
            continue;
        }

        const record = {
            class_name: className,
            access_code: accessCode,
            username: username
        };

        if (user.log.length !== 0) {
            record.login = user.log[user.log.length - 1].time.toDateString();
        };

        // For each module this user has been assigned (4 modules total)
        for (let i = 1; i <= 4; i++) {
            const assignedModule = user.assignedModules[`module${i}`];

            let assignedModule_NoHyphen = assignedModule;
            if (assignedModule == 'digital-literacy') {
                assignedModule_NoHyphen = "digitalliteracy";
            } else if (assignedModule == 'safe-posting') {
                assignedModule_NoHyphen = "safeposting";
            }

            record[`module_${i}`] = moduleDictionary[assignedModule];

            const status = user.moduleProgress[assignedModule_NoHyphen];
            record[`status_${i}`] = status !== "none" ? status : "";
            record[`date_${i}`] = status !== "none" ? user.moduleProgressTimestamps[assignedModule].toDateString() : "";
        }
        records.push(record);
    }
    await csvWriter.writeRecords(records);
    console.log(color_success, `...Data export completed.\nFile exported to: ${outputFilepath}`);
    console.log('Closing db connection.')
    db.close();
}

getDataExport();