/**
 *
 * Google SERP Ad Scraper - Competitor Ad Copy Monitor
 *
 * Scrapes Google Search results for a set of keywords and extracts ad copy
 * (headlines, descriptions, display URLs) from paid ads. Logs all ad data
 * to a Google Sheet for tracking how competitor ad copy changes over time.
 *
 * Sends a Slack alert when new ads are detected or existing ads change.
 *
 * Searches are geo-targeted to the United Kingdom (gl=uk, hl=en).
 *
 * Requires a SERP API key from https://serpapi.com or compatible provider.
 *
 * Version 1.0
 *
 */


// --- SCRIPT SETTINGS ---

// URL of the spreadsheet to log scraped ad data.
// This spreadsheet will use three sheets:
// 1. "Ad Copy Log" - running log of all ads seen per scrape
// 2. "Ad Snapshot" - stores the last known ad copy per unique ad
// 3. "Change Log" - records when ad copy changes are detected
var SPREADSHEET_URL = "YOUR_SPREADSHEET_URL_HERE";

// --- SERP API Configuration ---
// API key for SerpApi (https://serpapi.com). Sign up for a free or paid plan.
var SERP_API_KEY = "YOUR_SERPAPI_KEY_HERE";

// --- Keywords to Monitor ---
// Add the keywords you want to track competitor ads for.
var KEYWORDS = [
  "example keyword 1",
  "example keyword 2",
  "example keyword 3"
];

// --- Geo-Targeting ---
// Country and language for UK-targeted searches.
var SEARCH_COUNTRY = "uk";
var SEARCH_LANGUAGE = "en";
var SEARCH_LOCATION = "United Kingdom";

// --- Slack Webhook Configuration ---
// URL of the Google Sheet containing account IDs and their corresponding Slack webhook URLs.
var SLACK_HELPER_SPREADSHEET_URL = 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE';
var SLACK_HELPER_SHEET_NAME = 'Sheet1';

// --- Sheet Names ---
var AD_COPY_LOG_SHEET_NAME = 'Ad Copy Log';
var AD_SNAPSHOT_SHEET_NAME = 'Ad Snapshot';
var CHANGE_LOG_SHEET_NAME = 'Change Log';

// --- NO CHANGES NEEDED BELOW THIS LINE ---

var AD_COPY_LOG_HEADER = [
  "Timestamp",
  "Keyword",
  "Position",
  "Ad Type",
  "Advertiser Domain",
  "Headline",
  "Description",
  "Display URL",
  "Sitelinks"
];

var AD_SNAPSHOT_HEADER = [
  "Ad Fingerprint",
  "Keyword",
  "Advertiser Domain",
  "Headline",
  "Description",
  "Display URL",
  "First Seen",
  "Last Seen",
  "Times Seen"
];

var CHANGE_LOG_HEADER = [
  "Timestamp",
  "Keyword",
  "Advertiser Domain",
  "Change Type",
  "Previous Headline",
  "New Headline",
  "Previous Description",
  "New Description"
];


/**
 * Main function - entry point for the script
 */
