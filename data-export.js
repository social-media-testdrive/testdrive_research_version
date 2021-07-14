const User = require('./models/User.js');
const Script = require('./models/Script.js');
const Class = require('./models/Class.js');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
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

/*
  Find the name of the class this user belongs to via their class access code.
*/
async function getClassNameForUser(user) {
  const classObject = await Class.findOne({accessCode: user.accessCode}).exec();
  const className = classObject.className;
  return className;
};

/*
  Gets the section data from the provided .json file.
  Helper function for getTimeSpentPerSection().
  (Copied this function from the user controller).
*/
async function getSectionJsonFromFile(filePath) {
  let readFilePromise = function(filePath) {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      })
    })
  }
  const sectionJsonBuffer = await readFilePromise(filePath).then(function(data) {
    return data;
  });
  let sectionJson;
  try {
    sectionJson = JSON.parse(sectionJsonBuffer);
  } catch (err) {
    return next(err);
  }
  return sectionJson;
}

/*
  Compare function used to sort pageLog by increasing time. Used as a parameter
  for Array.prototype.sort(). Read about compare functions here:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
*/
function compareTimestamps(a,b) {
  if (a.time < b.time) {
    return -1;
  }
  if (a.time > b.time) {
    return 1;
  }
  return 0;
};

/*
  Calculates the amount of time spent by the user in each section of a module.
  This is calculated by taking the difference between timestamps of sequential
  page visits. Page visits are recorded in the pageLog field.
  Assumptions:
    - Final reported times are in seconds.
    - Values are rounded to the nearest integer using Math.round() at the end of
      the calcuation.
    - Sections are defined the same way as the progress bar, using
      progressDataA.json and progressDataB.json.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - timeSpentPerSection: Object - object with properties representing the time
        spent (in seconds) in each section of the module.
*/
async function getTimeSpentPerSection(user, module_name) {
  const timeSpentPerSection = {
    tt: 0, // tutorial => section 1
    ga: 0, // guided activity => section 2
    fp: 0, // freeplay => section 3
    rf: 0 // reflection => section 4
  };
  const pageLog = user.pageLog;
  // Need to get the mappings between module pages and section numbers.
  const sectionDataA = await getSectionJsonFromFile("./public2/json/progressDataA.json");
  const sectionDataB = await getSectionJsonFromFile("./public2/json/progressDataB.json");
  /* Short example of the data in progressDataA and progressDataB:
    {
      "start": "1",
      "sim": "2",
      "trans_script": "3",
      "modual": "3",
      "results": "4",
      "end": "end"
    }
    where the key corresponds to page name, value corresponds to a section number
    1 = "tutorial" section
    2 = "guided activity" section
    3 = "freeplay" section
    4 = "reflection" section
  */
  // Select the corresponding sectionData, A or B, to use depending on the module.
  let sectionJson = new Object();
  switch (module_name) {
    case 'cyberbullying':
    case 'digfoot':
      sectionJson = sectionDataB;
      break;
    default:
      sectionJson = sectionDataA;
      break;
  }
  // Sort the pageLog array by increasing time.
  pageLog.sort(compareTimestamps);
  for (let i=0, l=pageLog.length-1; i<l; i++) {
    // Skip page visits that were not within the specified module.
    if ((!pageLog[i].subdirectory2) || (pageLog[i].subdirectory2 !== module_name)) {
      continue;
    }
    // Get the time spent on this page by taking the difference between the
    // next recorded page visit.
    let timeDurationOnPage = (pageLog[i+1].time - pageLog[i].time)
    // Skip any page times that are longer than 30 minutes (1800000 milliseconds).
    if(timeDurationOnPage > 1800000) {
      continue;
    }
    // Add the page time to the appropriate section's total time.
    const sectionNumber = sectionJson[pageLog[i].subdirectory1];
    if (sectionNumber === "1") {
      timeSpentPerSection.tt += timeDurationOnPage;
    } else if (sectionNumber === "2") {
      timeSpentPerSection.ga += timeDurationOnPage;
    } else if (sectionNumber === "3") {
      timeSpentPerSection.fp += timeDurationOnPage;
    } else if (sectionNumber === "4") {
      timeSpentPerSection.rf += timeDurationOnPage;
    } else {
      continue;
    }
  }
  // Convert each number from milliseconds to seconds, and round the final
  // number to the nearest integer with Math.round().
  for(const section of Object.keys(timeSpentPerSection)) {
    const sectionTimeInSeconds = timeSpentPerSection[section]/1000;
    timeSpentPerSection[section] = Math.round(sectionTimeInSeconds);
  }
  return timeSpentPerSection;
};

/*
  Determines the counts of various freeplay (FP) section actions by a single research
  participant within a module.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - activityCounts: Object - object with properties representing action counts.
*/
function getActivityCountsFP(user, module_name) {
  const freeplayActions = user.feedAction;
  const activityCounts = {
    likeCount: 0, // Number of posts this user liked in the FP section
    flagCount: 0, // Number of posts this user flagged in the FP section
    commentCount: 0 // Number of posts this user commented on in the FP section
  };

  for (const post of freeplayActions) {
    // Skip actions on posts that are not from the specified module_name.
    if (post.modual !== module_name) {
      continue;
    }
    // Increment likeCount if the user liked this post.
    if (post.liked) {
      activityCounts.likeCount++;
    }
    // Increment flagCount if the user flagged this post.
    if (post.flagged) {
      activityCounts.flagCount++;
    }
    // Increment commentCount if the user has created at least one comment on
    // this post.
    if (post.comments.length > 0) {
      let createdAtLeastOneComment = false;
      for (const comment of post.comments) {
        if (comment.new_comment) {
          createdAtLeastOneComment = true;
        }
      }
      if (createdAtLeastOneComment) {
        activityCounts.commentCount++;
      }
    }
  }
  return activityCounts;
};

