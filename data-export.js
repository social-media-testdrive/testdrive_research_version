const User = require('./models/User.js');
const Script = require('./models/Script.js');
const Class = require('./models/Class.js');
const mongoose = require('mongoose');
const fs = require('fs');
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

/*
  Finds the name of the class this user belongs to via their class access code.
*/
async function getClassNameForUser(user) {
    const classObject = await Class.findOne({ accessCode: user.accessCode }).exec();
    const className = classObject.className;
    return className;
};

/*
  Gets the data from the provided .json file.
  Helper function for:
  - getSectionInformation(user, module_name), 
  - getrec_act_GACounts(user, module_name),
  - getrec_act_FPCounts(user, module_name),
  - getReflectionCheckboxAnswers(user, module_name)
  (Copied this function from the user controller).
*/
async function getJsonFromFile(filePath) {
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
    const JsonBuffer = await readFilePromise(filePath).then(function(data) {
        return data;
    });
    let Json;
    try {
        Json = JSON.parse(JsonBuffer);
    } catch (err) {
        return next(err);
    }
    return Json;
}

/*
  Compare function used to sort pageLog by increasing time. Used as a parameter
  for Array.prototype.sort(). Read about compare functions here:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
*/
function compareTimestamps(a, b) {
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
    - pageLog is already sorted in order of increasing timestamps.
    - Final reported times are in seconds.
    - Values are rounded to the nearest integer using Math.round() at the end of
      the calcuation.
    - Sections are defined the same way as the progress bar, using
      progressDataA.json and progressDataB.json.
  Parameters:
    - sectionInformation: Object - this is modified by this function, and will
        contain the final calculations.
    - sectionJson: Object - used to match pages to their corresponding sections.
    - pageLog: [Object] - list of page visits by this user, sorted by time order.
    - module_name: String - the module name to filter by.
  Returns:
    This function does not return anything.
    This function modifies the sectionInformation parameter.
*/
function calculateAndModifyTimeSpent(sectionInformation, sectionJson, pageLog, module_name) {
    for (let i = 0, l = pageLog.length - 1; i < l; i++) {
        // Skip page visits that were not within the specified module.
        if ((!pageLog[i].subdirectory2) || (pageLog[i].subdirectory2 !== module_name)) {
            continue;
        }
        // Get the time spent on this page by taking the difference between the
        // next recorded page visit.
        let timeDurationOnPage = (pageLog[i + 1].time - pageLog[i].time)
            // Only include times that are shorter than 30 minutes (1800000 milliseconds).
        if (timeDurationOnPage > 1800000) {
            continue;
        }
        // Add the page time to the appropriate section's total time.
        const sectionNumber = sectionJson[pageLog[i].subdirectory1];
        if (sectionNumber === "1") {
            sectionInformation.timeSpent.tt += timeDurationOnPage;
        } else if (sectionNumber === "2") {
            sectionInformation.timeSpent.ga += timeDurationOnPage;
        } else if (sectionNumber === "3") {
            sectionInformation.timeSpent.fp += timeDurationOnPage;
        } else if (sectionNumber === "4") {
            sectionInformation.timeSpent.rf += timeDurationOnPage;
        } else {
            continue;
        }
    }
    // Convert each number from milliseconds to seconds, and round the final
    // number to the nearest integer with Math.round().
    for (const section of Object.keys(sectionInformation.timeSpent)) {
        const sectionTimeInSeconds = sectionInformation.timeSpent[section] / 1000;
        sectionInformation.timeSpent[section] = Math.round(sectionTimeInSeconds);
    }
}

/*
  Calculates the frequency that the user jumps between various module sections.
  A jump is identified by comparing each pageLog entry's section number with
  it's previous adjacent entry section number.
  Assumptions:
    - pageLog is already sorted in order of increasing timestamps.
    - Sections are defined the same way as the progress bar, using
      progressDataA.json and progressDataB.json.
  Note: 
    - In the research site, the module progress bar is disabled. Therefore, 
    the user is unable to intuitively jump between various module sections within 
    the application. The only ways the user is able to is by 1) clicking the 
    browser back/forward button [which will most likely be calculated as sequential section
    jumps, even if it's not the user's intent] or 2) inputting the URL browser path.
  Parameters:
    - sectionInformation: Object - this is modified by this function, and will
        contain the final calculations.
    - sectionJson: Object - used to match pages to their corresponding sections.
    - pageLog: [Object] - list of page visits by this user, sorted by time order.
    - module_name: String - the module name to filter by.
  Returns:
    This function does not return anything.
    This function modifies the sectionInformation parameter.
*/
function calculateAndModifyJumpFrequency(sectionInformation, sectionJson, pageLog, module_name) {
    if (pageLog.length < 2) {
        return;
    }
    for (let i = 1, l = pageLog.length - 1; i < l; i++) {
        // Skip page visits that were not within the specified module.
        if ((!pageLog[i].subdirectory2) || (pageLog[i].subdirectory2 !== module_name)) {
            continue;
        }
        if ((!pageLog[i - 1].subdirectory2) || (pageLog[i - 1].subdirectory2 !== module_name)) {
            continue;
        }
        // Determine if this page sequence matches any of the predefined jump types.
        for (const jumpType of Object.keys(sectionInformation.jumpFrequency)) {
            const fromSectionToCompare = sectionJson[pageLog[i - 1].subdirectory1];
            const toSectionToCompare = sectionJson[pageLog[i].subdirectory1];
            if (
                fromSectionToCompare === sectionInformation.jumpFrequency[jumpType].fromSection &&
                toSectionToCompare === sectionInformation.jumpFrequency[jumpType].toSection
            ) {
                // This page sequence matches the current jump type. Increment its count.
                sectionInformation.jumpFrequency[jumpType].count++;
            }
        }
    }
};

/*
  Calculates key information relating to page sections: the time spent in each
  section, as well as the frequency of jumps between certain sections.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - sectionInformation: Object - object with properties representing the time
        spent (in seconds) in each section of the module, and the frequency
        of jumps betwen various sections in the module.
*/
async function getSectionInformation(user, module_name) {
    const sectionInformation = {
        timeSpent: {
            tt: 0, // The time a learner spent on the tutorial (tt) section
            ga: 0, // The time a learner spent on the guided activity (ga) section
            fp: 0, // The time a learner spent on the freeplay (fp) section
            rf: 0, // The time a learner spent on the reflection (rf) section
        },
        jumpFrequency: {
            ga_to_tt: {
                count: 0, // Frequency of jumping from the ga section to the tt section
                fromSection: '2',
                toSection: '1'
            },
            fp_to_tt: {
                count: 0, // Frequency of jumping from the fp section to the tt section
                fromSection: '3',
                toSection: '1'
            },
            rf_to_tt: {
                count: 0, // Frequency of jumping from the rf section to the tt section
                fromSection: '4',
                toSection: '1'
            },
            fp_to_ga: {
                count: 0, // Frequency of jumping from the fp section to the ga section
                fromSection: '3',
                toSection: '2'
            },
            rf_to_ga: {
                count: 0, // Frequency of jumping from the rf section to the ga section
                fromSection: '4',
                toSection: '2'
            },
            rf_to_fp: {
                count: 0, // Frequency of jumping from the rf section to the fp section
                fromSection: '4',
                toSection: '3'
            }
        }
    };
    const pageLog = user.pageLog;
    // Need to get the mappings between module pages and section numbers.
    const sectionDataA = await getJsonFromFile("./public2/json/progressDataA.json");
    const sectionDataB = await getJsonFromFile("./public2/json/progressDataB.json");
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
    // Calculate data and modify sectionInformation.
    calculateAndModifyTimeSpent(sectionInformation, sectionJson, pageLog, module_name);
    calculateAndModifyJumpFrequency(sectionInformation, sectionJson, pageLog, module_name);
    return sectionInformation;
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
        // Set commentCount to the number of comments the user has made
        activityCounts.commentCount = post.comments.length;
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
            case 'written':
                {
                    // Any non-empty string counts as an attempt.
                    if (reflectionResponse.writtenResponse !== '') {
                        reflectionAttemptCounts.open_ended_rf++;
                        reflectionAttemptHistory.push(questionNumber);
                    }
                    break;
                }
            case 'checkbox':
                {
                    // Minimum of one checkbox must be selelected to count as an attempt.
                    if (reflectionResponse.checkboxResponse > 0) {
                        reflectionAttemptCounts.checkbox_rf++;
                        reflectionAttemptHistory.push(questionNumber);
                    }
                    break;
                }
            default:
                {
                    // There are other response types, but they are not expected to be relevant
                    // in the outcome evaluation study.
                    console.log(color_error, `WARNING: There was an unexpected reflection response type for ${questionNumber} in module ${module_name}: type ${reflectionResponse.type}`);
                    break;
                }
        }
    }
    return reflectionAttemptCounts;
}