function main() {
  Logger.log("Starting Google SERP Ad Scraper...");

  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);

  // Prepare the sheets
  var adCopyLogSheet = getOrCreateSheet(ss, AD_COPY_LOG_SHEET_NAME, AD_COPY_LOG_HEADER);
  var snapshotSheet = getOrCreateSheet(ss, AD_SNAPSHOT_SHEET_NAME, AD_SNAPSHOT_HEADER);
  var changeLogSheet = getOrCreateSheet(ss, CHANGE_LOG_SHEET_NAME, CHANGE_LOG_HEADER);

  // Load previous snapshot
  var previousSnapshot = getAdSnapshot(snapshotSheet);
  Logger.log("Loaded %s ads from previous snapshot.", Object.keys(previousSnapshot).length);

  var allScrapedAds = [];
  var allChanges = [];
  var timestamp = new Date();

  // Scrape ads for each keyword
  for (var i = 0; i < KEYWORDS.length; i++) {
    var keyword = KEYWORDS[i];
    Logger.log("Scraping ads for keyword: %s", keyword);

    var ads = scrapeAdsForKeyword(keyword);
    Logger.log("Found %s ads for '%s'.", ads.length, keyword);

    for (var j = 0; j < ads.length; j++) {
      ads[j].keyword = keyword;
      ads[j].timestamp = timestamp;
      allScrapedAds.push(ads[j]);
    }

    // Pause between requests to respect rate limits
    if (i < KEYWORDS.length - 1) {
      Utilities.sleep(2000);
    }
  }

  Logger.log("Total ads scraped across all keywords: %s", allScrapedAds.length);

  // Log all scraped ads to the Ad Copy Log
  if (allScrapedAds.length > 0) {
    logScrapedAds(adCopyLogSheet, allScrapedAds);
  }

  // Detect changes against previous snapshot
  var currentSnapshot = buildCurrentSnapshot(allScrapedAds, timestamp);
  allChanges = detectAdChanges(previousSnapshot, currentSnapshot);
  Logger.log("Detected %s ad copy changes.", allChanges.length);

  // Log changes
  if (allChanges.length > 0) {
    logAdChanges(changeLogSheet, allChanges, timestamp);
    sendSlackAlert(allChanges, allScrapedAds.length);
  } else {
    Logger.log("No ad copy changes detected.");
  }

  // Update the snapshot
  updateAdSnapshot(snapshotSheet, currentSnapshot, previousSnapshot);

  Logger.log("Google SERP Ad Scraper completed.");
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
 * Scrapes ads from Google SERP for a given keyword using SerpApi
 * @param {string} keyword The search keyword
 * @return {Array} Array of ad objects
 */
function scrapeAdsForKeyword(keyword) {
  var ads = [];

  var url = "https://serpapi.com/search.json"
    + "?q=" + encodeURIComponent(keyword)
    + "&location=" + encodeURIComponent(SEARCH_LOCATION)
    + "&gl=" + SEARCH_COUNTRY
    + "&hl=" + SEARCH_LANGUAGE
    + "&api_key=" + SERP_API_KEY;

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      Logger.log("SerpApi request failed for '%s' with status %s: %s",
        keyword, responseCode, response.getContentText());
      return ads;
    }

    var data = JSON.parse(response.getContentText());

    // Extract top ads (above organic results)
    if (data.ads && data.ads.length > 0) {
      for (var i = 0; i < data.ads.length; i++) {
        var ad = data.ads[i];
        ads.push(parseAd(ad, i + 1, "Top"));
      }
    }

    // Extract bottom ads (below organic results) if available
    if (data.ads_bottom && data.ads_bottom.length > 0) {
      for (var j = 0; j < data.ads_bottom.length; j++) {
        var bottomAd = data.ads_bottom[j];
        ads.push(parseAd(bottomAd, j + 1, "Bottom"));
      }
    }

  } catch (e) {
    Logger.log("Error scraping ads for '%s': %s", keyword, e.message);
  }

  return ads;
}


/**
 * Parses a raw ad object from SerpApi into a structured format
 * @param {Object} ad The raw ad object from SerpApi
 * @param {number} position The ad position
 * @param {string} adType "Top" or "Bottom"
 * @return {Object} Parsed ad object
 */
function parseAd(ad, position, adType) {
  var headline = ad.title || "";
  var description = ad.description || "";
  var displayUrl = ad.displayed_link || "";
  var domain = extractDomain(ad.link || ad.displayed_link || "");

  // Extract sitelinks if present
  var sitelinks = "";
  if (ad.sitelinks && ad.sitelinks.length > 0) {
    var sitelinkTitles = [];
    for (var i = 0; i < ad.sitelinks.length; i++) {
      sitelinkTitles.push(ad.sitelinks[i].title || "");
    }
    sitelinks = sitelinkTitles.join(" | ");
  }

  return {
    position: adType + " " + position,
    adType: adType,
    domain: domain,
    headline: headline,
    description: description,
    displayUrl: displayUrl,
    sitelinks: sitelinks
  };
}


