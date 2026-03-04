/**
 * Google SERP Ad Scraper - Competitor Ad Copy Monitor
 *
 * Scrapes Google Search results via SerpApi for a set of keywords,
 * extracts paid ad copy, and logs everything to Google Sheets.
 * Detects new ads, changed descriptions, and disappeared ads.
 *
 * Searches are geo-targeted to the United Kingdom.
 *
 * Environment variables required:
 *   SERPAPI_KEY            - API key from https://serpapi.com
 *   GOOGLE_SHEETS_ID      - The Google Sheet ID for logging
 *   GOOGLE_CREDENTIALS    - JSON string of Google service account credentials
 *   KEYWORDS              - Comma-separated list of keywords to monitor
 *   SLACK_WEBHOOK_URL     - (Optional) Slack webhook for change notifications
 */

const { google } = require("googleapis");

// ---------------------------------------------------------------------------
// Configuration (from environment)
// ---------------------------------------------------------------------------

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const KEYWORDS = (process.env.KEYWORDS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

// UK geo-targeting
const SEARCH_COUNTRY = "uk";
const SEARCH_LANGUAGE = "en";
const SEARCH_LOCATION = "United Kingdom";

// Sheet names
const AD_COPY_LOG_SHEET = "Ad Copy Log";
const AD_SNAPSHOT_SHEET = "Ad Snapshot";
const CHANGE_LOG_SHEET = "Change Log";

// Headers
const AD_COPY_LOG_HEADER = [
  "Timestamp",
  "Keyword",
  "Position",
  "Ad Type",
  "Advertiser Domain",
  "Headline",
  "Description",
  "Display URL",
  "Sitelinks",
];

const AD_SNAPSHOT_HEADER = [
  "Ad Fingerprint",
  "Keyword",
  "Advertiser Domain",
  "Headline",
  "Description",
  "Display URL",
  "First Seen",
  "Last Seen",
  "Times Seen",
];

const CHANGE_LOG_HEADER = [
  "Timestamp",
  "Keyword",
  "Advertiser Domain",
  "Change Type",
  "Previous Headline",
  "New Headline",
  "Previous Description",
  "New Description",
];

// ---------------------------------------------------------------------------
// Google Sheets helpers
// ---------------------------------------------------------------------------

async function getSheetsClient() {
  const credentials = JSON.parse(GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** Ensure a sheet tab exists with the given header row. */
async function ensureSheet(sheets, sheetName, header) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEETS_ID,
  });
  const existing = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEETS_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    });
    console.log(`Created sheet: ${sheetName}`);
  }
}

/** Read all rows (excluding header) from a sheet. */
async function readSheet(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `'${sheetName}'!A2:Z`,
  });
  return res.data.values || [];
}

/** Append rows to a sheet. */
async function appendRows(sheets, sheetName, rows) {
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/** Overwrite all data rows in a sheet (keeps header). */
async function overwriteSheet(sheets, sheetName, rows) {
  // Clear existing data below header
  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `'${sheetName}'!A2:Z`,
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: `'${sheetName}'!A2`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }
}

// ---------------------------------------------------------------------------
// SerpApi
// ---------------------------------------------------------------------------