/*
  Determines the number of times the user clicks the “back” button on the text bubbles 
  on the tutorial pages of a given module.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - backTTCounts: Integer - the number of times the "back" button is clicked
*/
function getback_TTCounts(user, module_name) {
    const introjsStepActions = user.introjsStepAction;

    /* Example of introjsStepAction 
      subdirectory1: String, // which page the user is on
      subdirectory2: String, // which module the user is on
      stepNumber: Number, // which step this action is on (steps start from 0)
      viewDuration: Number, // how long the user was on this step (milliseconds)
      absoluteStartTime: Date // time the step opened in the real world
    */

    const moduleTutorialStepActions = introjsStepActions.filter(action => action.subdirectory2 === module_name && action.subdirectory1 === 'tutorial');

    let index = -1;
    let backTTCounts = 0;

    for (const step of moduleTutorialStepActions) {
        if (step.stepNumber < index) {
            backTTCounts++;
        }
        index = step.stepNumber;
    }
    return backTTCounts;
};

/*
  Determines the number of "1"s in number n (in binary representation)
  Helper function for getrec_act_GACounts(), getrec_act_FPCounts(), and getReflectionCheckboxAnswers().
*/
function countSetBits(n) {
    var count = 0;
    while (n) {
        count += n & 1;
        n >>= 1;
    }
    return count;
}