/**
 * Extracts the domain from a URL
 * @param {string} url The full URL
 * @return {string} The domain
 */
function extractDomain(url) {
  try {
    var match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\?]+)/i);
    return match ? match[1] : url;
  } catch (e) {
    return url;
  }
}


/**
 * Generates a fingerprint for an ad based on domain and headline
 * Used to track unique ads across scrapes
 * @param {string} keyword The keyword
 * @param {string} domain The advertiser domain
 * @param {string} headline The ad headline
 * @return {string} A fingerprint string
 */
function generateAdFingerprint(keyword, domain, headline) {
  return keyword.toLowerCase().trim() + "|" + domain.toLowerCase().trim() + "|" + headline.toLowerCase().trim();
}


/**
 * Logs scraped ads to the Ad Copy Log sheet
 * @param {Sheet} sheet The Ad Copy Log sheet
 * @param {Array} ads Array of ad objects
 */
function logScrapedAds(sheet, ads) {
  var rows = [];

  for (var i = 0; i < ads.length; i++) {
    var ad = ads[i];
    rows.push([
      ad.timestamp,
      ad.keyword,
      ad.position,
      ad.adType,
      ad.domain,
      ad.headline,
      ad.description,
      ad.displayUrl,
      ad.sitelinks
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, AD_COPY_LOG_HEADER.length).setValues(rows);
    Logger.log("Logged %s ads to Ad Copy Log.", rows.length);
  }
}


/**
 * Retrieves the previous ad snapshot from the spreadsheet
 * @param {Sheet} sheet The snapshot sheet
 * @return {Object} A map of ad fingerprints to their snapshot data
 */
function getAdSnapshot(sheet) {
  var snapshot = {};
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return snapshot;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, AD_SNAPSHOT_HEADER.length).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var fingerprint = row[0].toString();

    if (fingerprint) {
      snapshot[fingerprint] = {
        fingerprint: fingerprint,
        keyword: row[1].toString(),
        domain: row[2].toString(),
        headline: row[3].toString(),
        description: row[4].toString(),
        displayUrl: row[5].toString(),
        firstSeen: row[6],
        lastSeen: row[7],
        timesSeen: parseInt(row[8], 10) || 1
      };
    }
  }

  return snapshot;
}


/**
 * Builds the current snapshot from scraped ads
 * @param {Array} ads Array of scraped ad objects
 * @param {Date} timestamp Current timestamp
 * @return {Object} Map of fingerprints to ad data
 */
function buildCurrentSnapshot(ads, timestamp) {
  var snapshot = {};

  for (var i = 0; i < ads.length; i++) {
    var ad = ads[i];
    var fingerprint = generateAdFingerprint(ad.keyword, ad.domain, ad.headline);

    // If same fingerprint appears multiple times, keep the first occurrence
    if (!snapshot[fingerprint]) {
      snapshot[fingerprint] = {
        fingerprint: fingerprint,
        keyword: ad.keyword,
        domain: ad.domain,
        headline: ad.headline,
        description: ad.description,
        displayUrl: ad.displayUrl,
        lastSeen: timestamp,
        timesSeen: 1
      };
    }
  }

  return snapshot;
}


/**
 * Detects changes between previous and current ad snapshots
 * @param {Object} previousSnapshot Map of previous ad data
 * @param {Object} currentSnapshot Map of current ad data
 * @return {Array} Array of change objects
 */
