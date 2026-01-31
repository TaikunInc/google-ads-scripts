/**
 *
 * Ad Group Status Tracker - Slack Integrated Version
 *
 * Monitors ad group status changes in Google Ads accounts and logs them to a Google Sheet.
 * Sends an alert via Slack whenever ad group statuses change.
 *
 * Tracks changes in:
 * - Ad group status (ENABLED, PAUSED, REMOVED)
 *
 * @author: Based on Nils Rooijmans' disapproved ads script pattern
 *
 * Version 1.0
 *
 */


// --- SCRIPT SETTINGS ---

// URL of the spreadsheet to log ad group status changes.
// This spreadsheet needs two sheets:
// 1. "Status Log" - where status changes are recorded
// 2. "AdGroup Snapshot" - stores the last known status of each ad group
var SPREADSHEET_URL = "YOUR_SPREADSHEET_URL_HERE";

// --- Slack Webhook Configuration ---
// URL of the Google Sheet containing account IDs and their corresponding Slack webhook URLs.
var SLACK_HELPER_SPREADSHEET_URL = 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE';

// The name of the sheet within the helper spreadsheet that contains the mapping.
var SLACK_HELPER_SHEET_NAME = 'Sheet1';

// --- Sheet Names ---
var STATUS_LOG_SHEET_NAME = 'Status Log';
var ADGROUP_SNAPSHOT_SHEET_NAME = 'AdGroup Snapshot';

// --- NO CHANGES NEEDED BELOW THIS LINE ---

var STATUS_LOG_HEADER = [
  "Timestamp",
  "Account Name",
  "Account ID",
  "Campaign Name",
  "AdGroup ID",
  "AdGroup Name",
  "Previous Status",
  "New Status",
  "Change Type"
];

var SNAPSHOT_HEADER = [
  "AdGroup ID",
  "Campaign Name",
  "AdGroup Name",
  "Status",
  "Last Updated"
];


/**
 * Main function - entry point for the script
 */
function main() {
  Logger.log("Starting Ad Group Status Tracker...");

  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);

  // Prepare the sheets
  var statusLogSheet = getOrCreateSheet(ss, STATUS_LOG_SHEET_NAME, STATUS_LOG_HEADER);
  var snapshotSheet = getOrCreateSheet(ss, ADGROUP_SNAPSHOT_SHEET_NAME, SNAPSHOT_HEADER);

  // Get the previous ad group snapshot
  var previousSnapshot = getAdGroupSnapshot(snapshotSheet);
  Logger.log("Loaded %s ad groups from previous snapshot.", Object.keys(previousSnapshot).length);

  // Get current ad group statuses
  var currentAdGroups = getCurrentAdGroupStatuses();
  Logger.log("Found %s ad groups in current account.", Object.keys(currentAdGroups).length);

  // Compare and find changes
  var changes = detectStatusChanges(previousSnapshot, currentAdGroups);
  Logger.log("Detected %s status changes.", changes.length);

  // Log changes if any
  if (changes.length > 0) {
    logStatusChanges(statusLogSheet, changes);
    sendSlackAlert(changes);
  } else {
    Logger.log("No ad group status changes detected.");
  }

  // Update the snapshot with current data
  updateAdGroupSnapshot(snapshotSheet, currentAdGroups);

  Logger.log("Ad Group Status Tracker completed.");
}


/**
 * Gets or creates a sheet with the specified name and header
 * @param {Spreadsheet} ss The spreadsheet object
 * @param {string} sheetName The name of the sheet
 * @param {Array} header The header row array
 * @return {Sheet} The sheet object
 */
function getOrCreateSheet(ss, sheetName, header) {
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
    Logger.log("Created new sheet: %s", sheetName);
  }

  return sheet;
}


/**
 * Retrieves the previous ad group snapshot from the spreadsheet
 * @param {Sheet} sheet The snapshot sheet
 * @return {Object} A map of ad group IDs to their status data
 */
function getAdGroupSnapshot(sheet) {
  var snapshot = {};
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return snapshot; // Empty or only header
  }

  var data = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_HEADER.length).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var adGroupId = row[0].toString();

    if (adGroupId) {
      snapshot[adGroupId] = {
        adGroupId: adGroupId,
        campaignName: row[1],
        adGroupName: row[2],
        status: row[3],
        lastUpdated: row[4]
      };
    }
  }

  return snapshot;
}


/**
 * Gets current ad group statuses from the Google Ads account
 * @return {Object} A map of ad group IDs to their current status data
 */
