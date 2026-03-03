# Quick Start

1. Activate virtual environment:
   ```bash
   source venv/bin/activate
   ```

2. Set up .env file with your Strava credentials:
   ```bash
   cp .env.example .env
   # Then edit .env with your actual Strava API credentials
   ```

3. Install dependencies (if not already done):
   ```bash
   pip install -r requirements.txt
   ```

4. Run the app:
   ```bash
   python app.py
   ```
   
   OR for better performance:
   ```bash
   gunicorn --bind 0.0.0.0:5001 app:app
   ```

5. Open http://localhost:5001 in your browser

## Notes

- Logs are written to `logs/block.log`
- Database is stored in `instance/runsafe.db`
- Make sure your `.env` file has all required variables set
