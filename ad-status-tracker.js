/**
 *
 * Ad Status Tracker - Slack Integrated Version
 *
 * Monitors ad status changes in Google Ads accounts and logs them to a Google Sheet.
 * Sends an alert via Slack whenever ad statuses change.
 *
 * Tracks changes in:
 * - Ad status (ENABLED, PAUSED, REMOVED)
 * - Policy approval status (APPROVED, APPROVED_LIMITED, AREA_OF_INTEREST_ONLY, DISAPPROVED)
 *
 * @author: Based on Nils Rooijmans' disapproved ads script pattern
 *
 * Version 1.0
 *
 */


// --- SCRIPT SETTINGS ---

// URL of the spreadsheet to log ad status changes.
// This spreadsheet needs two sheets:
// 1. "Status Log" - where status changes are recorded
// 2. "Ad Snapshot" - stores the last known status of each ad
var SPREADSHEET_URL = "YOUR_SPREADSHEET_URL_HERE";

// --- Slack Webhook Configuration ---
// URL of the Google Sheet containing account IDs and their corresponding Slack webhook URLs.
var SLACK_HELPER_SPREADSHEET_URL = 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE';

// The name of the sheet within the helper spreadsheet that contains the mapping.
var SLACK_HELPER_SHEET_NAME = 'Sheet1';

// --- Sheet Names ---
var STATUS_LOG_SHEET_NAME = 'Status Log';
var AD_SNAPSHOT_SHEET_NAME = 'Ad Snapshot';

// --- NO CHANGES NEEDED BELOW THIS LINE ---

var STATUS_LOG_HEADER = [
  "Timestamp",
  "Account Name",
  "Account ID",
  "Campaign Name",
  "AdGroup Name",
  "Ad ID",
  "Ad Type",
  "Previous Status",
  "New Status",
  "Previous Approval Status",
  "New Approval Status",
  "Change Type"
];

var SNAPSHOT_HEADER = [
  "Ad ID",
  "Campaign Name",
  "AdGroup Name",
  "Ad Type",
  "Status",
  "Approval Status",
  "Last Updated"
];


/**
 * Main function - entry point for the script
 */
function main() {
  Logger.log("Starting Ad Status Tracker...");

  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);

  // Prepare the sheets
  var statusLogSheet = getOrCreateSheet(ss, STATUS_LOG_SHEET_NAME, STATUS_LOG_HEADER);
  var snapshotSheet = getOrCreateSheet(ss, AD_SNAPSHOT_SHEET_NAME, SNAPSHOT_HEADER);

  // Get the previous ad snapshot
  var previousSnapshot = getAdSnapshot(snapshotSheet);
  Logger.log("Loaded %s ads from previous snapshot.", Object.keys(previousSnapshot).length);

  // Get current ad statuses
  var currentAds = getCurrentAdStatuses();
  Logger.log("Found %s ads in current account.", Object.keys(currentAds).length);

  // Compare and find changes
  var changes = detectStatusChanges(previousSnapshot, currentAds);
  Logger.log("Detected %s status changes.", changes.length);

  // Log changes if any
  if (changes.length > 0) {
    logStatusChanges(statusLogSheet, changes);
    sendSlackAlert(changes);
  } else {
    Logger.log("No ad status changes detected.");
  }

  // Update the snapshot with current data
  updateAdSnapshot(snapshotSheet, currentAds);

  Logger.log("Ad Status Tracker completed.");
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
 * Retrieves the previous ad snapshot from the spreadsheet
 * @param {Sheet} sheet The snapshot sheet
 * @return {Object} A map of ad IDs to their status data
 */
function getAdSnapshot(sheet) {
  var snapshot = {};
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return snapshot; // Empty or only header
  }

  var data = sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_HEADER.length).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var adId = row[0].toString();

    if (adId) {
      snapshot[adId] = {
        adId: adId,
        campaignName: row[1],
        adGroupName: row[2],
        adType: row[3],
        status: row[4],
        approvalStatus: row[5],
        lastUpdated: row[6]
      };
    }
  }

  return snapshot;
}


/**
 * Gets current ad statuses from the Google Ads account
 * @return {Object} A map of ad IDs to their current status data
 */
