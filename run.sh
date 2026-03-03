#!/bin/bash
source venv/bin/activate
gunicorn --bind 0.0.0.0:5001 --workers 2 --timeout 120 app:app
