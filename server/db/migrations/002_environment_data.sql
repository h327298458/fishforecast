CREATE TABLE IF NOT EXISTS tide_imports (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_year INTEGER NOT NULL,
  state TEXT NOT NULL,
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  source_url TEXT NOT NULL,
  downloaded_at_utc TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  attribution TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS tide_stations (
  station_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  station_name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  state TEXT NOT NULL,
  timezone TEXT NOT NULL,
  datum TEXT,
  source_year INTEGER NOT NULL,
  import_id TEXT NOT NULL REFERENCES tide_imports(id),
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tide_events (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES tide_stations(station_id),
  provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('HIGH','LOW')),
  event_time_utc TEXT NOT NULL,
  event_time_local TEXT NOT NULL,
  height_m REAL NOT NULL,
  source_year INTEGER NOT NULL,
  datum TEXT,
  fetched_at_utc TEXT NOT NULL,
  imported_at_utc TEXT NOT NULL,
  parser_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tide_events_station_time ON tide_events(station_id,event_time_utc);

CREATE TABLE IF NOT EXISTS spot_environment_preferences (
  spot_id TEXT PRIMARY KEY REFERENCES spots(id) ON DELETE CASCADE,
  preferred_tide_source TEXT NOT NULL DEFAULT 'OFFICIAL',
  official_station_id TEXT REFERENCES tide_stations(station_id),
  official_station_time_offset_min INTEGER NOT NULL DEFAULT 0,
  official_station_height_offset_m REAL NOT NULL DEFAULT 0,
  station_locked INTEGER NOT NULL DEFAULT 0,
  model_enabled INTEGER NOT NULL DEFAULT 1,
  shoreline_direction_deg REAL,
  casting_direction_deg REAL,
  exposure_direction_deg REAL,
  sheltered_wind_directions TEXT,
  exposed_wind_directions TEXT,
  has_building_shelter INTEGER NOT NULL DEFAULT 0,
  has_cliff_shelter INTEGER NOT NULL DEFAULT 0,
  open_coast INTEGER NOT NULL DEFAULT 0,
  rock_access_required INTEGER NOT NULL DEFAULT 0,
  slippery_access INTEGER NOT NULL DEFAULT 0,
  night_fishing_allowed INTEGER,
  lighting_available INTEGER NOT NULL DEFAULT 0,
  maximum_wind_kmh REAL,
  maximum_gust_kmh REAL,
  maximum_wave_height_m REAL,
  preferred_tide_mode TEXT,
  notes TEXT,
  last_user_selection_utc TEXT
);

CREATE TABLE IF NOT EXISTS bom_warnings (
  warning_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  product_code TEXT,
  warning_type TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  issued_at_utc TEXT NOT NULL,
  valid_from_utc TEXT,
  valid_until_utc TEXT,
  state TEXT NOT NULL,
  forecast_district TEXT,
  marine_zone TEXT,
  affected_area_text TEXT,
  source_url TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  fetched_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bom_observations (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  observed_at_utc TEXT NOT NULL,
  temperature_c REAL,
  wind_speed_kmh REAL,
  gust_kmh REAL,
  wind_direction_deg REAL,
  pressure_hpa REAL,
  rain_since_9am_mm REAL,
  raw_payload TEXT NOT NULL,
  fetched_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bom_obs_station_time ON bom_observations(station_id,observed_at_utc);

CREATE TABLE IF NOT EXISTS provider_runs (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_attempt_utc TEXT,
  last_success_utc TEXT,
  cache_generated_at_utc TEXT,
  using_stale_cache INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