function detectAdChanges(previousSnapshot, currentSnapshot) {
  var changes = [];
  var isFirstRun = Object.keys(previousSnapshot).length === 0;

  // Check for new ads and description changes
  for (var fingerprint in currentSnapshot) {
    var current = currentSnapshot[fingerprint];

    if (!previousSnapshot[fingerprint]) {
      // New ad detected
      if (!isFirstRun) {
        changes.push({
          keyword: current.keyword,
          domain: current.domain,
          changeType: "NEW_AD",
          previousHeadline: "N/A",
          newHeadline: current.headline,
          previousDescription: "N/A",
          newDescription: current.description
        });
      }
    } else {
      var previous = previousSnapshot[fingerprint];

      // Check if description changed (headline is part of fingerprint so it won't change)
      if (previous.description !== current.description) {
        changes.push({
          keyword: current.keyword,
          domain: current.domain,
          changeType: "DESCRIPTION_CHANGED",
          previousHeadline: previous.headline,
          newHeadline: current.headline,
          previousDescription: previous.description,
          newDescription: current.description
        });
      }
    }
  }

  // Check for disappeared ads
  if (!isFirstRun) {
    for (var prevFingerprint in previousSnapshot) {
      if (!currentSnapshot[prevFingerprint]) {
        var disappeared = previousSnapshot[prevFingerprint];
        changes.push({
          keyword: disappeared.keyword,
          domain: disappeared.domain,
          changeType: "AD_DISAPPEARED",
          previousHeadline: disappeared.headline,
          newHeadline: "N/A",
          previousDescription: disappeared.description,
          newDescription: "N/A"
        });
      }
    }
  }

  return changes;
}


/**
 * Logs ad copy changes to the Change Log sheet
 * @param {Sheet} sheet The Change Log sheet
 * @param {Array} changes Array of change objects
 * @param {Date} timestamp Current timestamp
 */
function logAdChanges(sheet, changes, timestamp) {
  var rows = [];

  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    rows.push([
      timestamp,
      change.keyword,
      change.domain,
      change.changeType,
      change.previousHeadline,
      change.newHeadline,
      change.previousDescription,
      change.newDescription
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CHANGE_LOG_HEADER.length).setValues(rows);
    Logger.log("Logged %s changes to Change Log.", rows.length);
  }
}


/**
 * Updates the ad snapshot sheet with current data, merging with previous history
 * @param {Sheet} sheet The snapshot sheet
 * @param {Object} currentSnapshot Current ad snapshot
 * @param {Object} previousSnapshot Previous ad snapshot
 */
function updateAdSnapshot(sheet, currentSnapshot, previousSnapshot) {
  // Merge: update timesSeen and firstSeen from previous where applicable
  var mergedSnapshot = {};

  for (var fingerprint in currentSnapshot) {
    var current = currentSnapshot[fingerprint];
    mergedSnapshot[fingerprint] = {
      fingerprint: current.fingerprint,
      keyword: current.keyword,
      domain: current.domain,
      headline: current.headline,
      description: current.description,
      displayUrl: current.displayUrl,
      firstSeen: previousSnapshot[fingerprint] ? previousSnapshot[fingerprint].firstSeen : current.lastSeen,
      lastSeen: current.lastSeen,
      timesSeen: previousSnapshot[fingerprint] ? previousSnapshot[fingerprint].timesSeen + 1 : 1
    };
  }

  // Write merged snapshot
  var rows = [];
  for (var fp in mergedSnapshot) {
    var ad = mergedSnapshot[fp];
    rows.push([
      ad.fingerprint,
      ad.keyword,
      ad.domain,
      ad.headline,
      ad.description,
      ad.displayUrl,
      ad.firstSeen,
      ad.lastSeen,
      ad.timesSeen
    ]);
  }

  // Clear existing data (keep header)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, AD_SNAPSHOT_HEADER.length).clear();
  }

  // Write new data
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, AD_SNAPSHOT_HEADER.length).setValues(rows);
  }

  Logger.log("Updated snapshot with %s ads.", rows.length);
}


/**
 * Sends a Slack alert summarizing ad copy changes
 * @param {Array} changes Array of change objects
 * @param {number} totalAds Total number of ads scraped in this run
 */
