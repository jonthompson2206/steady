# Steady

Smart volume management for injury-prone runners. Tracks your running volume using the **25% rule** on a linearly weighted 12-week basis, helping you increase training load safely.

## Features

- **Strava integration** - syncs your running activities automatically
- **Weighted 12-week volume tracking** - recent weeks count more than older ones
- **Intensity monitoring** - estimates time above HR threshold per run
- **Weekly recommendations** - max volume, intensity, and long run based on your history
- **Weekly planner** - plan this week and next week with live comparison to recommendations
- **Charts** - performance over time, over/under analysis, 6-month outlook projections

## How It Works

1. Connect your Strava account
2. Steady syncs your running activities from the past year
3. A linearly weighted 12-week average is calculated (weight 12 for most recent, 1 for oldest)
4. Your recommended max for this week = weighted average × 1.25
5. Long run max = 30% of recommended weekly volume
6. Plan your week and see live feedback against recommendations

## Deploy to Netlify

### 1. Create a Strava API Application

1. Go to [https://www.strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an application with:
   - **Application Name**: Steady
   - **Category**: Training
   - **Website**: Your Netlify URL (can update after deploy)
   - **Authorization Callback Domain**: Your Netlify domain (e.g. `steady-app.netlify.app`)

### 2. Deploy

1. Push this repo to GitHub
2. Connect the repo to [Netlify](https://app.netlify.com)
3. Set **Publish directory** to `.` (root)
4. Set **Functions directory** to `netlify/functions`
5. Add environment variables in Netlify dashboard under **Site settings > Environment variables**:
   - `STRAVA_CLIENT_ID` - from your Strava API application
   - `STRAVA_CLIENT_SECRET` - from your Strava API application
6. Deploy

### 3. Update Strava Callback Domain

After your first deploy, update the **Authorization Callback Domain** in your Strava API settings to match your Netlify URL (e.g. `steady-app.netlify.app`).

### 4. Update Client ID

Edit `js/strava.js` and set `STRAVA_CLIENT_ID` to your Strava application's Client ID.

## Architecture

- **Static SPA** - single `index.html` with hash-based routing
- **Netlify Function** - `netlify/functions/strava-token.js` handles OAuth token exchange (keeps `client_secret` server-side)
- **Client-side storage** - IndexedDB for activities, localStorage for settings and planned runs
- **Direct API calls** - after authentication, the browser calls the Strava API directly

## Tech Stack

- Vanilla JavaScript (no framework)
- Chart.js for charts
- Inter font
- Netlify Functions (Node.js)
