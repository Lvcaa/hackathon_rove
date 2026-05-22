import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

import pandas as pd

from app.geo import parse_point_wkt, polygon_centroid_wgs84

DB_PATH = os.getenv("DB_PATH", "data/commutesync.db")
DATASET_DIR = os.getenv("DATASET_DIR", "dataset")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parking_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    geometry_wkt TEXT,
    centroid_lat REAL,
    centroid_lng REAL,
    max_capacity INTEGER DEFAULT 0,
    available_spots INTEGER DEFAULT 0,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sharing_points (
    id TEXT PRIMARY KEY,
    address TEXT,
    type TEXT DEFAULT 'car',
    lat REAL,
    lng REAL,
    available INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS destinations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'station',
    lat REAL,
    lng REAL
);
CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    destination_id TEXT,
    destination_name TEXT,
    parking_id TEXT,
    sharing_id TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS trip_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id TEXT,
    step_order INTEGER,
    action TEXT,
    detail TEXT,
    estimated_time TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);
"""


def init_db() -> None:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    with get_db() as conn:
        conn.executescript(_SCHEMA)
        # Idempotent migration: add user_id column to trips if it doesn't exist yet.
        cur = conn.execute("PRAGMA table_info(trips)")
        cols = {r[1] for r in cur.fetchall()}
        if "user_id" not in cols:
            conn.execute("ALTER TABLE trips ADD COLUMN user_id INTEGER")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id)"
            )
        _seed_data(conn)


def _seed_data(conn: sqlite3.Connection) -> None:
    now = datetime.now(timezone.utc).isoformat()

    try:
        df = pd.read_csv(f"{DATASET_DIR}/stazioni.csv", sep=";")
        for i, row in df.iterrows():
            try:
                lat, lng = parse_point_wkt(str(row["wkb_geometry"]))
                conn.execute(
                    "INSERT OR IGNORE INTO destinations (id, name, type, lat, lng) VALUES (?,?,?,?,?)",
                    (f"D{i+1:03d}", str(row["nome"]), "station", lat, lng),
                )
            except Exception:
                continue
    except Exception as e:
        print(f"[seed] stazioni.csv skipped: {e}")

    try:
        df = pd.read_csv(f"{DATASET_DIR}/taxi.csv", sep=";")
        for i, row in df.iterrows():
            try:
                lat = float(row["x"])
                lng = float(row["y"])
                conn.execute(
                    "INSERT OR IGNORE INTO destinations (id, name, type, lat, lng) VALUES (?,?,?,?,?)",
                    (f"T{i+1:03d}", str(row["nome"]), "taxi", lat, lng),
                )
            except Exception:
                continue
    except Exception as e:
        print(f"[seed] taxi.csv skipped: {e}")

    try:
        df = pd.read_csv(f"{DATASET_DIR}/zone_parcheggio.csv", sep=";")
        for i, row in df.iterrows():
            try:
                lat, lng = polygon_centroid_wgs84(str(row["wkb_geometry"]))
                conn.execute(
                    "INSERT OR IGNORE INTO parking_zones "
                    "(id, name, geometry_wkt, centroid_lat, centroid_lng, max_capacity, available_spots, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (f"P{i+1:03d}", str(row["descrizione"]), str(row["wkb_geometry"]), lat, lng, 0, 0, now),
                )
            except Exception:
                continue
    except Exception as e:
        print(f"[seed] zone_parcheggio.csv skipped: {e}")

    try:
        df = pd.read_csv(f"{DATASET_DIR}/car_sharing.csv", sep=";")
        for i, row in df.iterrows():
            try:
                lat, lng = parse_point_wkt(str(row["wkb_geometry"]))
                conn.execute(
                    "INSERT OR IGNORE INTO sharing_points (id, address, type, lat, lng, available) VALUES (?,?,?,?,?,?)",
                    (f"S{i+1:03d}", str(row["via"]), "car", lat, lng, 1),
                )
            except Exception:
                continue
    except Exception as e:
        print(f"[seed] car_sharing.csv skipped: {e}")
