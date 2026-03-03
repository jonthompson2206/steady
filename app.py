"""
Flow - Running Volume Management App for Injury-Prone Runners
Tracks volume, intensity, and total work on a linearly weighted 12-week basis.
"""

import os
import math
import requests
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta
from flask import Flask, render_template, redirect, url_for, session, request, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
database_url = os.getenv('DATABASE_URL', 'sqlite:///runsafe.db')
if database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Setup logging
if not os.path.exists('logs'):
    os.mkdir('logs')

file_handler = RotatingFileHandler('logs/block.log', maxBytes=10240, backupCount=5)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s: %(message)s'
))
file_handler.setLevel(logging.INFO)
app.logger.addHandler(file_handler)
app.logger.setLevel(logging.INFO)

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Strava OAuth Config
STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
STRAVA_REDIRECT_URI = os.getenv('STRAVA_REDIRECT_URI', 'http://localhost:5001/strava/callback')

# Validate required environment variables
required_vars = ['SECRET_KEY', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']
missing = [v for v in required_vars if not os.getenv(v)]
if missing:
    print(f"ERROR: Missing required environment variables: {', '.join(missing)}")
    print("Please set these in your .env file")
    exit(1)

# ============================================================================
# DATABASE MODELS
# ============================================================================

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    strava_id = db.Column(db.Integer, unique=True, nullable=False)
    username = db.Column(db.String(100))
    access_token = db.Column(db.String(200))
    refresh_token = db.Column(db.String(200))
    token_expires_at = db.Column(db.Integer)
    max_heart_rate = db.Column(db.Integer, default=190)  # User can customize
    # Intensity method: 'hr' or 'pace'
    intensity_method = db.Column(db.String(10), default='hr')
    # Intensity thresholds
    hr_intensity_percent = db.Column(db.Float, default=80.0)  # % of max HR that counts as intensity
    # VDOT-based pace settings
    race_type = db.Column(db.String(20), default=None)  # '5k', '10k', 'half_marathon'
    race_time_seconds = db.Column(db.Integer, default=None)  # Race time in seconds
    # Deprecated manual thresholds (kept for backwards compatibility, not used in current calc)
    pace_threshold_seconds_per_km = db.Column(db.Float, default=None)
    power_threshold_watts = db.Column(db.Float, default=None)
    pace_threshold_min_per_km = db.Column(db.Float, default=None)  # Deprecated - FTP now derived from race time
    # Physical settings (kept for potential future use)
    body_mass_kg = db.Column(db.Float, default=None)  # Body mass in kg
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    activities = db.relationship('Activity', backref='user', lazy='dynamic')

class Activity(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    strava_id = db.Column(db.BigInteger, unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(200))
    activity_type = db.Column(db.String(50))
    distance_km = db.Column(db.Float, default=0)  # in km
    moving_time_seconds = db.Column(db.Integer, default=0)
    elapsed_time_seconds = db.Column(db.Integer, default=0)
    total_elevation_gain = db.Column(db.Float, default=0)
    average_heartrate = db.Column(db.Float)
    max_heartrate = db.Column(db.Float)
    average_power = db.Column(db.Float)  # Average power in watts (from power meter or Strava estimated)
    # Legacy total work (kJ) field, kept in DB but no longer used in the app
    kilojoules = db.Column(db.Float)
    time_above_80_hr = db.Column(db.Integer, default=0)  # seconds above 80% max HR
    intensity_km = db.Column(db.Float, default=0.0)  # Deprecated - intensity now tracked via time_above_80_hr
    tss = db.Column(db.Float, default=0.0)  # Deprecated - no longer calculated
    start_date = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    polyline = db.Column(db.Text)  # Encoded polyline for route map
    start_latitude = db.Column(db.Float)
    start_longitude = db.Column(db.Float)

class PlannedRun(db.Model):
    """Planned runs for weekly planning."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    week_start_date = db.Column(db.DateTime, nullable=False)  # Monday of the week
    day_of_week = db.Column(db.Integer, nullable=False)  # 0=Monday, 6=Sunday
    name = db.Column(db.String(200), default='Run')
    distance_km = db.Column(db.Float, default=0)
    intensity_km = db.Column(db.Float, default=0)  # Stores intensity minutes (column name kept for DB compat)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = db.relationship('User', backref='planned_runs')

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ============================================================================
# STRAVA OAUTH
# ============================================================================

def refresh_strava_token(user):
    """Refresh the Strava access token if expired."""
    if user.token_expires_at and user.token_expires_at < datetime.utcnow().timestamp():
        response = requests.post(
            'https://www.strava.com/oauth/token',
            data={
                'client_id': STRAVA_CLIENT_ID,
                'client_secret': STRAVA_CLIENT_SECRET,
                'grant_type': 'refresh_token',
                'refresh_token': user.refresh_token
            }
        )
        if response.status_code == 200:
            tokens = response.json()
            user.access_token = tokens['access_token']
            user.refresh_token = tokens['refresh_token']
            user.token_expires_at = tokens['expires_at']
            db.session.commit()
    return user.access_token

@app.route('/login')
def login():
    """Redirect to Strava OAuth."""
    if not STRAVA_CLIENT_ID:
        return render_template('setup.html')
    
    auth_url = (
        f"https://www.strava.com/oauth/authorize?"
        f"client_id={STRAVA_CLIENT_ID}&"
        f"redirect_uri={STRAVA_REDIRECT_URI}&"
        f"response_type=code&"
        f"scope=read,activity:read_all"
    )
    return redirect(auth_url)

@app.route('/strava/callback')
def strava_callback():
    """Handle Strava OAuth callback."""
    code = request.args.get('code')
    if not code:
        return redirect(url_for('index'))
    
    # Exchange code for token
    response = requests.post(
        'https://www.strava.com/oauth/token',
        data={
            'client_id': STRAVA_CLIENT_ID,
            'client_secret': STRAVA_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }
    )
    
    if response.status_code != 200:
        return redirect(url_for('index'))
    
    data = response.json()
    athlete = data['athlete']
    
    # Find or create user
    user = User.query.filter_by(strava_id=athlete['id']).first()
    if not user:
        user = User(
            strava_id=athlete['id'],
            username=athlete.get('firstname', '') + ' ' + athlete.get('lastname', '')
        )
        db.session.add(user)
    
    user.access_token = data['access_token']
    user.refresh_token = data['refresh_token']
    user.token_expires_at = data['expires_at']
    db.session.commit()
    
    login_user(user)
    
    # Sync activities after login
    sync_activities(user)
    
    return redirect(url_for('dashboard'))

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

# ============================================================================
# STRAVA DATA SYNC
# ============================================================================

def sync_activities(user, days=365):
    """Sync running activities from Strava for the past N days (default 12 months)."""
    token = refresh_strava_token(user)
    
    after = int((datetime.utcnow() - timedelta(days=days)).timestamp())
    
    page = 1
    while True:
        response = requests.get(
            'https://www.strava.com/api/v3/athlete/activities',
            headers={'Authorization': f'Bearer {token}'},
            params={'after': after, 'page': page, 'per_page': 100}
        )
        
        if response.status_code != 200:
            break
        
        activities = response.json()
        if not activities:
            break
        
        for act in activities:
            # Only process running activities
            if act['type'] not in ['Run', 'VirtualRun', 'TrailRun']:
                continue
            
            # Check if already exists
            existing = Activity.query.filter_by(strava_id=act['id']).first()
            if existing:
                continue
            
            # Fetch detailed activity for heart rate data
            detail_response = requests.get(
                f"https://www.strava.com/api/v3/activities/{act['id']}",
                headers={'Authorization': f'Bearer {token}'}
            )
            
            detail = detail_response.json() if detail_response.status_code == 200 else act
            # Add activity ID to detail for stream fetching
            detail['id'] = act['id']
            
            # Calculate time above intensity threshold (HR or pace based)
            time_above_80 = estimate_time_above_threshold(detail, user, token)
            
            # Extract route data
            map_data = detail.get('map', {})
            polyline = map_data.get('polyline') or map_data.get('summary_polyline')
            start_latlng = detail.get('start_latlng') or act.get('start_latlng', [])
            
            activity = Activity(
                strava_id=act['id'],
                user_id=user.id,
                name=act.get('name', 'Run'),
                activity_type=act['type'],
                distance_km=act.get('distance', 0) / 1000,  # Convert m to km
                moving_time_seconds=act.get('moving_time', 0),
                elapsed_time_seconds=act.get('elapsed_time', 0),
                total_elevation_gain=act.get('total_elevation_gain', 0),
                average_heartrate=detail.get('average_heartrate'),
                max_heartrate=detail.get('max_heartrate'),
                average_power=detail.get('average_watts'),
                kilojoules=detail.get('kilojoules'),
                time_above_80_hr=time_above_80,
                start_date=datetime.fromisoformat(act['start_date_local'].replace('Z', '+00:00')),
                polyline=polyline,
                start_latitude=start_latlng[0] if len(start_latlng) >= 2 else None,
                start_longitude=start_latlng[1] if len(start_latlng) >= 2 else None
            )
            db.session.add(activity)
        
        db.session.commit()
        page += 1
        
        if len(activities) < 100:
            break

def resync_activities(user, start_date):
    """
    Re-sync running activities from Strava starting from a specific date.
    Updates existing activities and adds new ones.
    """
    token = refresh_strava_token(user)
    
    after = int(start_date.timestamp())
    
    updated_count = 0
    added_count = 0
    
    page = 1
    while True:
        response = requests.get(
            'https://www.strava.com/api/v3/athlete/activities',
            headers={'Authorization': f'Bearer {token}'},
            params={'after': after, 'page': page, 'per_page': 100}
        )
        
        if response.status_code != 200:
            break
        
        activities = response.json()
        if not activities:
            break
        
        for act in activities:
            # Only process running activities
            if act['type'] not in ['Run', 'VirtualRun', 'TrailRun']:
                continue
            
            # Fetch detailed activity for heart rate data
            detail_response = requests.get(
                f"https://www.strava.com/api/v3/activities/{act['id']}",
                headers={'Authorization': f'Bearer {token}'}
            )
            
            detail = detail_response.json() if detail_response.status_code == 200 else act
            # Add activity ID to detail for stream fetching
            detail['id'] = act['id']
            
            # Calculate time above intensity threshold (HR or pace based)
            time_above_80 = estimate_time_above_threshold(detail, user, token)
            
            # Extract route data
            map_data = detail.get('map', {})
            polyline = map_data.get('polyline') or map_data.get('summary_polyline')
            start_latlng = detail.get('start_latlng') or act.get('start_latlng', [])
            
            # Check if already exists
            existing = Activity.query.filter_by(strava_id=act['id']).first()
            
            if existing:
                # Update existing activity
                existing.name = act.get('name', 'Run')
                existing.activity_type = act['type']
                existing.distance_km = act.get('distance', 0) / 1000
                existing.moving_time_seconds = act.get('moving_time', 0)
                existing.elapsed_time_seconds = act.get('elapsed_time', 0)
                existing.total_elevation_gain = act.get('total_elevation_gain', 0)
                existing.average_heartrate = detail.get('average_heartrate')
                existing.max_heartrate = detail.get('max_heartrate')
                existing.average_power = detail.get('average_watts')
                existing.kilojoules = detail.get('kilojoules')
                existing.time_above_80_hr = time_above_80
                existing.start_date = datetime.fromisoformat(act['start_date_local'].replace('Z', '+00:00'))
                existing.polyline = polyline
                existing.start_latitude = start_latlng[0] if len(start_latlng) >= 2 else None
                existing.start_longitude = start_latlng[1] if len(start_latlng) >= 2 else None
                updated_count += 1
            else:
                # Add new activity
                activity = Activity(
                    strava_id=act['id'],
                    user_id=user.id,
                    name=act.get('name', 'Run'),
                    activity_type=act['type'],
                    distance_km=act.get('distance', 0) / 1000,
                    moving_time_seconds=act.get('moving_time', 0),
                    elapsed_time_seconds=act.get('elapsed_time', 0),
                    total_elevation_gain=act.get('total_elevation_gain', 0),
                    average_heartrate=detail.get('average_heartrate'),
                    max_heartrate=detail.get('max_heartrate'),
                    average_power=detail.get('average_watts'),
                    kilojoules=detail.get('kilojoules'),
                    time_above_80_hr=time_above_80,
                    start_date=datetime.fromisoformat(act['start_date_local'].replace('Z', '+00:00')),
                    polyline=polyline,
                    start_latitude=start_latlng[0] if len(start_latlng) >= 2 else None,
                    start_longitude=start_latlng[1] if len(start_latlng) >= 2 else None
                )
                db.session.add(activity)
                added_count += 1
        
        db.session.commit()
        page += 1
        
        if len(activities) < 100:
            break
    
    return {'updated': updated_count, 'added': added_count}

def calculate_vdot_from_race_time(race_type, race_time_seconds):
    """
    Calculate VDOT from race time using Daniels' formulas.
    Based on Jack Daniels' Running Formula (Daniels & Gilbert, 1979).
    
    Uses both parts of the Daniels equation:
    1. Oxygen cost (VO2) as a function of velocity
    2. Fraction of VO2max (%VO2max) sustainable for the race duration
    
    VDOT = VO2 / %VO2max
    
    Returns VDOT value.
    """
    race_time_minutes = race_time_seconds / 60.0
    race_distance_meters = {
        '5k': 5000,
        '10k': 10000,
        'half_marathon': 21097.5
    }.get(race_type, 5000)
    
    # Convert to meters per minute
    velocity_m_per_min = race_distance_meters / race_time_minutes
    
    # Part 1: Oxygen cost (VO2) as a function of velocity (m/min)
    # VO2 = -4.60 + 0.182258 * v + 0.000104 * v^2
    vo2 = -4.60 + (0.182258 * velocity_m_per_min) + (0.000104 * velocity_m_per_min * velocity_m_per_min)
    
    # Part 2: Fraction of VO2max sustainable for race duration (Daniels' drop-dead formula)
    # %VO2max = 0.8 + 0.1894393 * e^(-0.012778*t) + 0.2989558 * e^(-0.1932605*t)
    # where t is race time in minutes
    pct_vo2max = (0.8
                  + 0.1894393 * math.exp(-0.012778 * race_time_minutes)
                  + 0.2989558 * math.exp(-0.1932605 * race_time_minutes))
    
    # VDOT = VO2 / %VO2max
    if pct_vo2max <= 0:
        return 20.0
    
    vdot = vo2 / pct_vo2max
    
    return max(round(vdot, 1), 20.0)  # Minimum reasonable VDOT

def _vo2_to_pace(target_vo2):
    """
    Convert a target VO2 (ml/kg/min) to running pace (seconds/km).
    
    Inverts the Daniels oxygen cost equation:
        VO2 = -4.60 + 0.182258*v + 0.000104*v^2
    
    Solves the quadratic for velocity (m/min), then converts to s/km.
    """
    # Rearrange to: 0.000104*v^2 + 0.182258*v - (target_vo2 + 4.60) = 0
    a = 0.000104
    b = 0.182258
    c = -(target_vo2 + 4.60)
    discriminant = b * b - 4 * a * c
    if discriminant < 0:
        return 999.0
    velocity = (-b + math.sqrt(discriminant)) / (2 * a)  # m/min
    if velocity <= 0:
        return 999.0
    return 1000.0 / velocity * 60.0  # seconds per km


def calculate_easy_pace_from_vdot(vdot):
    """
    Calculate easy pace threshold from VDOT using Daniels' model.
    
    Easy pace upper limit corresponds to ~70% of VO2max, which is
    the boundary between Daniels' E (easy) and M (marathon) zones.
    This is used as the intensity threshold — any pace faster than
    this is considered moderate-to-hard effort.
    
    Returns easy pace threshold in seconds per km.
    """
    if vdot <= 0:
        return 999  # Very slow pace if invalid VDOT
    
    # Easy upper limit is at ~70% of VO2max (Daniels' E zone boundary)
    # Find the pace at which VO2 = 70% of VDOT
    target_vo2 = vdot * 0.70
    easy_pace_seconds_per_km = _vo2_to_pace(target_vo2)
    
    return max(easy_pace_seconds_per_km, 180.0)  # Minimum 3:00/km pace


def fetch_activity_streams(activity_id, token, stream_types=['heartrate', 'velocity_smooth']):
    """
    Fetch detailed time-series streams from Strava API for an activity.
    Returns a dict with stream data keyed by stream type.
    """
    try:
        response = requests.get(
            f'https://www.strava.com/api/v3/activities/{activity_id}/streams',
            headers={'Authorization': f'Bearer {token}'},
            params={'keys': ','.join(stream_types), 'key_by_type': 'true'}
        )
        
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        app.logger.error(f'Error fetching streams for activity {activity_id}: {str(e)}')
    
    return {}

def calculate_time_above_threshold_from_streams(streams, threshold_value, stream_type, is_pace=False, is_power=False):
    """
    Calculate actual time spent above threshold from stream data.
    
    Args:
        streams: Dict of stream data from Strava
        threshold_value: Threshold value to compare against
        stream_type: Type of stream ('heartrate', 'velocity_smooth', 'watts')
        is_pace: If True, stream is pace (lower values = faster = above threshold)
        is_power: If True, stream is power (higher values = above threshold)
    
    Returns:
        Seconds above threshold
    """
    if stream_type not in streams:
        return 0
    
    stream_data = streams[stream_type]
    if not stream_data or 'data' not in stream_data:
        return 0
    
    data_points = stream_data['data']
    if not data_points:
        return 0
    
    # Get resolution (time between data points in seconds)
    try:
        resolution = float(stream_data.get('resolution', 1.0))  # Default 1 second, ensure it's a float
    except (ValueError, TypeError):
        resolution = 1.0  # Default if resolution is not numeric
    
    time_above = 0.0
    
    for value in data_points:
        if value is None:
            continue
        
        # Convert to float, skip if not numeric
        try:
            value_float = float(value)
        except (ValueError, TypeError):
            continue
        
        # Ensure threshold_value is also numeric
        try:
            threshold_float = float(threshold_value)
        except (ValueError, TypeError):
            continue
        
        if is_pace:
            # For pace: value is velocity (m/s), threshold is velocity threshold (m/s)
            # Faster pace = higher velocity = above threshold
            if value_float > threshold_float:
                time_above += resolution
        elif is_power:
            # For power: higher value = above threshold
            if value_float > threshold_float:
                time_above += resolution
        else:
            # For heart rate: higher value = above threshold
            if value_float > threshold_float:
                time_above += resolution
    
    return int(time_above)

def estimate_time_above_threshold(activity, user, token=None):
    """
    Calculate time spent above intensity threshold using user-defined thresholds.
    Uses detailed stream data when available to extract actual periods above threshold.
    Falls back to estimation based on averages when streams aren't available.
    
    Intensity is counted when heart rate is above threshold OR pace is faster than threshold OR power is above threshold.
    Returns seconds above threshold.
    
    NOTE: This function returns time, but intensity is displayed as distance (km).
    The distance is calculated separately using velocity streams during intense periods.
    """
    moving_time = activity.get('moving_time', 0)
    if moving_time == 0:
        return 0
    
    activity_id = activity.get('id')
    streams = {}
    
    # Try to fetch streams if we have an activity ID and token
    if activity_id and token:
        streams = fetch_activity_streams(activity_id, token)
    
    # Get HR threshold from user settings
    hr_percent = user.hr_intensity_percent if user.hr_intensity_percent else 80.0
    hr_threshold = user.max_heart_rate * (hr_percent / 100.0) if user.max_heart_rate else None
    
    # Get easy pace threshold from VDOT, if race data is available
    easy_pace_threshold = None  # seconds per km
    pace_velocity_threshold = None  # m/s
    if user.race_type and user.race_time_seconds:
        vdot = calculate_vdot_from_race_time(user.race_type, user.race_time_seconds)
        easy_pace_threshold = calculate_easy_pace_from_vdot(vdot)
        if easy_pace_threshold and easy_pace_threshold > 0:
            pace_velocity_threshold = 1000.0 / easy_pace_threshold  # m/s
    
    # Calculate time above threshold for each method
    hr_time_above = 0
    pace_time_above = 0
    
    # HR-based intensity time
    if hr_threshold:
        if 'heartrate' in streams:
            hr_time_above = calculate_time_above_threshold_from_streams(
                streams, hr_threshold, 'heartrate', is_pace=False, is_power=False
            )
        else:
            # Fall back to estimation based on average HR
            avg_hr = activity.get('average_heartrate')
            if avg_hr and hr_threshold > 0:
                ratio = avg_hr / hr_threshold
                if ratio >= 1.05:
                    hr_proportion = 0.85
                elif ratio >= 1.0:
                    hr_proportion = 0.65
                elif ratio >= 0.97:
                    hr_proportion = 0.40
                elif ratio >= 0.94:
                    hr_proportion = 0.20
                elif ratio >= 0.90:
                    hr_proportion = 0.10
                elif ratio >= 0.85:
                    hr_proportion = 0.05
                else:
                    hr_proportion = 0.02
                hr_time_above = int(moving_time * hr_proportion)
    
    # Pace-based intensity time (based on VDOT easy pace threshold)
    if pace_velocity_threshold:
        if 'velocity_smooth' in streams:
            stream_data = streams['velocity_smooth']
            if stream_data and 'data' in stream_data:
                data_points = stream_data['data']
                try:
                    resolution = float(stream_data.get('resolution', 1.0))
                except (ValueError, TypeError):
                    resolution = 1.0
                for velocity in data_points:
                    if velocity is not None:
                        try:
                            velocity_float = float(velocity)
                            if velocity_float > pace_velocity_threshold:  # Faster than threshold
                                pace_time_above += resolution
                        except (ValueError, TypeError):
                            continue
                pace_time_above = int(pace_time_above)
        else:
            # Fall back to estimation based on average pace
            distance_m = activity.get('distance', 0)
            if distance_m > 0 and easy_pace_threshold:
                distance_km = distance_m / 1000.0
                avg_pace_seconds_per_km = moving_time / distance_km
                
                if avg_pace_seconds_per_km < easy_pace_threshold:
                    pace_ratio = easy_pace_threshold / avg_pace_seconds_per_km
                    if pace_ratio >= 1.3:
                        pace_proportion = 0.85
                    elif pace_ratio >= 1.2:
                        pace_proportion = 0.70
                    elif pace_ratio >= 1.15:
                        pace_proportion = 0.55
                    elif pace_ratio >= 1.10:
                        pace_proportion = 0.40
                    elif pace_ratio >= 1.05:
                        pace_proportion = 0.25
                    else:
                        pace_proportion = 0.10
                    pace_time_above = int(moving_time * pace_proportion)
    
    # Use OR logic: intensity is when HR is high OR pace is fast
    # Take the maximum time above threshold from either method,
    # but account for overlap so we don't double-count.
    times_above = [hr_time_above, pace_time_above]
    max_time = max(times_above) if times_above else 0
    
    # If multiple conditions have significant time above threshold, there's likely overlap
    significant_times = [t for t in times_above if t > moving_time * 0.3]  # >30% of run
    if len(significant_times) >= 2:
        # Multiple high conditions - likely significant overlap
        other_times = [t for t in significant_times if t != max_time]
        if other_times:
            overlap_adjustment = sum(other_times) * 0.5
            combined_time = min(moving_time, max_time + overlap_adjustment)
        else:
            combined_time = max_time
    else:
        combined_time = max_time
    
    return int(combined_time)

def recalculate_intensity_for_user(user):
    """Recalculate time_above_80_hr for all activities when intensity settings change."""
    activities = Activity.query.filter_by(user_id=user.id).all()
    
    for activity in activities:
        activity_data = {
            'id': activity.strava_id,
            'average_heartrate': activity.average_heartrate,
            'moving_time': activity.moving_time_seconds,
            'distance': activity.distance_km * 1000,
            'average_watts': activity.average_power,
            'average_power': activity.average_power
        }
        token = refresh_strava_token(user)
        activity.time_above_80_hr = estimate_time_above_threshold(activity_data, user, token)
    
    db.session.commit()

# ============================================================================
# CALCULATION ENGINE
# ============================================================================

def get_week_boundaries(date):
    """Get the Monday and Sunday of the week containing the date."""
    monday = date - timedelta(days=date.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    sunday = monday + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return monday, sunday

def get_weekly_stats(user, time_period='4weeks'):
    """
    Get weekly stats for the specified time period.
    Returns list of dicts with volume, intensity (minutes), and long run per week.
    Extra weeks are fetched to support 12-week weighted lookback.
    """
    period_weeks = {
        '4weeks': 20,
        '6months': 65,
        '1year': 65
    }
    weeks = period_weeks.get(time_period, 20)
    
    today = datetime.utcnow()
    current_monday, _ = get_week_boundaries(today)
    
    weekly_stats = []
    
    for i in range(weeks):
        week_start = current_monday - timedelta(weeks=i)
        week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
        
        activities = Activity.query.filter(
            Activity.user_id == user.id,
            Activity.start_date >= week_start,
            Activity.start_date <= week_end
        ).all()
        
        total_distance = sum(a.distance_km for a in activities)
        total_intensity_minutes = sum((a.time_above_80_hr or 0) / 60.0 for a in activities)
        long_run_km = max((a.distance_km for a in activities), default=0)
        run_count = len(activities)
        
        weekly_stats.append({
            'week_start': week_start,
            'week_end': week_end,
            'week_label': week_start.strftime('%b %d'),
            'week_index': -i,
            'distance_km': round(total_distance, 1),
            'intensity_minutes': int(round(total_intensity_minutes)),
            'long_run_km': round(long_run_km, 1),
            'run_count': run_count,
            'is_current': i == 0,
            'is_complete': i > 0
        })
    
    return weekly_stats

def get_daily_stats(user, num_days=210):
    """
    Get daily stats for the specified number of days.
    Returns list of dicts with volume and intensity (minutes) per day.
    Index 0 = today, index 1 = yesterday, etc.
    """
    today = datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=0)
    start_date = (today - timedelta(days=num_days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    
    activities = Activity.query.filter(
        Activity.user_id == user.id,
        Activity.start_date >= start_date,
        Activity.start_date <= today
    ).all()
    
    daily_activities = defaultdict(list)
    for a in activities:
        day_key = a.start_date.date()
        daily_activities[day_key].append(a)
    
    daily_stats = []
    for i in range(num_days):
        day = (today - timedelta(days=i)).date()
        day_acts = daily_activities.get(day, [])
        
        total_distance = sum(a.distance_km for a in day_acts)
        total_intensity_minutes = sum((a.time_above_80_hr or 0) / 60.0 for a in day_acts)
        
        daily_stats.append({
            'date': datetime(day.year, day.month, day.day),
            'date_label': day.strftime('%b %d'),
            'day_index': -i,
            'distance_km': round(total_distance, 1),
            'intensity_minutes': int(round(total_intensity_minutes)),
        })
    
    return daily_stats

def calculate_weighted_average_at_index(weekly_stats, metric, index, weeks=12):
    """Calculate linearly weighted average for a metric at a specific index.
    
    Most recent week gets highest weight (weeks), oldest gets weight 1.
    For 12 weeks: weights are 12, 11, 10, ..., 1. Sum of weights = 78.
    """
    if index + weeks >= len(weekly_stats):
        return None
    
    weighted_sum = 0
    total_weight = 0
    for w in range(weeks):
        weight = weeks - w
        weighted_sum += weekly_stats[index + 1 + w][metric] * weight
        total_weight += weight
    
    return weighted_sum / total_weight if total_weight else 0

def calculate_recommendations(user, time_period='4weeks'):
    """
    Calculate running recommendations based on linearly weighted 12-week averages.
    Recent weeks are weighted higher for a more accurate picture of current fitness.
    Returns dict with recommended limits and chart data.
    """
    weekly_stats = get_weekly_stats(user, time_period=time_period)
    
    # Need at least 13 weeks of data (1 current + 12 historical)
    if len(weekly_stats) < 13:
        return {
            'has_enough_data': False,
            'weeks_needed': 13 - len(weekly_stats),
            'weekly_stats': weekly_stats
        }
    
    # Calculate linearly weighted 12-week averages (excluding current week 0)
    avg_distance = calculate_weighted_average_at_index(weekly_stats, 'distance_km', 0)
    avg_intensity = calculate_weighted_average_at_index(weekly_stats, 'intensity_minutes', 0)
    avg_long_run = calculate_weighted_average_at_index(weekly_stats, 'long_run_km', 0)
    
    # Calculate 25% increase limits for distance and intensity
    max_distance = avg_distance * 1.25 if avg_distance else 0
    max_intensity = avg_intensity * 1.25 if avg_intensity else 0
    # Long run max = 30% of recommended max weekly volume
    long_run_max = max_distance * 0.30
    
    # Current week progress
    current_week = weekly_stats[0]
    current_week_long_run = current_week['long_run_km']
    distance_remaining = max(0, max_distance - current_week['distance_km'])
    intensity_remaining = max(0, max_intensity - current_week['intensity_minutes'])
    long_run_remaining = max(0, long_run_max - current_week_long_run)
    
    # Days remaining in current week
    today = datetime.utcnow()
    _, week_end = get_week_boundaries(today)
    days_left = (week_end.date() - today.date()).days + 1
    
    # Check if we've hit limits
    distance_percent = (current_week['distance_km'] / max_distance * 100) if max_distance else 0
    intensity_percent = (current_week['intensity_minutes'] / max_intensity * 100) if max_intensity else 0
    long_run_percent = (current_week_long_run / long_run_max * 100) if long_run_max else 0
    
    # Build chart data with weighted 12-week actuals vs 12-week recommendations
    chart_data = build_chart_data(weekly_stats)
    
    # Calculate historical recommendations vs actual
    historical_comparison = []
    for i in range(1, min(5, len(weekly_stats))):
        hist_avg_dist = calculate_weighted_average_at_index(weekly_stats, 'distance_km', i)
        hist_avg_int = calculate_weighted_average_at_index(weekly_stats, 'intensity_minutes', i)
        if hist_avg_dist is not None and hist_avg_int is not None:
            hist_max_dist = hist_avg_dist * 1.25
            hist_long_run_max = hist_max_dist * 0.30
            
            historical_comparison.append({
                'week_label': weekly_stats[i]['week_label'],
                'volume': {
                    'recommended_max': round(hist_max_dist, 1),
                    'actual': round(weekly_stats[i]['distance_km'], 1),
                    'difference': round(weekly_stats[i]['distance_km'] - hist_max_dist, 1),
                    'over_limit': weekly_stats[i]['distance_km'] > hist_max_dist
                },
                'intensity': {
                    'recommended_max': int(round(hist_avg_int * 1.25)),
                    'actual': int(round(weekly_stats[i]['intensity_minutes'])),
                    'difference': int(round(weekly_stats[i]['intensity_minutes'] - hist_avg_int * 1.25)),
                    'over_limit': weekly_stats[i]['intensity_minutes'] > hist_avg_int * 1.25
                },
                'long_run': {
                    'recommended_max': round(hist_long_run_max, 1),
                    'actual': round(weekly_stats[i]['long_run_km'], 1),
                    'difference': round(weekly_stats[i]['long_run_km'] - hist_long_run_max, 1),
                    'over_limit': weekly_stats[i]['long_run_km'] > hist_long_run_max
                }
            })
    
    # Get last week's data for review
    last_week = None
    if len(weekly_stats) > 1:
        last_week_data = weekly_stats[1]
        # Calculate last week's weighted 12-week average (weeks 2-13)
        last_week_avg_dist = calculate_weighted_average_at_index(weekly_stats, 'distance_km', 1)
        last_week_avg_int = calculate_weighted_average_at_index(weekly_stats, 'intensity_minutes', 1)
        last_week_avg_long_run = calculate_weighted_average_at_index(weekly_stats, 'long_run_km', 1)
        
        if last_week_avg_dist is not None:
            last_week_max_dist = last_week_avg_dist * 1.25
            last_week_max_int = last_week_avg_int * 1.25
            last_week_long_run_max = last_week_max_dist * 0.30
            
            last_week_dist_pct = (last_week_data['distance_km'] / last_week_max_dist * 100) if last_week_max_dist else 0
            last_week_int_pct = (last_week_data['intensity_minutes'] / last_week_max_int * 100) if last_week_max_int else 0
            last_week_long_run_pct = (last_week_data['long_run_km'] / last_week_long_run_max * 100) if last_week_long_run_max else 0
            
            last_week_dist_increase = ((last_week_data['distance_km'] - last_week_avg_dist) / last_week_avg_dist * 100) if last_week_avg_dist else 0
            last_week_int_increase = ((last_week_data['intensity_minutes'] - last_week_avg_int) / last_week_avg_int * 100) if last_week_avg_int else 0
            last_week_long_run_increase = ((last_week_data['long_run_km'] - last_week_avg_long_run) / last_week_avg_long_run * 100) if last_week_avg_long_run else 0
            
            last_week = {
                'week_label': last_week_data['week_label'],
                'distance_km': round(last_week_data['distance_km'], 1),
                'intensity_minutes': int(round(last_week_data['intensity_minutes'])),
                'long_run_km': round(last_week_data['long_run_km'], 1),
                'run_count': last_week_data['run_count'],
                'max_distance': round(last_week_max_dist, 1),
                'max_intensity': int(round(last_week_max_int)),
                'max_long_run': round(last_week_long_run_max, 1),
                'distance_percent': round(last_week_dist_pct, 0),
                'intensity_percent': round(last_week_int_pct, 0),
                'long_run_percent': round(last_week_long_run_pct, 0),
                'distance_increase': round(last_week_dist_increase, 1),
                'intensity_increase': round(last_week_int_increase, 1),
                'long_run_increase': round(last_week_long_run_increase, 1)
            }
    
    return {
        'has_enough_data': True,
        'weekly_stats': weekly_stats,
        'rolling_average': {
            'distance_km': round(avg_distance, 1),
            'intensity_minutes': int(round(avg_intensity)),
            'long_run_km': round(avg_long_run, 1)
        },
        'max_this_week': {
            'distance_km': round(max_distance, 1),
            'intensity_minutes': int(round(max_intensity)),
            'long_run_km': round(max_distance * 0.30, 1)
        },
        'current_week': {
            'distance_km': current_week['distance_km'],
            'intensity_minutes': current_week['intensity_minutes'],
            'long_run_km': current_week['long_run_km'],
            'run_count': current_week['run_count']
        },
        'remaining': {
            'distance_km': round(distance_remaining, 1),
            'intensity_minutes': int(round(intensity_remaining)),
            'long_run_km': round(long_run_remaining, 1),
            'days_left': days_left
        },
        'progress': {
            'distance_percent': round(distance_percent, 0),
            'intensity_percent': round(intensity_percent, 0),
            'long_run_percent': round(long_run_percent, 0)
        },
        # Calculate percentage increase from rolling average for current week
        'current_week_increase': {
            'distance_increase': round(((current_week['distance_km'] - avg_distance) / avg_distance * 100) if avg_distance and avg_distance > 0 else 0, 1),
            'intensity_increase': round(((current_week['intensity_minutes'] - avg_intensity) / avg_intensity * 100) if avg_intensity and avg_intensity > 0 else 0, 1),
            'long_run_increase': round(((current_week['long_run_km'] - avg_long_run) / avg_long_run * 100) if avg_long_run and avg_long_run > 0 else 0, 1)
        },
        'last_week': last_week,
        'chart_data': chart_data,
        'historical_comparison': historical_comparison
    }

def calculate_next_week_preview(user, current_recommendations):
    """
    Calculate next week's preview assuming current week ends exactly on recommendations.
    Uses linearly weighted 12-week average where the assumed current week gets weight 12.
    """
    if not current_recommendations.get('has_enough_data'):
        app.logger.info('Next week preview: not enough data')
        return None
    
    weekly_stats = current_recommendations.get('weekly_stats', [])
    max_this_week = current_recommendations.get('max_this_week')
    if not max_this_week:
        app.logger.debug('Next week preview: max_this_week not found')
        return None
    
    try:
        if len(weekly_stats) < 12:
            app.logger.info(f'Next week preview: need at least 12 weeks, have {len(weekly_stats)}')
            return None
        
        # Linearly weighted 12-week average for next week:
        # current_at_max (weight 12) + weeks 1-11 from history (weights 11..1)
        total_weight = 78  # sum(1..12)
        
        weighted_dist = max_this_week['distance_km'] * 12
        weighted_int = max_this_week['intensity_minutes'] * 12
        weighted_lr = max_this_week.get('long_run_km', 0) * 12
        
        for w in range(11):
            weight = 11 - w
            if len(weekly_stats) > w + 1:
                weighted_dist += weekly_stats[w + 1].get('distance_km', 0) * weight
                weighted_int += weekly_stats[w + 1].get('intensity_minutes', 0) * weight
                weighted_lr += weekly_stats[w + 1].get('long_run_km', 0) * weight
        
        next_rolling_avg_dist = weighted_dist / total_weight
        next_rolling_avg_int = weighted_int / total_weight
        next_rolling_avg_lr = weighted_lr / total_weight
        
        next_max_dist = next_rolling_avg_dist * 1.25
        next_max_int = next_rolling_avg_int * 1.25
        next_long_run_max = next_max_dist * 0.30
        current_long_run_max = max_this_week.get('long_run_km', 0)
        
        uplift_dist = next_max_dist - max_this_week['distance_km']
        uplift_int = next_max_int - max_this_week['intensity_minutes']
        uplift_long_run = next_long_run_max - current_long_run_max
        
        today = datetime.utcnow()
        current_monday, _ = get_week_boundaries(today)
        next_monday = current_monday + timedelta(days=7)
        next_sunday = next_monday + timedelta(days=6)
        
        return {
            'rolling_average': {
                'distance_km': round(next_rolling_avg_dist, 1),
                'intensity_minutes': int(round(next_rolling_avg_int)),
                'long_run_km': round(next_rolling_avg_lr, 1)
            },
            'max_next_week': {
                'distance_km': round(next_max_dist, 1),
                'intensity_minutes': int(round(next_max_int)),
                'long_run_km': round(next_long_run_max, 1)
            },
            'uplift': {
                'distance_km': round(uplift_dist, 1),
                'intensity_minutes': int(round(uplift_int)),
                'long_run_km': round(uplift_long_run, 1)
            },
            'week_label': f"{next_monday.strftime('%b %d')} - {next_sunday.strftime('%b %d')}"
        }
    except Exception as e:
        app.logger.error(f'Error calculating next week preview: {e}', exc_info=True)
        return None

def calculate_6month_outlook(user, current_recommendations):
    """
    Calculate 6-month (26 weeks) outlook assuming each week ends exactly at recommended limits.
    Uses linearly weighted 12-week averages for projections.
    """
    if not current_recommendations.get('has_enough_data'):
        return None
    
    weekly_stats = current_recommendations.get('weekly_stats', [])
    max_this_week = current_recommendations.get('max_this_week')
    
    if not max_this_week or len(weekly_stats) < 12:
        return None
    
    projections = []
    total_weight = 78  # sum(1..12)
    
    current_week_max = {
        'distance_km': max_this_week['distance_km'],
        'intensity_minutes': max_this_week['intensity_minutes'],
        'long_run_km': max_this_week.get('long_run_km', 0)
    }
    
    # Build the lookback list: current_at_max + historical weeks 1..11
    # This list will be extended as we project forward
    history_dist = [current_week_max['distance_km']]
    history_int = [current_week_max['intensity_minutes']]
    for w in range(1, 12):
        history_dist.append(weekly_stats[w].get('distance_km', 0) if len(weekly_stats) > w else 0)
        history_int.append(weekly_stats[w].get('intensity_minutes', 0) if len(weekly_stats) > w else 0)
    
    today = datetime.utcnow()
    current_monday, _ = get_week_boundaries(today)
    
    for week_num in range(26):
        week_start = current_monday + timedelta(weeks=week_num + 1)
        week_end = week_start + timedelta(days=6)
        
        # Weighted 12-week average: most recent (index 0) = weight 12, oldest = weight 1
        weighted_dist = sum(history_dist[i] * (12 - i) for i in range(12))
        weighted_int = sum(history_int[i] * (12 - i) for i in range(12))
        
        rolling_avg_dist = weighted_dist / total_weight
        rolling_avg_int = weighted_int / total_weight
        
        week_max_dist = rolling_avg_dist * 1.25
        week_max_int = rolling_avg_int * 1.25
        week_long_run_max = week_max_dist * 0.30
        
        projections.append({
            'week_num': week_num + 1,
            'week_label': f"Week {week_num + 1}",
            'date_label': week_start.strftime('%b %d'),
            'rolling_avg': {
                'distance_km': round(rolling_avg_dist, 1),
                'intensity_minutes': int(round(rolling_avg_int))
            },
            'max': {
                'distance_km': round(week_max_dist, 1),
                'intensity_minutes': int(round(week_max_int)),
                'long_run_km': round(week_long_run_max, 1)
            }
        })
        
        # Prepend this week's max as the newest entry for the next projection
        history_dist = [week_max_dist] + history_dist[:11]
        history_int = [week_max_int] + history_int[:11]
    
    return {
        'projections': projections,
        'current_max': current_week_max
    }

def build_chart_data(weekly_stats):
    """
    Build weekly chart data for Performance Over Time and Over/Under charts.
    One data point per completed week.
    
    Area chart = linearly weighted 12-week rolling average (shows load trend).
    White line = actual unweighted weekly volume.
    Recommendation = weighted 12-week average * 1.25.
    Diff = actual weekly volume - recommendation.
    
    Excludes current week (index 0) since it may be incomplete.
    """
    lookback = 12
    total_weight = 78  # sum(1..12)
    
    if len(weekly_stats) < lookback + 2:
        return {'historical': []}
    
    historical = []
    
    # Iterate from oldest displayable week to most recent completed week
    # For week i, we need weeks i+1 through i+12 for the lookback
    max_i = len(weekly_stats) - lookback - 1
    
    for i in range(max_i, 0, -1):
        # Linearly weighted 12-week average (weeks i+1 to i+12)
        weighted_dist = sum(weekly_stats[i + 1 + w]['distance_km'] * (lookback - w) for w in range(lookback))
        weighted_int = sum(weekly_stats[i + 1 + w]['intensity_minutes'] * (lookback - w) for w in range(lookback))
        
        weighted_avg_dist = weighted_dist / total_weight
        weighted_avg_int = weighted_int / total_weight
        
        # Recommendation = weighted average + 25%
        rec_distance = round(weighted_avg_dist * 1.25, 1) if weighted_avg_dist > 0 else None
        rec_intensity = int(round(weighted_avg_int * 1.25)) if weighted_avg_int > 0 else None
        
        # Actual unweighted weekly values
        actual_dist = weekly_stats[i]['distance_km']
        actual_int = weekly_stats[i]['intensity_minutes']
        
        # Diff = actual weekly volume - recommendation
        diff_distance = round(actual_dist - rec_distance, 1) if rec_distance is not None else None
        diff_intensity = int(round(actual_int - rec_intensity)) if rec_intensity is not None else None
        
        historical.append({
            'week_label': weekly_stats[i]['week_label'],
            'week_index': weekly_stats[i]['week_index'],
            'is_current': weekly_stats[i]['is_current'],
            'distance_km': round(weighted_avg_dist, 1),
            'intensity_minutes': int(round(weighted_avg_int)),
            'actual_weekly_distance': round(actual_dist, 1),
            'actual_weekly_intensity': int(round(actual_int)),
            'recommended_distance': rec_distance,
            'recommended_intensity': rec_intensity,
            'diff_distance': diff_distance,
            'diff_intensity': diff_intensity,
        })
    
    return {
        'historical': historical
    }

# ============================================================================
# ROUTES
# ============================================================================

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return render_template('index.html')

@app.route('/dashboard')
@login_required
def dashboard():
    # Always use 26 weeks (6months) for chart data
    recommendations = calculate_recommendations(current_user, time_period='6months')
    next_week_preview = calculate_next_week_preview(current_user, recommendations)
    outlook_6month = calculate_6month_outlook(current_user, recommendations)
    
    return render_template('dashboard.html', 
                         user=current_user, 
                         data=recommendations,
                         next_week=next_week_preview,
                         outlook_6month=outlook_6month)

@app.route('/sync')
@login_required
def sync():
    """Manual sync trigger."""
    sync_activities(current_user, days=365)
    return redirect(url_for('dashboard'))

@app.route('/bulk_sync', methods=['POST'])
@login_required
def bulk_sync():
    """Bulk re-sync activities from a specific date."""
    try:
        start_date_str = request.form.get('start_date')
        if not start_date_str:
            flash('Please select a start date', 'error')
            return redirect(url_for('settings'))
        
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        
        # Re-sync activities
        result = resync_activities(current_user, start_date)
        
        flash(f'Bulk sync completed: {result["updated"]} activities updated, {result["added"]} new activities added', 'success')
    except Exception as e:
        flash(f'Error during bulk sync: {str(e)}', 'error')
        app.logger.error(f'Bulk sync error: {str(e)}', exc_info=True)
    
    return redirect(url_for('settings'))

@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    if request.method == 'POST':
        # Track if we need to recalculate intensity
        needs_recalc = False
        
        # Heart rate settings (always required)
        max_hr = request.form.get('max_heart_rate', type=int)
        if max_hr and 100 <= max_hr <= 250:
            if current_user.max_heart_rate != max_hr:
                needs_recalc = True
            current_user.max_heart_rate = max_hr
        
        hr_percent = request.form.get('hr_intensity_percent', type=float)
        if hr_percent and 60 <= hr_percent <= 95:
            if current_user.hr_intensity_percent != hr_percent:
                needs_recalc = True
            current_user.hr_intensity_percent = hr_percent
        
        # Pace settings via VDOT (race type + race time)
        race_type = request.form.get('race_type', '').strip()
        if race_type in ['5k', '10k', 'half_marathon']:
            # Only mark for recalculation if something changed
            if current_user.race_type != race_type:
                needs_recalc = True
            current_user.race_type = race_type

            # Parse race time from hours:minutes:seconds
            hours = request.form.get('race_time_hours', type=int) or 0
            minutes = request.form.get('race_time_minutes', type=int) or 0
            seconds = request.form.get('race_time_seconds_input', type=int) or 0
            total_seconds = (hours * 3600) + (minutes * 60) + seconds

            if total_seconds > 0:
                if current_user.race_time_seconds != total_seconds:
                    needs_recalc = True
                current_user.race_time_seconds = total_seconds
            else:
                current_user.race_time_seconds = None
        else:
            # If race type is not provided, clear race data
            if current_user.race_type or current_user.race_time_seconds:
                needs_recalc = True
            current_user.race_type = None
            current_user.race_time_seconds = None

        current_user.intensity_method = 'both'
        
        db.session.commit()
        
        # Recalculate intensity if settings changed
        if needs_recalc:
            recalculate_intensity_for_user(current_user)
        
        return redirect(url_for('dashboard'))
    
    today = datetime.utcnow()
    # Default to 1 year ago for bulk sync
    default_sync_date = today - timedelta(days=365)
    return render_template('settings.html', user=current_user, today=today, default_sync_date=default_sync_date)

@app.route('/plan', methods=['GET', 'POST'])
@login_required
def plan():
    """Weekly planning page."""
    today = datetime.utcnow()
    
    # Get week selection (this week or next week)
    week_selection = request.args.get('week', 'this')
    if week_selection == 'next':
        # Next week starts next Monday
        current_monday, _ = get_week_boundaries(today)
        week_monday = current_monday + timedelta(days=7)
        is_next_week = True
    else:
        current_monday, _ = get_week_boundaries(today)
        week_monday = current_monday
        is_next_week = False
    
    # Get recommendations for comparison
    recommendations = calculate_recommendations(current_user, time_period='4weeks')
    
    if request.method == 'POST':
        action = request.form.get('action')
        
        if action == 'add_run':
            day_of_week = request.form.get('day_of_week', type=int)
            run_id = request.form.get('run_id', type=int)
            name = request.form.get('name', 'Run').strip()
            distance_km = request.form.get('distance_km', type=float) or 0
            intensity_minutes = request.form.get('intensity_minutes', type=float) or 0
            
            if day_of_week is not None and 0 <= day_of_week <= 6:
                if run_id:
                    planned_run = PlannedRun.query.filter_by(
                        id=run_id,
                        user_id=current_user.id
                    ).first()
                    if planned_run:
                        planned_run.name = name
                        planned_run.distance_km = distance_km
                        planned_run.intensity_km = intensity_minutes
                        planned_run.updated_at = datetime.utcnow()
                else:
                    existing = PlannedRun.query.filter_by(
                        user_id=current_user.id,
                        week_start_date=week_monday,
                        day_of_week=day_of_week
                    ).first()
                    
                    if existing:
                        existing.name = name
                        existing.distance_km = distance_km
                        existing.intensity_km = intensity_minutes
                        existing.updated_at = datetime.utcnow()
                    else:
                        planned_run = PlannedRun(
                            user_id=current_user.id,
                            week_start_date=week_monday,
                            day_of_week=day_of_week,
                            name=name,
                            distance_km=distance_km,
                            intensity_km=intensity_minutes
                        )
                        db.session.add(planned_run)
                
                db.session.commit()
        
        elif action == 'delete_run':
            run_id = request.form.get('run_id', type=int)
            if run_id:
                planned_run = PlannedRun.query.filter_by(
                    id=run_id,
                    user_id=current_user.id
                ).first()
                if planned_run:
                    db.session.delete(planned_run)
                    db.session.commit()
        
        # Redirect back with week parameter
        week_param = 'next' if is_next_week else 'this'
        return redirect(url_for('plan', week=week_param))
    
    # Get planned runs for selected week
    planned_runs = PlannedRun.query.filter_by(
        user_id=current_user.id,
        week_start_date=week_monday
    ).order_by(PlannedRun.day_of_week.asc()).all()
    
    # Get actual completed runs for the selected week (only for this week, not next week)
    completed_runs = {}
    if not is_next_week:
        week_start = week_monday
        week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
        
        actual_runs = Activity.query.filter(
            Activity.user_id == current_user.id,
            Activity.start_date >= week_start,
            Activity.start_date <= week_end
        ).order_by(Activity.start_date.asc()).all()
        
        for run in actual_runs:
            day_of_week = run.start_date.weekday()
            intensity_minutes = (run.time_above_80_hr or 0) / 60.0
            
            if day_of_week not in completed_runs:
                completed_runs[day_of_week] = {
                    'name': f"{run.name} (and {len([r for r in actual_runs if r.start_date.weekday() == day_of_week]) - 1} more)" if len([r for r in actual_runs if r.start_date.weekday() == day_of_week]) > 1 else run.name,
                    'distance_km': run.distance_km,
                    'intensity_minutes': intensity_minutes,
                    'is_completed': True,
                    'date': run.start_date,
                    'run_count': 1
                }
            else:
                completed_runs[day_of_week]['distance_km'] += run.distance_km
                completed_runs[day_of_week]['intensity_minutes'] += intensity_minutes
                completed_runs[day_of_week]['run_count'] += 1
                if completed_runs[day_of_week]['run_count'] > 1:
                    completed_runs[day_of_week]['name'] = f"{completed_runs[day_of_week]['run_count']} runs"
    
    # Organize runs by day (completed runs override planned runs)
    runs_by_day = {i: None for i in range(7)}
    for run in planned_runs:
        if run.day_of_week not in completed_runs:
            runs_by_day[run.day_of_week] = {
                'name': run.name,
                'distance_km': run.distance_km,
                'intensity_minutes': run.intensity_km,
                'is_completed': False,
                'planned_run_id': run.id
            }
    
    for day, run_data in completed_runs.items():
        runs_by_day[day] = run_data
    
    total_distance = 0
    total_intensity = 0
    longest_run = 0
    for day_data in runs_by_day.values():
        if day_data:
            total_distance += day_data['distance_km']
            total_intensity += day_data.get('intensity_minutes', 0)
            if day_data['distance_km'] > longest_run:
                longest_run = day_data['distance_km']
    
    comparison = {}
    if recommendations.get('has_enough_data'):
        if is_next_week:
            next_week_preview = calculate_next_week_preview(current_user, recommendations)
            if next_week_preview:
                max_distance = next_week_preview['max_next_week']['distance_km']
                max_intensity = next_week_preview['max_next_week']['intensity_minutes']
                max_long_run = next_week_preview['max_next_week']['long_run_km']
                rolling_avg_dist = next_week_preview['rolling_average']['distance_km']
                rolling_avg_int = next_week_preview['rolling_average']['intensity_minutes']
                rolling_avg_lr = next_week_preview['rolling_average']['long_run_km']
            else:
                max_distance = recommendations['max_this_week']['distance_km']
                max_intensity = recommendations['max_this_week']['intensity_minutes']
                max_long_run = recommendations['max_this_week']['long_run_km']
                rolling_avg_dist = recommendations['rolling_average']['distance_km']
                rolling_avg_int = recommendations['rolling_average']['intensity_minutes']
                rolling_avg_lr = recommendations['rolling_average']['long_run_km']
        else:
            max_distance = recommendations['max_this_week']['distance_km']
            max_intensity = recommendations['max_this_week']['intensity_minutes']
            max_long_run = recommendations['max_this_week']['long_run_km']
            rolling_avg_dist = recommendations['rolling_average']['distance_km']
            rolling_avg_int = recommendations['rolling_average']['intensity_minutes']
            rolling_avg_lr = recommendations['rolling_average']['long_run_km']
        
        comparison = {
            'distance': {
                'planned': round(total_distance, 1),
                'max': max_distance,
                'percent': round((total_distance / max_distance * 100) if max_distance > 0 else 0, 0),
                'over': total_distance > max_distance,
                'increase': round(((total_distance - rolling_avg_dist) / rolling_avg_dist * 100) if rolling_avg_dist > 0 else 0, 1)
            },
            'intensity': {
                'planned': int(round(total_intensity)),
                'max': max_intensity,
                'percent': round((total_intensity / max_intensity * 100) if max_intensity > 0 else 0, 0),
                'over': total_intensity > max_intensity,
                'increase': round(((total_intensity - rolling_avg_int) / rolling_avg_int * 100) if rolling_avg_int > 0 else 0, 1)
            },
            'long_run': {
                'planned': round(longest_run, 1),
                'max': max_long_run,
                'percent': round((longest_run / max_long_run * 100) if max_long_run > 0 else 0, 0),
                'over': longest_run > max_long_run,
                'increase': round(((longest_run - rolling_avg_lr) / rolling_avg_lr * 100) if rolling_avg_lr > 0 else 0, 1)
            }
        }
    
    # Get day labels for the week
    days = []
    day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    today_date_only = today.date()
    for i in range(7):
        day_date = week_monday + timedelta(days=i)
        day_date_only_val = day_date.date()
        days.append({
            'index': i,
            'name': day_names[i],
            'date': day_date,
            'date_label': day_date.strftime('%b %d'),
            'date_only': day_date_only_val,
            'can_edit': is_next_week or day_date_only_val >= today_date_only,
            'run': runs_by_day[i]
        })
    
    return render_template('plan.html',
                         user=current_user,
                         days=days,
                         week_monday=week_monday,
                         is_next_week=is_next_week,
                         planned_runs=planned_runs,
                         comparison=comparison,
                         recommendations=recommendations)

@app.route('/runs')
@login_required
def runs_feed():
    """Runs feed page showing all activities."""
    page = request.args.get('page', 1, type=int)
    per_page = 20
    
    activities = Activity.query.filter_by(user_id=current_user.id)\
        .order_by(Activity.start_date.desc())\
        .paginate(page=page, per_page=per_page, error_out=False)
    
    today = datetime.utcnow()
    seven_days_ago = today - timedelta(days=7)
    
    recent_runs = Activity.query.filter(
        Activity.user_id == current_user.id,
        Activity.start_date >= seven_days_ago,
        Activity.start_date < today
    ).all()
    
    if len(recent_runs) > 0:
        avg_distance = sum(r.distance_km for r in recent_runs) / len(recent_runs)
        avg_intensity = sum((r.time_above_80_hr or 0) / 60.0 for r in recent_runs) / len(recent_runs)
    else:
        avg_distance = 0
        avg_intensity = 0
    
    enriched_activities = []
    for activity in activities.items:
        intensity_minutes = (activity.time_above_80_hr or 0) / 60.0
        
        distance_diff = activity.distance_km - avg_distance if avg_distance > 0 else 0
        intensity_diff = intensity_minutes - avg_intensity if avg_intensity > 0 else 0
        
        enriched_activities.append({
            'activity': activity,
            'intensity_minutes': int(round(intensity_minutes)),
            'distance_km': round(activity.distance_km, 1),
            'distance_diff': round(distance_diff, 1),
            'intensity_diff': int(round(intensity_diff)),
            'averages': {
                'distance_km': round(avg_distance, 1),
                'intensity_minutes': int(round(avg_intensity))
            }
        })
    
    return render_template('runs_feed.html',
                         user=current_user,
                         activities=enriched_activities,
                         pagination=activities)


@app.route('/api/recommendations')
@login_required
def api_recommendations():
    """API endpoint for recommendations data."""
    recommendations = calculate_recommendations(current_user)
    return jsonify(recommendations)

@app.route('/api/chart-data')
@login_required
def api_chart_data():
    """API endpoint for chart data."""
    recommendations = calculate_recommendations(current_user)
    if recommendations.get('has_enough_data'):
        return jsonify(recommendations.get('chart_data', {}))
    return jsonify({'error': 'Not enough data'}), 400

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@app.errorhandler(404)
def not_found_error(error):
    app.logger.warning(f'404 error: {request.url}')
    return render_template('errors/404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    app.logger.error(f'500 error: {str(error)}', exc_info=True)
    return render_template('errors/500.html'), 500

# ============================================================================
# APP INITIALIZATION
# ============================================================================

with app.app_context():
    db.create_all()
    app.logger.info('Flow app startup')

if __name__ == '__main__':
    # Try to use gunicorn if available, otherwise use Flask dev server
    try:
        import gunicorn
        # If gunicorn is installed, recommend using it via command line
        print("Note: For better performance, run: gunicorn --bind 0.0.0.0:5001 app:app")
    except ImportError:
        pass
    app.run(host='0.0.0.0', port=5001, debug=False)