function getCurrentAdGroupStatuses() {
  var adGroups = {};

  var gaqlQuery =
    "SELECT " +
    "campaign.name, " +
    "ad_group.id, " +
    "ad_group.name, " +
    "ad_group.status " +
    "FROM ad_group " +
    "WHERE campaign.status != 'REMOVED'";

  Logger.log("GAQL Query: %s", gaqlQuery);

  try {
    var results = AdsApp.search(gaqlQuery);

    while (results.hasNext()) {
      var row = results.next();

      var adGroupId = row.adGroup.id.toString();

      adGroups[adGroupId] = {
        adGroupId: adGroupId,
        campaignName: row.campaign.name,
        adGroupName: row.adGroup.name,
        status: row.adGroup.status
      };
    }
  } catch (e) {
    Logger.log("Error querying ad groups: %s", e);
  }

  return adGroups;
}


/**
 * Compares previous and current snapshots to detect status changes
 * @param {Object} previousSnapshot The previous ad group snapshot
 * @param {Object} currentAdGroups The current ad group statuses
 * @return {Array} Array of change objects
 */
function detectStatusChanges(previousSnapshot, currentAdGroups) {
  var changes = [];
  var accountName = AdsApp.currentAccount().getName();
  var accountId = AdsApp.currentAccount().getCustomerId();
  var timestamp = new Date();

  // Check for changes in existing ad groups and new ad groups
  for (var adGroupId in currentAdGroups) {
    var current = currentAdGroups[adGroupId];
    var previous = previousSnapshot[adGroupId];

    if (!previous) {
      // New ad group - only log if this isn't the first run
      if (Object.keys(previousSnapshot).length > 0) {
        changes.push({
          timestamp: timestamp,
          accountName: accountName,
          accountId: accountId,
          campaignName: current.campaignName,
          adGroupId: adGroupId,
          adGroupName: current.adGroupName,
          previousStatus: 'N/A',
          newStatus: current.status,
          changeType: 'NEW_ADGROUP'
        });
      }
    } else {
      // Existing ad group - check for status changes
      if (previous.status !== current.status) {
        var changeType = getChangeType(current.status);

        changes.push({
          timestamp: timestamp,
          accountName: accountName,
          accountId: accountId,
          campaignName: current.campaignName,
          adGroupId: adGroupId,
          adGroupName: current.adGroupName,
          previousStatus: previous.status,
          newStatus: current.status,
          changeType: changeType
        });
      }
    }
  }

  // Check for removed ad groups
  for (var adGroupId in previousSnapshot) {
    if (!currentAdGroups[adGroupId]) {
      var previous = previousSnapshot[adGroupId];

      changes.push({
        timestamp: timestamp,
        accountName: accountName,
        accountId: accountId,
        campaignName: previous.campaignName,
        adGroupId: adGroupId,
        adGroupName: previous.adGroupName,
        previousStatus: previous.status,
        newStatus: 'REMOVED',
        changeType: 'ADGROUP_REMOVED'
      });
    }
  }

  return changes;
}


/**
 * Determines the type of change for logging purposes
 * @param {string} newStatus The new status
 * @return {string} The change type description
 */
function getChangeType(newStatus) {
  if (newStatus === 'ENABLED') {
    return 'ENABLED';
  } else if (newStatus === 'PAUSED') {
    return 'PAUSED';
  } else if (newStatus === 'REMOVED') {
    return 'REMOVED';
  } else {
    return 'STATUS_CHANGED';
  }
}


/**
 * Logs status changes to the status log sheet
 * @param {Sheet} sheet The status log sheet
 * @param {Array} changes Array of change objects
 */
function logStatusChanges(sheet, changes) {
  var rows = [];

  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    rows.push([
      change.timestamp,
      change.accountName,
      change.accountId,
      change.campaignName,
      change.adGroupId,
      change.adGroupName,
      change.previousStatus,
      change.newStatus,
      change.changeType
    ]);
  }

  if (rows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, STATUS_LOG_HEADER.length).setValues(rows);
    Logger.log("Logged %s status changes to spreadsheet.", rows.length);
  }
}


/**
 * Updates the ad group snapshot sheet with current data
 * @param {Sheet} sheet The snapshot sheet
 * @param {Object} currentAdGroups The current ad group statuses
 */
function updateAdGroupSnapshot(sheet, currentAdGroups) {
  // Clear existing data (keep header)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_HEADER.length).clear();
  }

  // Write current snapshot
  var rows = [];
  var timestamp = new Date();

  for (var adGroupId in currentAdGroups) {
    var adGroup = currentAdGroups[adGroupId];
    rows.push([
      adGroup.adGroupId,
      adGroup.campaignName,
      adGroup.adGroupName,
      adGroup.status,
      timestamp
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, SNAPSHOT_HEADER.length).setValues(rows);
    Logger.log("Updated ad group snapshot with %s ad groups.", rows.length);
  }
}