/*
  Determines the count of recommended actions the user takes in the Guided Activity section of a module
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - rec_act_GACounts: Integer - the number of recommended actions taken by the user in the GA section of module
*/
async function getrec_act_GACounts(user, module_name) {
    // get module recommended actions
    const recActions = await getJsonFromFile("./public2/json/guidedActivityRecActions.json")
        // get user's guidedActivityActions (list of guidedActivityAction objects)
    const gaActions = user.guidedActivityAction;

    /* Example of guidedActivityAction
      post: String, // Which post did the user interact with? ex: "cyberbullying_sim_post1"
      modual: String, // which lesson mod did this take place in?
      startTime: 0, // (not used in TestDrive)
      liked: {type: Boolean, default: false}, // did the user like this post in the feed?
      flagged: {type: Boolean, default: false}, // did the user flag this post in the feed?
      flagTime  : [Date], // list of timestamps when the user flagged the post
      likeTime  : [Date], //list of timestamps when the user liked the post
      replyTime  : [Date], // list of timestamps when the user left a comment on the post

      // popup modal info: one per open
      modal: [new Schema({
        modalName: String, // name of Modal
        modalOpened: {type: Boolean, default: false}, // did the user open the modal?
        modalOpenedTime: Number, // timestamp the user opened the modal
        modalViewTime: Number, // Duration of time that the modal was open (in milliseconds)
        modalCheckboxesCount: Number, // How many checkboxes are present in the modal
        modalCheckboxesInput: Number, // Number which, when converted into binary format, corresponds to which checkboxes were checked
        modalDropdownCount: Number, // How many accordion dropdown triangles are present in the modal
        modalDropdownClick: Number, // Number which, when converted into a binary format, corresponds to which triangles were clicked
      }

      // comment info on an actor's post (fake post): one per comment
      comments: [new Schema({
        comment: String, // Which comment did the user interact with? ex: "cyberbullying_sim_post1_comment1"
        liked: {type: Boolean, default: false}, // Is the comment liked ?
        flagged: {type: Boolean, default: false}, // Is the comment flagged?
        flagTime  : [Date], // list of timestamps when the user flagged the comment
        likeTime  : [Date], // list of timestamps when the user liked the comment

        new_comment: {type: Boolean, default: false}, // Is this a new comment?
        new_comment_id: String, // Number, starting at 0, used to ID user-made comments (starts at 0)
        comment_body: String, // Text of comment
        absTime: Date, // Real-life timestamp of when the comment was made
      }
    */

    var rec_act_GACounts = 0;

    const module_recActions = recActions[module_name]; // recommended actions that should be taken in the module
    const module_gaActions = gaActions.filter(action => action.modual === module_name); // user's actions taken in module

    // loop through each post. For each post, check if user completes the recommended actions for that post
    for (var postID in module_recActions) {
        if (module_recActions.hasOwnProperty(postID)) {
            // get recommended actions for the post
            const post_recAction = module_recActions[postID];
            // find corresponding post in user's actions
            const post_gaAction = module_gaActions.find(action => action.post === postID);

            if (post_gaAction === undefined) { // User did not conduct any actions on the post
                continue;
            }

            // Checks to see if user left a comment on the post
            if (post_recAction["commentOnPost"]) {
                for (const commentObj of post_gaAction["comments"]) {
                    if (commentObj["new_comment"]) { // code currently already doesn't allow a comment without text to be logged
                        rec_act_GACounts += 1;
                        break; // only count 1 comment
                    }
                }
            }

            // Checks to see if user flagged the post
            if (post_recAction["flagPost"]) {
                rec_act_GACounts += post_gaAction["flagged"] ? 1 : 0;
            }

            // Checks to see if user flagged comments
            for (const commentID of post_recAction["flagComments"]) {
                const comment = post_gaAction["comments"].find(commentObj => commentObj.comment !== undefined && commentObj.comment === commentID);
                if (comment === undefined) { // User did not conduct any actions on the comment
                    continue;
                }
                rec_act_GACounts += comment["flagged"] ? 1 : 0;
            }

            // Checks to see if user conducted recommended actions on modals
            for (var modalName in post_recAction["modals"]) {
                const modal_recActions = post_recAction["modals"][modalName];

                const modal_gaActions_reverse = post_gaAction["modal"].slice().reverse(); // make copy & reverse, so we consider the most recent open of the modal
                const modal = modal_gaActions_reverse.find(modalObj => modalObj.modalName === modalName);

                if (modal === undefined) { // User did not interact with modal
                    continue;
                }

                for (var action in modal_recActions) {
                    if (action === "modalCheckboxesInput") {
                        const rec_num = parseInt(modal_recActions[action], 2);
                        const ga_num = modal[action];
                        rec_act_GACounts += countSetBits(rec_num & ga_num);
                    } else {
                        rec_act_GACounts += (modal_recActions[action] === modal[action]) ? 1 : 0;
                    }
                }
            }
        }
    }
    return rec_act_GACounts;
};