/*
  Determines the counts of reflection questions attempted by a single research
  participant within a module.
  What is considered an attempt?
  open-ended question: the response is not an empty string.
  checkbox: at least once box has been checked.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - reflectionAttemptCounts: Object - object with properties representing attempt counts.
*/
function getReflectionAttemptCounts(user, module_name) {
  const reflectionAttemptCounts = {
    checkbox_rf: 0,
    open_ended_rf: 0
  };
  /*
    In the event where a user has completed the reflection section twice (which
    would not be typical), we only want to increment the counts once per
    question.
    Ex. A user answers open-ended question 1 three times.
    One attempt where the question is blank, and the other 2 attemps have inputs.
    In this case, open_ended_rf should be incremented once.
    reflectionAttemptHistory keeps track of when questions already have a
    counted attempt from this user.
  */
  const reflectionAttemptHistory = [];
  for (const reflectionResponse of user.reflectionAction) {
    if (reflectionResponse.modual !== module_name) {
      // Skip responses on questions that are not from the specified module_name.
      continue;
    }
    const questionNumber = reflectionResponse.questionNumber;
    if (reflectionAttemptHistory.includes(questionNumber)) {
      // This question has already has a counted attempt from this user.
      continue;
    }
    switch (reflectionResponse.type) {
      case 'written': {
        // Any non-empty string counts as an attempt.
        if (reflectionResponse.writtenResponse !== '') {
          reflectionAttemptCounts.open_ended_rf++;
          reflectionAttemptHistory.push(questionNumber);
        }
        break;
      }
      case 'checkbox': {
        // Minimum of one checkbox must be selelected to count as an attempt.
        if (reflectionResponse.checkboxResponse > 0) {
          reflectionAttemptCounts.checkbox_rf++;
          reflectionAttemptHistory.push(questionNumber);
        }
        break;
      }
      default: {
        // There are other response types, but they are not expeted to be relevant
        // in the outcome evaluation study.
        console.log(color_error, `WARNING: There was an unexpected reflection response type for ${questionNumber} in module ${module_name}: type ${reflectionResponse.type}`);
        break;
      }
    }
  }
  return reflectionAttemptCounts;
}

async function getDataExport() {
  const outputFilepath = 'outputFiles/exportData/testExport.csv';
  console.log(color_success, "DB connection established.")
  const csvWriter = createCsvWriter({
    path: outputFilepath,
    header: [
      {id: 'module_name', title: "Module_Name"},
      {id: 'class_name', title: 'Class_Name'},
      {id: 'username', title: 'Username'},
      {id: 'time_spent_tt', title: 'Time_Spent_TT'},
      {id: 'time_spent_ga', title: 'Time_Spent_GA'},
      {id: 'time_spent_fp', title: 'Time_Spent_FP'},
      {id: 'time_spent_rf', title: 'Time_Spent_RF'},
      {id: 'rec_act_ga', title: 'Rec_act_GA'},
      {id: 'corr_act_ga', title: 'Corr_act_GA'},
      {id: 'liked_post_fp', title: 'Liked_post_FP'},
      {id: 'flagged_post_fp', title: 'Flagged_post_FP'},
      {id: 'commented_post_fp', title: 'Commented_post_FP'},
      {id: 'rec_act_fp', title: 'Rec_act_FP'},
      {id: 'checkbox_rf', title: 'Checkbox_RF'},
      {id: 'open_ended_rf', title: 'Open_ended_ RF'},
      {id: 'ga_to_tt', title: 'GA_to_TT'},
      {id: 'fp_to_tt', title: 'FP_to_TT'},
      {id: 'rf_to_tt', title: 'RF_to_TT'},
      {id: 'fp_to_ga', title: 'FP_to_GA'},
      {id: 'rf_to_ga', title: 'RF_to_GA'},
      {id: 'rf_to_fp', title: 'RF_to_FP'}
    ]
  });
  const records = [];
  console.log(color_start, `Searching for student accounts...`)
  const users = await User.find({isStudent: true}).exec();
  console.log(`${users.length} student accounts found.`)
  console.log(color_start, `Interpreting data for each student account...`);
  // For each student found by the query
  for (const user of users) {
    const className = await getClassNameForUser(user);
    const username = user.username;
    // For each module this user has been assigned (4 modules total)
    for (let i = 1; i <= 4; i++) {
      const record = {
        class_name: className,
        username: username
      };
      const assignedModule = user.assignedModules[`module${i}`];
      const timeSpentPerSection = await getTimeSpentPerSection(user, assignedModule);
      const activityCounts = getActivityCountsFP(user, assignedModule);
      const reflectionAttemptCounts = getReflectionAttemptCounts(user, assignedModule);
      record.module_name = assignedModule;
      record.time_spent_tt = timeSpentPerSection.tt;
      record.time_spent_ga = timeSpentPerSection.ga;
      record.time_spent_fp = timeSpentPerSection.fp;
      record.time_spent_rf = timeSpentPerSection.rf;
      record.liked_post_fp = activityCounts.likeCount;
      record.flagged_post_fp = activityCounts.flagCount;
      record.commented_post_fp = activityCounts.commentCount;
      record.checkbox_rf = reflectionAttemptCounts.checkbox_rf;
      record.open_ended_rf = reflectionAttemptCounts.open_ended_rf;
      if (username === "nervousMachine"){
        console.log(record);
      }
    }
  }
  console.log(`Data export completed. File exported to ${outputFilepath}. \nClosing db.`);
  db.close();
}

getDataExport();
