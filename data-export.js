const async = require('async')
const User = require('./models/User.js');
const Script = require('./models/Script.js');
const Class = require('./models/Class.js');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
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
function getReflectionAttempCounts(user, module_name) {
  const reflectionAttemptCounts = {
    checkbox_rf: 0,
    open_ended_rf: 0
  };
  /*
    In the event where a user has completed the reflection section twice (which
    would not be typical), we only want to increment the  counts once per
    question.
    Ex. A user answers open-ended question 2 (Q2) three times.
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
    const username = user.username;
    // For each module this user has been assigned (4 modules total)
    for (let i = 1; i <= 4; i++) {
      const record = {
        username: username
      };
      const assignedModule = user.assignedModules[`module${i}`];
      const activityCounts = getActivityCountsFP(user, assignedModule);
      const reflectionAttemptCounts = getReflectionAttempCounts(user, assignedModule);
      record.module_name = assignedModule;
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
