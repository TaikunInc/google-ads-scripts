# Google Ads Scripts

A collection of Google Ads scripts for monitoring and automation.

## Keyword Status Tracker

`keyword-status-tracker.js` - Monitors keyword status changes and logs them to a Google Sheet with optional Slack notifications.

### Features

- Tracks keyword status changes (ENABLED, PAUSED, REMOVED)
- Tracks approval status changes (APPROVED, APPROVED_LIMITED, DISAPPROVED, UNDER_REVIEW)
- Detects new keywords added to the account
- Detects keywords removed from the account
- Logs all changes with timestamps to a Google Sheet
- Sends Slack notifications when changes are detected

### Setup

1. **Create a Google Sheet** with the following two sheets:
   - `Status Log` - Where status changes are recorded
   - `Keyword Snapshot` - Stores the last known status of each keyword

   The script will create these sheets automatically if they don't exist.

2. **Configure the script settings** at the top of the file:
   ```javascript
   var SPREADSHEET_URL = "YOUR_SPREADSHEET_URL_HERE";
   ```

3. **(Optional) Set up Slack notifications:**
   - Create a Slack incoming webhook
   - Create a helper spreadsheet with two columns:
     - Column A: Account ID (e.g., 123-456-7890)
     - Column B: Slack Webhook URL
   - Configure the helper spreadsheet URL:
     ```javascript
     var SLACK_HELPER_SPREADSHEET_URL = 'YOUR_SLACK_HELPER_SPREADSHEET_URL_HERE';
     ```

4. **Add the script to Google Ads:**
   - Go to Google Ads > Tools & Settings > Scripts
   - Create a new script
   - Paste the contents of `keyword-status-tracker.js`
   - Authorize the script
   - Schedule it to run at your desired frequency (daily recommended)

### How It Works

1. **First Run:** The script captures the current state of all keywords and stores them in the "Keyword Snapshot" sheet. No changes are logged on the first run.

2. **Subsequent Runs:** The script compares the current keyword statuses against the snapshot and logs any changes to the "Status Log" sheet.

3. **Change Detection:** The script detects:
   - Status changes (e.g., ENABLED to PAUSED)
   - Approval status changes (e.g., APPROVED to DISAPPROVED)
   - New keywords added
   - Keywords removed

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
| Previous Approval Status | Approval status before the change |
| New Approval Status | Approval status after the change |
| Change Type | Description of the change type |

### Scheduling Recommendations

- **Daily:** Recommended for most accounts to catch changes without excessive API usage
- **Hourly:** For high-volume accounts or time-sensitive monitoring
- **Weekly:** For smaller accounts with infrequent changes

### Troubleshooting

- **No changes detected:** This is normal if no keyword statuses have changed since the last run
- **First run shows no changes:** Expected behavior - the first run only creates the baseline snapshot
- **Slack notifications not working:** Verify the webhook URL and helper spreadsheet configuration