async function scrapeAdsForKeyword(keyword) {
  const params = new URLSearchParams({
    q: keyword,
    location: SEARCH_LOCATION,
    gl: SEARCH_COUNTRY,
    hl: SEARCH_LANGUAGE,
    api_key: SERPAPI_KEY,
  });

  const url = `https://serpapi.com/search.json?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    console.error(
      `SerpApi error for "${keyword}": ${res.status} ${await res.text()}`
    );
    return [];
  }

  const data = await res.json();
  const ads = [];

  // Top ads
  if (data.ads) {
    data.ads.forEach((ad, i) => ads.push(parseAd(ad, i + 1, "Top")));
  }

  // Bottom ads
  if (data.ads_bottom) {
    data.ads_bottom.forEach((ad, i) =>
      ads.push(parseAd(ad, i + 1, "Bottom"))
    );
  }

  return ads;
}

function parseAd(ad, position, adType) {
  const headline = ad.title || "";
  const description = ad.description || "";
  const displayUrl = ad.displayed_link || "";
  const domain = extractDomain(ad.link || ad.displayed_link || "");

  let sitelinks = "";
  if (ad.sitelinks && ad.sitelinks.length > 0) {
    sitelinks = ad.sitelinks.map((s) => s.title || "").join(" | ");
  }

  return {
    position: `${adType} ${position}`,
    adType,
    domain,
    headline,
    description,
    displayUrl,
    sitelinks,
  };
}

function extractDomain(url) {
  const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?]+)/i);
  return match ? match[1] : url;
}

// ---------------------------------------------------------------------------
// Snapshot & change detection
// ---------------------------------------------------------------------------

function fingerprint(keyword, domain, headline) {
  return `${keyword.toLowerCase().trim()}|${domain.toLowerCase().trim()}|${headline.toLowerCase().trim()}`;
}

function loadSnapshot(rows) {
  const snap = {};
  for (const row of rows) {
    const fp = row[0];
    if (!fp) continue;
    snap[fp] = {
      fingerprint: fp,
      keyword: row[1] || "",
      domain: row[2] || "",
      headline: row[3] || "",
      description: row[4] || "",
      displayUrl: row[5] || "",
      firstSeen: row[6] || "",
      lastSeen: row[7] || "",
      timesSeen: parseInt(row[8], 10) || 1,
    };
  }
  return snap;
}

function buildCurrentSnapshot(ads, timestamp) {
  const snap = {};
  for (const ad of ads) {
    const fp = fingerprint(ad.keyword, ad.domain, ad.headline);
    if (!snap[fp]) {
      snap[fp] = {
        fingerprint: fp,
        keyword: ad.keyword,
        domain: ad.domain,
        headline: ad.headline,
        description: ad.description,
        displayUrl: ad.displayUrl,
        lastSeen: timestamp,
        timesSeen: 1,
      };
    }
  }
  return snap;
}

function detectChanges(previous, current) {
  const changes = [];
  const isFirstRun = Object.keys(previous).length === 0;

  for (const fp in current) {
    const cur = current[fp];
    if (!previous[fp]) {
      if (!isFirstRun) {
        changes.push({
          keyword: cur.keyword,
          domain: cur.domain,
          changeType: "NEW_AD",
          previousHeadline: "N/A",
          newHeadline: cur.headline,
          previousDescription: "N/A",
          newDescription: cur.description,
        });
      }
    } else if (previous[fp].description !== cur.description) {
      changes.push({
        keyword: cur.keyword,
        domain: cur.domain,
        changeType: "DESCRIPTION_CHANGED",
        previousHeadline: previous[fp].headline,
        newHeadline: cur.headline,
        previousDescription: previous[fp].description,
        newDescription: cur.description,
      });
    }
  }

  if (!isFirstRun) {
    for (const fp in previous) {
      if (!current[fp]) {
        changes.push({
          keyword: previous[fp].keyword,
          domain: previous[fp].domain,
          changeType: "AD_DISAPPEARED",
          previousHeadline: previous[fp].headline,
          newHeadline: "N/A",
          previousDescription: previous[fp].description,
          newDescription: "N/A",
        });
      }
    }
  }

  return changes;
}

function mergeSnapshots(current, previous, timestamp) {
  const rows = [];
  for (const fp in current) {
    const cur = current[fp];
    const prev = previous[fp];
    rows.push([
      fp,
      cur.keyword,
      cur.domain,
      cur.headline,
      cur.description,
      cur.displayUrl,
      prev ? prev.firstSeen : timestamp,
      timestamp,
      prev ? prev.timesSeen + 1 : 1,
    ]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

async function sendSlackAlert(changes, totalAds) {
  if (!SLACK_WEBHOOK_URL) return;

  const newAds = changes.filter((c) => c.changeType === "NEW_AD");
  const changed = changes.filter((c) => c.changeType === "DESCRIPTION_CHANGED");
  const disappeared = changes.filter((c) => c.changeType === "AD_DISAPPEARED");

  let msg = `*SERP Ad Copy Monitor - Changes Detected*\n\n`;
  msg += `Total ads scraped: ${totalAds}\n`;
  msg += `Total changes: ${changes.length}\n\n`;

  if (newAds.length > 0) {
    msg += `*New Ads (${newAds.length}):*\n`;
    for (const a of newAds) {
      msg += `- [${a.keyword}] ${a.domain}: ${a.newHeadline}\n`;
    }
    msg += "\n";
  }

  if (changed.length > 0) {
    msg += `*Changed Ads (${changed.length}):*\n`;
    for (const a of changed) {
      msg += `- [${a.keyword}] ${a.domain}\n`;
      msg += `  Old: ${a.previousDescription.substring(0, 80)}...\n`;
      msg += `  New: ${a.newDescription.substring(0, 80)}...\n`;
    }
    msg += "\n";
  }

  if (disappeared.length > 0) {
    msg += `*Disappeared Ads (${disappeared.length}):*\n`;
    for (const a of disappeared) {
      msg += `- [${a.keyword}] ${a.domain}: ${a.previousHeadline}\n`;
    }
  }

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg }),
  });

  if (res.ok) {
    console.log("Slack notification sent.");
  } else {
    console.error(`Slack notification failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Validate config
  if (!SERPAPI_KEY) throw new Error("SERPAPI_KEY environment variable is required");
  if (!GOOGLE_SHEETS_ID) throw new Error("GOOGLE_SHEETS_ID environment variable is required");
  if (!GOOGLE_CREDENTIALS) throw new Error("GOOGLE_CREDENTIALS environment variable is required");
  if (KEYWORDS.length === 0) throw new Error("KEYWORDS environment variable is required (comma-separated)");

  console.log(`Starting SERP Ad Scraper for ${KEYWORDS.length} keywords...`);

  const sheets = await getSheetsClient();

  // Ensure sheets exist
  await ensureSheet(sheets, AD_COPY_LOG_SHEET, AD_COPY_LOG_HEADER);
  await ensureSheet(sheets, AD_SNAPSHOT_SHEET, AD_SNAPSHOT_HEADER);
  await ensureSheet(sheets, CHANGE_LOG_SHEET, CHANGE_LOG_HEADER);

  // Load previous snapshot
  const previousRows = await readSheet(sheets, AD_SNAPSHOT_SHEET);
  const previousSnapshot = loadSnapshot(previousRows);
  console.log(`Loaded ${Object.keys(previousSnapshot).length} ads from previous snapshot.`);

  // Scrape all keywords
  const allAds = [];
  const timestamp = new Date().toISOString();

  for (let i = 0; i < KEYWORDS.length; i++) {
    const keyword = KEYWORDS[i];
    console.log(`Scraping: "${keyword}"...`);

    const ads = await scrapeAdsForKeyword(keyword);
    console.log(`  Found ${ads.length} ads.`);

    for (const ad of ads) {
      ad.keyword = keyword;
      allAds.push(ad);
    }

    // Rate-limit pause between requests
    if (i < KEYWORDS.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`Total ads scraped: ${allAds.length}`);

  // Log all ads to Ad Copy Log
  if (allAds.length > 0) {
    const logRows = allAds.map((ad) => [
      timestamp,
      ad.keyword,
      ad.position,
      ad.adType,
      ad.domain,
      ad.headline,
      ad.description,
      ad.displayUrl,
      ad.sitelinks,
    ]);
    await appendRows(sheets, AD_COPY_LOG_SHEET, logRows);
    console.log(`Logged ${logRows.length} ads to Ad Copy Log.`);
  }

  // Detect changes
  const currentSnapshot = buildCurrentSnapshot(allAds, timestamp);
  const changes = detectChanges(previousSnapshot, currentSnapshot);
  console.log(`Detected ${changes.length} changes.`);

  // Log changes
  if (changes.length > 0) {
    const changeRows = changes.map((c) => [
      timestamp,
      c.keyword,
      c.domain,
      c.changeType,
      c.previousHeadline,
      c.newHeadline,
      c.previousDescription,
      c.newDescription,
    ]);
    await appendRows(sheets, CHANGE_LOG_SHEET, changeRows);
    await sendSlackAlert(changes, allAds.length);
  } else {
    console.log("No changes detected.");
  }

  // Update snapshot
  const snapshotRows = mergeSnapshots(currentSnapshot, previousSnapshot, timestamp);
  await overwriteSheet(sheets, AD_SNAPSHOT_SHEET, snapshotRows);
  console.log(`Snapshot updated with ${snapshotRows.length} ads.`);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