/**
 * Retrieves the Slack webhook URL for the current Google Ads account from a helper spreadsheet.
 * @return {string|null} The webhook URL, or null if not found.
 */
function getSlackWebhookUrl() {
  if (!SLACK_HELPER_SPREADSHEET_URL || SLACK_HELPER_SPREADSHEET_URL === 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE') {
    Logger.log('Slack helper spreadsheet URL is not configured. Skipping Slack notification.');
    return null;
  }

  try {
    var spreadsheet = SpreadsheetApp.openByUrl(SLACK_HELPER_SPREADSHEET_URL);
    var sheet = spreadsheet.getSheetByName(SLACK_HELPER_SHEET_NAME);

    if (!sheet) {
      Logger.log('Could not find sheet "%s" in the Slack helper spreadsheet.', SLACK_HELPER_SHEET_NAME);
      return null;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log('Slack helper sheet is empty.');
      return null;
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var currentAccountId = AdsApp.currentAccount().getCustomerId();

    for (var i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === currentAccountId) {
        Logger.log('Found webhook URL for account %s.', currentAccountId);
        return data[i][1].toString().trim();
      }
    }

    Logger.log('No matching webhook URL found for account ID %s.', currentAccountId);
    return null;
  } catch (e) {
    Logger.log('Error accessing Slack helper spreadsheet: ' + e);
    return null;
  }
}


/**
 * Sends a message to a Slack channel using a webhook URL.
 * @param {string} webhookUrl The webhook URL for the Slack channel.
 * @param {string} message The text of the message to send.
 */
function sendSlackNotification(webhookUrl, message) {
  if (!webhookUrl) {
    Logger.log('No webhook URL provided. Cannot send Slack notification.');
    return;
  }

  try {
    var payload = {
      'text': message
    };
    var options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload)
    };
    UrlFetchApp.fetch(webhookUrl, options);
    Logger.log('Slack notification sent.');
  } catch (e) {
    Logger.log('Failed to send Slack notification. Error: ' + e);
  }
}


/**
 * Sends a Slack alert with a summary of ad group status changes.
 * @param {Array} changes Array of change objects
 */
function sendSlackAlert(changes) {
  var webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    return;
  }

  var accountName = AdsApp.currentAccount().getName();
  var accountId = AdsApp.currentAccount().getCustomerId();

  // Categorize changes for summary
  var summary = categorizeChanges(changes);

  var message = '*[Google Ads Alert] - Ad Group Status Changes Detected*\n\n' +
    'Account: *' + accountName + '* (' + accountId + ')\n\n' +
    '*Summary of Changes:*\n';

  if (summary.enabled > 0) {
    message += '\u2022 Ad Groups Enabled: ' + summary.enabled + '\n';
  }
  if (summary.paused > 0) {
    message += '\u2022 Ad Groups Paused: ' + summary.paused + '\n';
  }
  if (summary.removed > 0) {
    message += '\u2022 Ad Groups Removed: ' + summary.removed + '\n';
  }
  if (summary.newAdGroups > 0) {
    message += '\u2022 New Ad Groups Added: ' + summary.newAdGroups + '\n';
  }
  if (summary.other > 0) {
    message += '\u2022 Other Changes: ' + summary.other + '\n';
  }

  message += '\n*Total Changes: ' + changes.length + '*\n\n';
  message += 'See the full report for details:\n<' + SPREADSHEET_URL + '>';

  sendSlackNotification(webhookUrl, message);
}


/**
 * Categorizes changes for summary reporting
 * @param {Array} changes Array of change objects
 * @return {Object} Summary object with counts by category
 */
function categorizeChanges(changes) {
  var summary = {
    enabled: 0,
    paused: 0,
    removed: 0,
    newAdGroups: 0,
    other: 0
  };

  for (var i = 0; i < changes.length; i++) {
    var changeType = changes[i].changeType;

    if (changeType === 'NEW_ADGROUP') {
      summary.newAdGroups++;
    } else if (changeType === 'ENABLED') {
      summary.enabled++;
    } else if (changeType === 'PAUSED') {
      summary.paused++;
    } else if (changeType === 'ADGROUP_REMOVED' || changeType === 'REMOVED') {
      summary.removed++;
    } else {
      summary.other++;
    }
  }

  return summary;
}