/*
  Finds the ObjectID of the post
  Parameters: 
    - post_id: Integer (defined in excel during population of database)
  Helper function for getrec_act_FPCounts()
*/
async function getObjectIDForPost(post_id) {
    const scriptObject = await Script.findOne({ post_id: post_id }).exec();
    const script_objectID = scriptObject._id;
    return script_objectID;
};

/*
  Finds the ObjectID of the comment specified on post.
  Parameters: 
    - post_id: Integer (defined in excel during population of database)
    - commentIndex: Integer indicating the number comment on post (ex: 1 = 1st comment on post)
  Helper function for getrec_act_FPCounts()
*/
async function getObjectIDForComment(post_id, commentIndex) {
    const scriptObject = await Script.findOne({ post_id: post_id }).exec();
    const comment_objectID = scriptObject.comments[commentIndex - 1]._id;
    return comment_objectID;
}

/*
  Determines the count of recommended actions the user takes in the FreePlay Activity section of a module
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - rec_act_FPCounts: Integer - the number of recommended actions taken by the user in the FP section of module
*/
async function getrec_act_FPCounts(user, module_name) {
    // get module recommended actions
    const recActions = await getJsonFromFile("./public2/json/freeplayActivityRecActions.json");
    // get user's freeplay section Actions (list of feedAction objects)
    const fpActions = user.feedAction;

    /* Example of feedAction
      post: ObjectID, // Which post did the user interact with? 
      modual: String, // which lesson mod did this take place in?
      startTime: 0, // (not used in TestDrive)
      liked: {type: Boolean, default: false}, // did the user like this post in the feed?
      flagged: {type: Boolean, default: false}, // did the user flag this post in the feed?
      flagTime  : [Date], // list of timestamps when the user flagged the post
      likeTime  : [Date], //list of timestamps when the user liked the post
      replyTime  : [Date], // list of timestamps when the user left a comment on the post

      // popup modal info: one per open
      modal: [new Schema({
        modalName: String, // name of Modal
        modalOpened: {type: Boolean, default: false}, // did the user open the modal?
        modalOpenedTime: Number, // timestamp the user opened the modal
        modalViewTime: Number, // Duration of time that the modal was open (in milliseconds)
        modalCheckboxesCount: Number, // How many checkboxes are present in the modal
        modalCheckboxesInput: Number, // Number which, when converted into binary format, corresponds to which checkboxes were checked
        modalDropdownCount: Number, // How many accordion dropdown triangles are present in the modal
        modalDropdownClick: Number, // Number which, when converted into a binary format, corresponds to which triangles were clicked
      }

      // comment info on an actor's post (fake post): one per comment
      comments: [new Schema({
        comment: ObjectID, // Which comment did the user interact with? 
        liked: {type: Boolean, default: false}, // Is the comment liked ?
        flagged: {type: Boolean, default: false}, // Is the comment flagged?
        flagTime  : [Date], // list of timestamps when the user flagged the comment
        likeTime  : [Date], // list of timestamps when the user liked the comment

        new_comment: {type: Boolean, default: false}, // Is this a new comment?
        new_comment_id: String, // Number, starting at 0, used to ID user-made comments (starts at 0)
        comment_body: String, // Text of comment
        absTime: Date, // Real-life timestamp of when the comment was made
      }
    */

    var rec_act_FPCounts = 0;

    const module_recActions = recActions[module_name]; // recommended actions that should be taken in the module
    const module_fpActions = fpActions.filter(action => action.modual === module_name); // user's actions taken in module

    // loop through each post. For each post, check if user completes the recommended actions for that post
    for (var post_id in module_recActions) {
        if (module_recActions.hasOwnProperty(post_id)) {
            // get recommended actions for the post
            const post_recAction = module_recActions[post_id];

            // If module is 'targeted', 'esteem' (customized module), only consider the posts that match the latest chosen topic
            // Why? For special case: generally speaking, the student can only complete each module once, but in case a student uses the browser back buttons to change their topic
            if (module_name === "esteem" || module_name === "targeted") {
                const customTopic = (module_name === "targeted") ? user.targetedAdTopic[user.targetedAdTopic.length - 1] : user.esteemTopic[user.esteemTopic.length - 1];
                if (post_recAction["topic"] !== customTopic) {
                    continue;
                }
            }

            // find corresponding post in user's actions
            const post_ObjectID = await getObjectIDForPost(post_id);
            const post_fpAction = module_fpActions.find(action => action.post.equals(post_ObjectID));

            if (post_fpAction === undefined) { // User did not conduct any actions on the post
                continue;
            }

            // Checks to see if user left a comment on the post
            if (post_recAction["commentOnPost"]) {
                for (const commentObj of post_fpAction["comments"]) {
                    if (commentObj["new_comment"]) { // code currently already doesn't allow a comment without text to be logged
                        rec_act_FPCounts += 1;
                        break; // only count 1 comment
                    }
                }
            }

            // Checks to see if user flagged the post
            if (post_recAction["flagPost"]) {
                rec_act_FPCounts += post_fpAction["flagged"] ? 1 : 0;
            }

            // Checks to see if user flagged comments
            for (const commentIndex of post_recAction["flagComments"]) {
                const comment_ObjectID = await getObjectIDForComment(post_id, commentIndex);
                const comment = post_fpAction["comments"].find(commentObj => commentObj.comment !== undefined && commentObj.comment.equals(comment_ObjectID))
                if (comment === undefined) { // User did not conduct any actions on the comment
                    continue;
                }
                rec_act_FPCounts += comment["flagged"] ? 1 : 0
            }

            // Checks to see if user conducted recommended actions on modals
            for (var modalName in post_recAction["modals"]) {
                const modal_recActions = post_recAction["modals"][modalName]

                const modal_fpActions_reverse = post_fpAction["modal"].slice().reverse() // make copy & reverse, so we consider the most recent open of the modal
                const modal = modal_fpActions_reverse.find(modalObj => modalObj.modalName === modalName)

                if (modal === undefined) { // User did not interact with modal
                    continue;
                }

                for (var action in modal_recActions) {
                    if (action === "modalCheckboxesInput") {
                        const rec_num = parseInt(modal_recActions[action], 2)
                        const fp_num = modal[action]
                        rec_act_FPCounts += countSetBits(rec_num & fp_num)
                    } else {
                        rec_act_FPCounts += (modal_recActions[action] === modal[action]) ? 1 : 0
                    }
                }
            }
        }
    }

    // only for digital-literacy module: add 1 to count if the user clicks articleInfoModal on any post 
    // (this will include the 3 posts specified, which is why it is not included in the JSON file)
    if (module_name === "digital-literacy") {
        for (post of module_fpActions) {
            const modal = post["modal"].find(modalObj => modalObj.modalName === "digital-literacy_articleInfoModal")

            if (modal !== undefined) {
                rec_act_FPCounts++;
            }
        }
    }
    return rec_act_FPCounts;
};

