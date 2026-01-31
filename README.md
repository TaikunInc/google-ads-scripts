# Google Ads Scripts

A collection of Google Ads scripts for monitoring status changes and automation.

## Scripts Overview

| Script | Description |
|--------|-------------|
| `keyword-status-tracker.js` | Monitors keyword status and serving status changes |
| `ad-group-status-tracker.js` | Monitors ad group status changes |
| `ad-status-tracker.js` | Monitors ad status and approval status changes |

All scripts support:
- Logging changes to Google Sheets
- Optional Slack notifications
- Automatic snapshot management for change detection

---

## Keyword Status Tracker

`keyword-status-tracker.js` - Monitors keyword status changes and logs them to a Google Sheet.

### Features

- Tracks keyword status changes (ENABLED, PAUSED, REMOVED)
- Tracks system serving status changes (ELIGIBLE, ELIGIBLE_LIMITED, NOT_ELIGIBLE, RARELY_SERVED)
- Detects new keywords added to the account
- Detects keywords removed from the account
- Logs all changes with timestamps to a Google Sheet
- Sends Slack notifications when changes are detected

### Required Sheets

- `Status Log` - Where status changes are recorded
- `Keyword Snapshot` - Stores the last known status of each keyword

### Status Log Columns

| Column | Description |
|--------|-------------|
| Timestamp | When the change was detected |
| Account Name | Google Ads account name |
| Account ID | Google Ads account ID |
| Campaign Name | Campaign containing the keyword |
| AdGroup Name | Ad group containing the keyword |
| Keyword ID | Unique identifier for the keyword |
| Keyword Text | The actual keyword text |
| Match Type | EXACT, PHRASE, or BROAD |
| Previous Status | Status before the change |
| New Status | Status after the change |
| Previous Serving Status | Serving status before the change |
| New Serving Status | Serving status after the change |
| Change Type | Description of the change type |

---

## Ad Group Status Tracker

`ad-group-status-tracker.js` - Monitors ad group status changes and logs them to a Google Sheet.

### Features

- Tracks ad group status changes (ENABLED, PAUSED, REMOVED)
- Detects new ad groups added to the account
- Detects ad groups removed from the account
- Logs all changes with timestamps to a Google Sheet
- Sends Slack notifications when changes are detected

### Required Sheets

- `Status Log` - Where status changes are recorded
- `AdGroup Snapshot` - Stores the last known status of each ad group

### Status Log Columns

| Column | Description |
|--------|-------------|
| Timestamp | When the change was detected |
| Account Name | Google Ads account name |
| Account ID | Google Ads account ID |
| Campaign Name | Campaign containing the ad group |
| AdGroup ID | Unique identifier for the ad group |
| AdGroup Name | Name of the ad group |
| Previous Status | Status before the change |
| New Status | Status after the change |
| Change Type | Description of the change type |

---

## Ad Status Tracker

`ad-status-tracker.js` - Monitors ad status and approval status changes and logs them to a Google Sheet.

### Features

- Tracks ad status changes (ENABLED, PAUSED, REMOVED)
- Tracks policy approval status changes (APPROVED, APPROVED_LIMITED, AREA_OF_INTEREST_ONLY, DISAPPROVED, UNDER_REVIEW)
- Detects new ads added to the account
- Detects ads removed from the account
- Logs all changes with timestamps to a Google Sheet
- Sends Slack notifications when changes are detected

### Required Sheets

- `Status Log` - Where status changes are recorded
- `Ad Snapshot` - Stores the last known status of each ad

### Status Log Columns

| Column | Description |
|--------|-------------|
| Timestamp | When the change was detected |
| Account Name | Google Ads account name |
| Account ID | Google Ads account ID |
| Campaign Name | Campaign containing the ad |
| AdGroup Name | Ad group containing the ad |
| Ad ID | Unique identifier for the ad |
| Ad Type | Type of ad (RESPONSIVE_SEARCH_AD, etc.) |
| Previous Status | Status before the change |
| New Status | Status after the change |
| Previous Approval Status | Approval status before the change |
| New Approval Status | Approval status after the change |
| Change Type | Description of the change type |

---

## Setup Instructions

### 1. Create a Google Sheet

Each script needs its own Google Sheet (or you can use separate sheets within one spreadsheet). The script will automatically create the required sheets if they don't exist.

### 2. Configure Script Settings

At the top of each script file, update the configuration:

```javascript
var SPREADSHEET_URL = "YOUR_SPREADSHEET_URL_HERE";
```

### 3. (Optional) Set Up Slack Notifications

1. Create a Slack incoming webhook for your channel
2. Create a helper spreadsheet with two columns:
   - Column A: Account ID (e.g., 123-456-7890)
   - Column B: Slack Webhook URL
3. Configure the helper spreadsheet URL in the script:
   ```javascript
   var SLACK_HELPER_SPREADSHEET_URL = 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE';
   ```

### 4. Add to Google Ads

1. Go to Google Ads > Tools & Settings > Scripts
2. Create a new script
3. Paste the contents of the desired script file
4. Authorize the script
5. Schedule it to run at your desired frequency

---

## How The Scripts Work

1. **First Run:** The script captures the current state and stores it in the snapshot sheet. No changes are logged on the first run.

2. **Subsequent Runs:** The script compares current statuses against the snapshot and logs any changes to the Status Log sheet.

3. **Change Detection:** Each script detects:
   - Status changes
   - New items added
   - Items removed
   - (For keywords/ads) Serving/approval status changes

---

## Scheduling Recommendations

| Frequency | Use Case |
|-----------|----------|
| **Hourly** | High-volume accounts, time-sensitive monitoring |
| **Daily** | Most accounts (recommended) |
| **Weekly** | Smaller accounts with infrequent changes |

---

## Troubleshooting

- **No changes detected:** Normal if no statuses have changed since the last run
- **First run shows no changes:** Expected - the first run only creates the baseline snapshot
- **Slack notifications not working:** Verify the webhook URL and helper spreadsheet configuration
- **UNKNOWN values:** Some fields may not be available for all entity types; this is expected behavior