function getCurrentAdStatuses() {
  var ads = {};

  var gaqlQuery =
    "SELECT " +
    "campaign.name, " +
    "ad_group.name, " +
    "ad_group_ad.ad.id, " +
    "ad_group_ad.ad.type, " +
    "ad_group_ad.status, " +
    "ad_group_ad.policy_summary.approval_status " +
    "FROM ad_group_ad " +
    "WHERE campaign.status != 'REMOVED' " +
    "AND ad_group.status != 'REMOVED'";

  Logger.log("GAQL Query: %s", gaqlQuery);

  try {
    var results = AdsApp.search(gaqlQuery);

    while (results.hasNext()) {
      var row = results.next();

      var adId = row.adGroupAd.ad.id.toString();

      ads[adId] = {
        adId: adId,
        campaignName: row.campaign.name,
        adGroupName: row.adGroup.name,
        adType: row.adGroupAd.ad.type,
        status: row.adGroupAd.status,
        approvalStatus: row.adGroupAd.policySummary.approvalStatus || 'UNKNOWN'
      };
    }
  } catch (e) {
    Logger.log("Error querying ads: %s", e);
  }

  return ads;
}


/**
 * Compares previous and current snapshots to detect status changes
 * @param {Object} previousSnapshot The previous ad snapshot
 * @param {Object} currentAds The current ad statuses
 * @return {Array} Array of change objects
 */
function detectStatusChanges(previousSnapshot, currentAds) {
  var changes = [];
  var accountName = AdsApp.currentAccount().getName();
  var accountId = AdsApp.currentAccount().getCustomerId();
  var timestamp = new Date();

  // Check for changes in existing ads and new ads
  for (var adId in currentAds) {
    var current = currentAds[adId];
    var previous = previousSnapshot[adId];

    if (!previous) {
      // New ad - only log if this isn't the first run
      if (Object.keys(previousSnapshot).length > 0) {
        changes.push({
          timestamp: timestamp,
          accountName: accountName,
          accountId: accountId,
          campaignName: current.campaignName,
          adGroupName: current.adGroupName,
          adId: adId,
          adType: current.adType,
          previousStatus: 'N/A',
          newStatus: current.status,
          previousApprovalStatus: 'N/A',
          newApprovalStatus: current.approvalStatus,
          changeType: 'NEW_AD'
        });
      }
    } else {
      // Existing ad - check for status changes
      var statusChanged = previous.status !== current.status;
      var approvalChanged = previous.approvalStatus !== current.approvalStatus;

      if (statusChanged || approvalChanged) {
        var changeType = getChangeType(statusChanged, approvalChanged, current.status, current.approvalStatus);

        changes.push({
          timestamp: timestamp,
          accountName: accountName,
          accountId: accountId,
          campaignName: current.campaignName,
          adGroupName: current.adGroupName,
          adId: adId,
          adType: current.adType,
          previousStatus: previous.status,
          newStatus: current.status,
          previousApprovalStatus: previous.approvalStatus,
          newApprovalStatus: current.approvalStatus,
          changeType: changeType
        });
      }
    }
  }

  // Check for removed ads
  for (var adId in previousSnapshot) {
    if (!currentAds[adId]) {
      var previous = previousSnapshot[adId];

      changes.push({
        timestamp: timestamp,
        accountName: accountName,
        accountId: accountId,
        campaignName: previous.campaignName,
        adGroupName: previous.adGroupName,
        adId: adId,
        adType: previous.adType,
        previousStatus: previous.status,
        newStatus: 'REMOVED',
        previousApprovalStatus: previous.approvalStatus,
        newApprovalStatus: 'N/A',
        changeType: 'AD_REMOVED'
      });
    }
  }

  return changes;
}


/**
 * Determines the type of change for logging purposes
 * @param {boolean} statusChanged Whether the status changed
 * @param {boolean} approvalChanged Whether the approval status changed
 * @param {string} newStatus The new status
 * @param {string} newApprovalStatus The new approval status
 * @return {string} The change type description
 */