/*
  Retrieves the (most recent) reflection answers from the user for the checkbox type questions 
  in the module.
  Parameters:
    - user: Object - the user data from one study participant.
    - module_name: String - the module name to filter by.
  Returns:
    - reflectionCheckboxAnswers: Object - object with properties giving reflection answers in binary form.
    Ex: '0100' is a binary representation of the checkboxes for that question
*/
async function getReflectionCheckboxAnswers(user, module_name) {
    const reflectionCheckboxAnswers = {
        Q1: "N/A",
        Q2: "N/A"
    };
    let numberCorrect = 0;

    const reflectionSectionData = await getJsonFromFile("./public2/json/reflectionSectionData.json");

    /* Example of reflectionAction 
      absoluteTimeContinued: Date, //time that the user left the page by clicking continue
      modual: String, //which lesson mod did this take place in?
      questionNumber: String, // corresponds with reflectionSectionData.json, i.e. 'Q1', 'Q2', 'Q3'...
      prompt: String,
      type: String, // Which type of response this will be: written, checkbox, radio, habitsUnique
      writtenResponse: String,
      radioSelection: String, // this is for the presentation module
      numberOfCheckboxes: Number,
      checkboxResponse: Number,
      checkedActualTime: Boolean, // this is unique to the habits module
    */
    const moduleReflectionActions = user.reflectionAction.filter(action => action.modual === module_name && action.type === 'checkbox');

    /* In the event where a user has completed the reflection section twice (which
      would not be typical), we only want to include the most recent attempt. 
    */
    const reflectionAttemptTimes = moduleReflectionActions.map(action => action.absoluteTimeContinued);
    const mostRecentAttemptTime = reflectionAttemptTimes.sort((a, b) => b - a)[0];
    const mostRecent_moduleReflectionActions = moduleReflectionActions.filter(action => action.absoluteTimeContinued.getTime() === mostRecentAttemptTime.getTime());

    for (const reflectionResponse of mostRecent_moduleReflectionActions) {
        const questionNumber = reflectionResponse.questionNumber;

        const question = reflectionSectionData[module_name][questionNumber]
        const checkboxResponse = reflectionResponse["checkboxResponse"].toString(2).padStart(reflectionResponse["numberOfCheckboxes"], '0')

        if (question["type"] === "checkbox") {
            // need to append tab in front, in order for any leading zeros to show up on Excel
            reflectionCheckboxAnswers[questionNumber] = "\t" + checkboxResponse

            // Check correctness of checkbox answer
            const correctCheckboxResponse = parseInt(Object.values(question["correctResponses"]).join(''), 2)
            numberCorrect += countSetBits(correctCheckboxResponse & reflectionResponse["checkboxResponse"])
        } else if (question["type"] === "checkboxGrouped") {
            const subquestionLength = reflectionResponse["numberOfCheckboxes"] / question["groupCount"]
            const regex = new RegExp(`.{1,${subquestionLength}}`, 'g'); //splits the string into sections of length subquestionLength
            reflectionCheckboxAnswers[questionNumber] = checkboxResponse.match(regex).join(", ")

            // Check correctness of checkbox answer
            let correctCheckboxResponse = ""
            for (subquestion in question["correctResponses"]) {
                correctCheckboxResponse += Object.values(question["correctResponses"][subquestion]).join('')
            }
            correctCheckboxResponse = parseInt(correctCheckboxResponse, 2)
            numberCorrect += countSetBits(correctCheckboxResponse & reflectionResponse["checkboxResponse"])
        }
    }
    return [reflectionCheckboxAnswers, numberCorrect];
}

