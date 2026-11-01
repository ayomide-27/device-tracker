-- Devices and their GPS history.
-- IF NOT EXISTS: a database created by an earlier version of this project is adopted as it is.

CREATE TABLE IF NOT EXISTS devices (
  device_id   text PRIMARY KEY,
  label       text NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),  -- last time the phone contacted the server
  last_lat    double precision,                    -- latest known position
  last_lng    double precision,
  last_fix_at timestamptz                          -- when the phone's GPS took that reading
);

CREATE TABLE IF NOT EXISTS locations (
  device_id   text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,                -- when the phone's GPS took the reading
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    real,                                -- metres
  PRIMARY KEY (device_id, recorded_at)             -- also makes re-uploads harmless
);

CREATE INDEX IF NOT EXISTS locations_recorded_at_idx ON locations (recorded_at);
