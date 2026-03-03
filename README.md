# RunSafe

**Smart volume management for injury-prone runners.**

RunSafe helps runners manage their training load using the **25% rule** on a linearly weighted 12-week basis. Recent weeks are weighted higher for a more accurate picture of what the athlete can manage. Never increase weekly volume or intensity by more than 25% of your weighted average.

![RunSafe Dashboard](docs/dashboard-preview.png)

## Features

- **Weighted 12-Week Analysis**: Calculates safe volume limits using linearly weighted recent training history
- **Volume Tracking**: Weekly distance in kilometers
- **Intensity Monitoring**: Time spent above 80% of max heart rate
- **Total Work (Beta)**: Kilojoules as a combined load metric
- **Daily Recommendations**: Suggests whether to run and how far
- **Historical Comparison**: See how your actual running compared to recommendations
- **Strava Integration**: Automatically syncs your running data

## The 25% Rule

With a longer 12-week weighted window, the recommended cap is 25% above the weighted average. This accounts for the smoothing effect of the wider lookback. RunSafe enforces this by:

1. Calculating a linearly weighted average of your weekly volume over the past 12 complete weeks (recent weeks count more)
2. Setting your maximum for the current week at that weighted average + 25%
3. Tracking your progress and warning you as you approach the limit
4. Suggesting daily distances to optimize your training load

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/runsafe.git
cd runsafe
```

### 2. Create a virtual environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Strava API

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create a new application
3. Set the "Authorization Callback Domain" to `localhost`
4. Copy your Client ID and Client Secret

### 5. Create environment file

```bash
cp .env.example .env
```

Edit `.env` with your Strava credentials:

```
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=http://localhost:5001/strava/callback
SECRET_KEY=generate-a-random-secret-key
```

### 6. Run the application

```bash
python app.py
```

Visit `http://localhost:5001` and connect your Strava account.

## Usage

### Dashboard

The dashboard shows:

- **Today's Recommendation**: Whether to run and suggested distance
- **Weekly Progress**: Volume and intensity with progress bars
- **Next Week Preview**: Projected limits based on current week
- **Historical Comparison**: Past weeks vs. what was recommended

### Settings

Configure your **Max Heart Rate** for accurate intensity calculations. The default formula is `220 - age`, but you may want to adjust based on personal testing.

## Metrics Explained

### Volume (km)
Total distance run in kilometers. This is the primary metric for load management.

### Intensity (minutes >80% HR)
Time spent above 80% of your maximum heart rate. High-intensity running is more stressful on the body, so this is tracked separately.

### Total Work (kJ)
Kilojoules of energy expended, as reported by Strava. This combines both volume and intensity into a single metric. Currently in beta while we evaluate its usefulness.

## Tech Stack

- **Backend**: Python/Flask
- **Database**: SQLite (SQLAlchemy ORM)
- **Auth**: Strava OAuth 2.0
- **Frontend**: Vanilla HTML/CSS with Inter font
- **Styling**: Dark monochromatic theme with minimal accent colors

## Contributing

Contributions are welcome! Please open an issue to discuss proposed changes.

## License

MIT License - feel free to use this for your own training management.

---

*Train smart. Stay healthy. Run forever.*