async function getDataExport() {

    // STUDY 2 ACCESS CODES:
    const study2_sp_accessCodes = []
    const study2_fa_accessCodes = []

    console.log(`Successfully connected to db.`)
    console.log(`Starting the data export script...`)
    const currentDate = new Date();
    const outputFilename = `outomeEvaluation-dataExport` +
        `.${currentDate.getMonth()+1}-${currentDate.getDate()}-${currentDate.getFullYear()}` +
        `.${currentDate.getHours()}-${currentDate.getMinutes()}-${currentDate.getSeconds()}`;
    const outputFilepath = `outputFiles/exportData/${outputFilename}.csv`;
    const csvWriter = createCsvWriter({
        path: outputFilepath,
        header: [
            { id: 'module_name', title: "Module_Name" },
            { id: 'class_name', title: 'Class_Name' },
            { id: 'access_code', title: 'Access_Code' },
            { id: 'username', title: 'Username' },
            { id: 'time_spent_tt', title: 'Time_Spent_TT (in seconds)' },
            { id: 'time_spent_ga', title: 'Time_Spent_GA (in seconds)' },
            { id: 'time_spent_fp', title: 'Time_Spent_FP (in seconds)' },
            { id: 'time_spent_rf', title: 'Time_Spent_RF (in seconds)' },
            { id: 'liked_post_fp', title: 'Liked_post_FP' },
            { id: 'flagged_post_fp', title: 'Flagged_post_FP' },
            { id: 'commented_post_fp', title: 'Commented_post_FP' },
            { id: 'checkbox_rf', title: 'Checkbox_RF' },
            { id: 'open_ended_rf', title: 'Open_ended_ RF' },
            { id: 'ga_to_tt', title: 'GA_to_TT' },
            { id: 'fp_to_tt', title: 'FP_to_TT' },
            { id: 'rf_to_tt', title: 'RF_to_TT' },
            { id: 'fp_to_ga', title: 'FP_to_GA' },
            { id: 'rf_to_ga', title: 'RF_to_GA' },
            { id: 'rf_to_fp', title: 'RF_to_FP' },
            { id: 'back_tt', title: 'Back_TT' },
            { id: 'rec_act_ga', title: 'Rec_act_GA' },
            { id: 'rec_act_fp', title: 'Rec_act_FP' },
            { id: 'checkbox_q1', title: 'Checkbox_Q1' },
            { id: 'checkbox_q2', title: 'Checkbox_Q2' },
            { id: 'number_correct_checkbox', title: 'Number_Correct_Checkbox' }
        ]
    });
    const records = [];
    const users = await User.find({ isStudent: true }).exec();
    // For each student found by the query
    for (const user of users) {
        const className = await getClassNameForUser(user);
        const username = user.username;
        const accessCode = user.accessCode;

        // only do a data export of students in study 2
        if (!study2_sp_accessCodes.includes(accessCode) && !study2_fa_accessCodes.includes(accessCode)) {
            continue;
        }

        // For each module this user has been assigned (4 modules total)
        for (let i = 1; i <= 4; i++) {
            const record = {
                class_name: className,
                username: username,
                access_code: accessCode
            };
            const assignedModule = user.assignedModules[`module${i}`];
            const sectionInformation = await getSectionInformation(user, assignedModule);
            const activityCounts = getActivityCountsFP(user, assignedModule);
            const reflectionAttemptCounts = getReflectionAttemptCounts(user, assignedModule);
            const back_TTCounts = getback_TTCounts(user, assignedModule);
            const rec_act_GACounts = await getrec_act_GACounts(user, assignedModule);
            const rec_act_FPCounts = await getrec_act_FPCounts(user, assignedModule);
            const [reflectionCheckboxAnswers, numberCorrect] = await getReflectionCheckboxAnswers(user, assignedModule);

            record.module_name = assignedModule;
            record.time_spent_tt = sectionInformation.timeSpent.tt;
            record.time_spent_ga = sectionInformation.timeSpent.ga;
            record.time_spent_fp = sectionInformation.timeSpent.fp;
            record.time_spent_rf = sectionInformation.timeSpent.rf;
            record.liked_post_fp = activityCounts.likeCount;
            record.flagged_post_fp = activityCounts.flagCount;
            record.commented_post_fp = activityCounts.commentCount;
            record.checkbox_rf = reflectionAttemptCounts.checkbox_rf;
            record.open_ended_rf = reflectionAttemptCounts.open_ended_rf;
            record.ga_to_tt = sectionInformation.jumpFrequency.ga_to_tt.count;
            record.fp_to_tt = sectionInformation.jumpFrequency.fp_to_tt.count;
            record.rf_to_tt = sectionInformation.jumpFrequency.rf_to_tt.count;
            record.fp_to_ga = sectionInformation.jumpFrequency.fp_to_ga.count;
            record.rf_to_ga = sectionInformation.jumpFrequency.rf_to_ga.count;
            record.rf_to_fp = sectionInformation.jumpFrequency.rf_to_fp.count;
            record.back_tt = back_TTCounts;
            record.rec_act_ga = rec_act_GACounts;
            record.rec_act_fp = rec_act_FPCounts;
            record.checkbox_q1 = reflectionCheckboxAnswers.Q1;
            record.checkbox_q2 = reflectionCheckboxAnswers.Q2;
            record.number_correct_checkbox = numberCorrect;
            records.push(record);
        }
    }
    await csvWriter.writeRecords(records);
    console.log(color_success, `...Data export completed.\nFile exported to: ${outputFilepath}`);
    console.log('Closing db connection.')
    db.close();
}

getDataExport();