function sendSlackAlert(changes, totalAds) {
  var webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    Logger.log("No Slack webhook URL found. Skipping Slack notification.");
    return;
  }

  var categorized = categorizeChanges(changes);

  var message = "*SERP Ad Copy Monitor - Changes Detected*\n\n";
  message += "Total ads scraped this run: " + totalAds + "\n";
  message += "Total changes detected: " + changes.length + "\n\n";

  if (categorized.newAds.length > 0) {
    message += "*New Ads (" + categorized.newAds.length + "):*\n";
    for (var i = 0; i < categorized.newAds.length; i++) {
      var newAd = categorized.newAds[i];
      message += "- [" + newAd.keyword + "] " + newAd.domain + ": " + newAd.newHeadline + "\n";
    }
    message += "\n";
  }

  if (categorized.changedAds.length > 0) {
    message += "*Changed Ads (" + categorized.changedAds.length + "):*\n";
    for (var j = 0; j < categorized.changedAds.length; j++) {
      var changed = categorized.changedAds[j];
      message += "- [" + changed.keyword + "] " + changed.domain + "\n";
      message += "  Old: " + changed.previousDescription.substring(0, 80) + "...\n";
      message += "  New: " + changed.newDescription.substring(0, 80) + "...\n";
    }
    message += "\n";
  }

  if (categorized.disappearedAds.length > 0) {
    message += "*Disappeared Ads (" + categorized.disappearedAds.length + "):*\n";
    for (var k = 0; k < categorized.disappearedAds.length; k++) {
      var gone = categorized.disappearedAds[k];
      message += "- [" + gone.keyword + "] " + gone.domain + ": " + gone.previousHeadline + "\n";
    }
  }

  sendSlackNotification(webhookUrl, message);
}


/**
 * Categorizes changes by type for reporting
 * @param {Array} changes Array of change objects
 * @return {Object} Categorized changes
 */
function categorizeChanges(changes) {
  var categorized = {
    newAds: [],
    changedAds: [],
    disappearedAds: []
  };

  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    switch (change.changeType) {
      case "NEW_AD":
        categorized.newAds.push(change);
        break;
      case "DESCRIPTION_CHANGED":
        categorized.changedAds.push(change);
        break;
      case "AD_DISAPPEARED":
        categorized.disappearedAds.push(change);
        break;
    }
  }

  return categorized;
}


/**
 * Gets the Slack webhook URL from the helper spreadsheet
 * @return {string|null} The webhook URL or null
 */
function getSlackWebhookUrl() {
  if (!SLACK_HELPER_SPREADSHEET_URL || SLACK_HELPER_SPREADSHEET_URL === 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE') {
    return null;
  }

  try {
    var helperSs = SpreadsheetApp.openByUrl(SLACK_HELPER_SPREADSHEET_URL);
    var helperSheet = helperSs.getSheetByName(SLACK_HELPER_SHEET_NAME);

    if (!helperSheet) {
      Logger.log("Slack helper sheet '%s' not found.", SLACK_HELPER_SHEET_NAME);
      return null;
    }

    var accountId = AdsApp.currentAccount().getCustomerId();
    var lastRow = helperSheet.getLastRow();

    if (lastRow <= 1) {
      return null;
    }

    var data = helperSheet.getRange(2, 1, lastRow - 1, 2).getValues();

    for (var i = 0; i < data.length; i++) {
      var sheetAccountId = data[i][0].toString().replace(/-/g, '').trim();
      var cleanAccountId = accountId.toString().replace(/-/g, '').trim();

      if (sheetAccountId === cleanAccountId) {
        return data[i][1].toString().trim();
      }
    }

    Logger.log("No webhook URL found for account ID: %s", accountId);
    return null;
  } catch (e) {
    Logger.log("Error fetching Slack webhook URL: %s", e.message);
    return null;
  }
}


/**
 * Sends a notification to Slack via webhook
 * @param {string} webhookUrl The Slack webhook URL
 * @param {string} message The message text
 */
function sendSlackNotification(webhookUrl, message) {
  try {
    var payload = JSON.stringify({ text: message });

    var options = {
      method: "post",
      contentType: "application/json",
      payload: payload,
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(webhookUrl, options);

    if (response.getResponseCode() === 200) {
      Logger.log("Slack notification sent successfully.");
    } else {
      Logger.log("Slack notification failed with status %s: %s",
        response.getResponseCode(), response.getContentText());
    }
  } catch (e) {
    Logger.log("Error sending Slack notification: %s", e.message);
  }
}
