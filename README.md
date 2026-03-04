# Google SERP Ad Scraper

Monitors competitor ad copy on Google Search by scraping SERPs for a set of keywords and tracking changes over time.

Runs as a scheduled GitHub Actions workflow. Results are logged to Google Sheets.

## What it does

- Searches Google for your keywords (geo-targeted to the **UK**)
- Extracts all paid ads — headlines, descriptions, display URLs, sitelinks
- Logs every ad seen to a running **Ad Copy Log** sheet
- Maintains a **Snapshot** of unique ads with first/last seen dates and frequency
- Detects **new ads**, **changed descriptions**, and **disappeared ads** between runs
- Sends **Slack notifications** when changes are detected (optional)

## Setup

### 1. SerpApi

Sign up at [serpapi.com](https://serpapi.com) and get an API key. The free tier provides 100 searches/month.

### 2. Google Sheets

1. Create a new Google Sheet (the script will auto-create the required tabs)
2. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 3. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing) and enable the **Google Sheets API**
3. Create a **Service Account** and download the JSON key
4. Share your Google Sheet with the service account email address (as Editor)

### 4. GitHub Secrets

Add these secrets in your repo under **Settings > Secrets and variables > Actions**:

| Secret | Description |
|---|---|
| `SERPAPI_KEY` | Your SerpApi API key |
| `GOOGLE_SHEETS_ID` | The Sheet ID from step 2 |
| `GOOGLE_CREDENTIALS` | The full JSON contents of your service account key file |
| `KEYWORDS` | Comma-separated keywords, e.g. `buy widgets uk,best widget supplier` |
| `SLACK_WEBHOOK_URL` | *(Optional)* Slack incoming webhook URL |

### 5. Schedule

The workflow runs daily at 8am UTC by default. Edit `.github/workflows/serp-ad-scraper.yml` to change the cron schedule.

You can also trigger it manually from the **Actions** tab using "Run workflow".

## Spreadsheet tabs

| Tab | Purpose |
|---|---|
| **Ad Copy Log** | Append-only log of every ad seen on every run |
| **Ad Snapshot** | Current state of all unique ads (first seen, last seen, times seen) |
| **Change Log** | Records when ads appear, change description, or disappear |

## Running locally

```bash
npm install

export SERPAPI_KEY="your-key"
export GOOGLE_SHEETS_ID="your-sheet-id"
export GOOGLE_CREDENTIALS='{"type":"service_account",...}'
export KEYWORDS="keyword one,keyword two"
export SLACK_WEBHOOK_URL=""  # optional

npm run scrape
```
