"""
Database migration script to add new fields to User and Activity models.
Run this once to update your existing database.
"""

import sqlite3
import os

DB_PATH = 'instance/runsafe.db'

def migrate():
    """Add new columns to User and Activity tables if they don't exist."""
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        print("The database will be created automatically when you run the app.")
        return
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    changes_made = False
    
    # Check Activity table columns
    cursor.execute("PRAGMA table_info(activity)")
    activity_columns = [row[1] for row in cursor.fetchall()]
    
    if 'polyline' not in activity_columns:
        print("Adding 'polyline' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN polyline TEXT")
        changes_made = True
    
    if 'start_latitude' not in activity_columns:
        print("Adding 'start_latitude' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN start_latitude REAL")
        changes_made = True
    
    if 'start_longitude' not in activity_columns:
        print("Adding 'start_longitude' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN start_longitude REAL")
        changes_made = True
    
    if 'average_power' not in activity_columns:
        print("Adding 'average_power' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN average_power REAL")
        changes_made = True
    
    # Check User table columns
    cursor.execute("PRAGMA table_info(user)")
    user_columns = [row[1] for row in cursor.fetchall()]
    
    if 'intensity_method' not in user_columns:
        print("Adding 'intensity_method' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN intensity_method VARCHAR(10) DEFAULT 'hr'")
        changes_made = True
    
    if 'hr_intensity_percent' not in user_columns:
        print("Adding 'hr_intensity_percent' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN hr_intensity_percent REAL DEFAULT 80.0")
        changes_made = True
    
    if 'race_type' not in user_columns:
        print("Adding 'race_type' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN race_type VARCHAR(20)")
        changes_made = True
    
    if 'race_time_seconds' not in user_columns:
        print("Adding 'race_time_seconds' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN race_time_seconds INTEGER")
        changes_made = True
    
    if 'body_weight_kg' not in user_columns:
        print("Adding 'body_weight_kg' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN body_weight_kg REAL")
        changes_made = True
    
    if 'easy_pace_override_seconds_per_km' not in user_columns:
        print("Adding 'easy_pace_override_seconds_per_km' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN easy_pace_override_seconds_per_km REAL")
        changes_made = True
    
    if 'power_threshold_override_watts' not in user_columns:
        print("Adding 'power_threshold_override_watts' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN power_threshold_override_watts REAL")
        changes_made = True
    
    # Add new simplified threshold columns
    if 'pace_threshold_seconds_per_km' not in user_columns:
        print("Adding 'pace_threshold_seconds_per_km' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN pace_threshold_seconds_per_km REAL")
        changes_made = True
    
    if 'power_threshold_watts' not in user_columns:
        print("Adding 'power_threshold_watts' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN power_threshold_watts REAL")
        changes_made = True
    
    # Check Activity table for intensity_km
    if 'intensity_km' not in activity_columns:
        print("Adding 'intensity_km' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN intensity_km REAL DEFAULT 0.0")
        changes_made = True
    
    # Check Activity table for tss (deprecated, kept for schema compatibility)
    if 'tss' not in activity_columns:
        print("Adding 'tss' column to activity table...")
        cursor.execute("ALTER TABLE activity ADD COLUMN tss REAL DEFAULT 0.0")
        changes_made = True
    
    # Check User table for TSS-related fields
    if 'pace_threshold_min_per_km' not in user_columns:
        print("Adding 'pace_threshold_min_per_km' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN pace_threshold_min_per_km REAL")
        changes_made = True
    
    if 'body_mass_kg' not in user_columns:
        print("Adding 'body_mass_kg' column to user table...")
        cursor.execute("ALTER TABLE user ADD COLUMN body_mass_kg REAL")
        changes_made = True
    
    # Check if planned_run table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='planned_run'")
    planned_run_exists = cursor.fetchone() is not None
    
    if not planned_run_exists:
        print("Creating 'planned_run' table...")
        cursor.execute("""
            CREATE TABLE planned_run (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                week_start_date DATETIME NOT NULL,
                day_of_week INTEGER NOT NULL,
                name VARCHAR(200) DEFAULT 'Run',
                distance_km REAL DEFAULT 0,
                intensity_km REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES user (id)
            )
        """)
        changes_made = True
    
    if changes_made:
        conn.commit()
        print("\nMigration completed successfully!")
        if not planned_run_exists:
            print("Weekly planning feature is now available.")
        else:
            print("New intensity customization features are now available in Settings.")
    else:
        print("Database is already up to date.")
    
    conn.close()

if __name__ == '__main__':
    migrate()