function getChangeType(statusChanged, approvalChanged, newStatus, newApprovalStatus) {
  var types = [];

  if (statusChanged) {
    if (newStatus === 'ENABLED') {
      types.push('ENABLED');
    } else if (newStatus === 'PAUSED') {
      types.push('PAUSED');
    } else if (newStatus === 'REMOVED') {
      types.push('REMOVED');
    } else {
      types.push('STATUS_CHANGED');
    }
  }

  if (approvalChanged) {
    if (newApprovalStatus === 'DISAPPROVED') {
      types.push('DISAPPROVED');
    } else if (newApprovalStatus === 'APPROVED') {
      types.push('APPROVED');
    } else if (newApprovalStatus === 'APPROVED_LIMITED') {
      types.push('APPROVED_LIMITED');
    } else if (newApprovalStatus === 'AREA_OF_INTEREST_ONLY') {
      types.push('AREA_OF_INTEREST_ONLY');
    } else if (newApprovalStatus === 'UNDER_REVIEW') {
      types.push('UNDER_REVIEW');
    } else {
      types.push('APPROVAL_CHANGED');
    }
  }

  return types.join(' + ');
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
      change.adGroupName,
      change.adId,
      change.adType,
      change.previousStatus,
      change.newStatus,
      change.previousApprovalStatus,
      change.newApprovalStatus,
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
 * Updates the ad snapshot sheet with current data
 * @param {Sheet} sheet The snapshot sheet
 * @param {Object} currentAds The current ad statuses
 */
function updateAdSnapshot(sheet, currentAds) {
  // Clear existing data (keep header)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, SNAPSHOT_HEADER.length).clear();
  }

  // Write current snapshot
  var rows = [];
  var timestamp = new Date();

  for (var adId in currentAds) {
    var ad = currentAds[adId];
    rows.push([
      ad.adId,
      ad.campaignName,
      ad.adGroupName,
      ad.adType,
      ad.status,
      ad.approvalStatus,
      timestamp
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, SNAPSHOT_HEADER.length).setValues(rows);
    Logger.log("Updated ad snapshot with %s ads.", rows.length);
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
 * Sends a Slack alert with a summary of ad status changes.
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

  var message = '*[Google Ads Alert] - Ad Status Changes Detected*\n\n' +
    'Account: *' + accountName + '* (' + accountId + ')\n\n' +
    '*Summary of Changes:*\n';

  if (summary.enabled > 0) {
    message += '\u2022 Ads Enabled: ' + summary.enabled + '\n';
  }
  if (summary.paused > 0) {
    message += '\u2022 Ads Paused: ' + summary.paused + '\n';
  }
  if (summary.removed > 0) {
    message += '\u2022 Ads Removed: ' + summary.removed + '\n';
  }
  if (summary.disapproved > 0) {
    message += '\u2022 Ads Disapproved: ' + summary.disapproved + '\n';
  }
  if (summary.approved > 0) {
    message += '\u2022 Ads Approved: ' + summary.approved + '\n';
  }
  if (summary.approvedLimited > 0) {
    message += '\u2022 Ads Approved (Limited): ' + summary.approvedLimited + '\n';
  }
  if (summary.areaOfInterestOnly > 0) {
    message += '\u2022 Ads Area of Interest Only: ' + summary.areaOfInterestOnly + '\n';
  }
  if (summary.underReview > 0) {
    message += '\u2022 Ads Under Review: ' + summary.underReview + '\n';
  }
  if (summary.newAds > 0) {
    message += '\u2022 New Ads Added: ' + summary.newAds + '\n';
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
    disapproved: 0,
    approved: 0,
    approvedLimited: 0,
    areaOfInterestOnly: 0,
    underReview: 0,
    newAds: 0,
    other: 0
  };

  for (var i = 0; i < changes.length; i++) {
    var changeType = changes[i].changeType;

    if (changeType === 'NEW_AD') {
      summary.newAds++;
    } else if (changeType.indexOf('ENABLED') !== -1) {
      summary.enabled++;
    } else if (changeType.indexOf('PAUSED') !== -1) {
      summary.paused++;
    } else if (changeType === 'AD_REMOVED' || changeType.indexOf('REMOVED') !== -1) {
      summary.removed++;
    } else if (changeType.indexOf('DISAPPROVED') !== -1) {
      summary.disapproved++;
    } else if (changeType.indexOf('APPROVED_LIMITED') !== -1) {
      summary.approvedLimited++;
    } else if (changeType.indexOf('AREA_OF_INTEREST_ONLY') !== -1) {
      summary.areaOfInterestOnly++;
    } else if (changeType.indexOf('APPROVED') !== -1) {
      summary.approved++;
    } else if (changeType.indexOf('UNDER_REVIEW') !== -1) {
      summary.underReview++;
    } else {
      summary.other++;
    }
  }

  return summary;
}
