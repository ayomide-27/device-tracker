-- Sites to visit, weekly assignments, and the check-ins FOs make at them.

-- Distance in metres between two coordinates. Used for "was the FO at the site?" and
-- "is there tracking near this check-in?" so that there is one definition of distance.
CREATE FUNCTION haversine_m(lat1 double precision, lng1 double precision,
                            lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(least(1,
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

CREATE TABLE sites (
  site_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m   integer NOT NULL DEFAULT 100 CHECK (radius_m BETWEEN 20 AND 2000),
  archived   boolean NOT NULL DEFAULT false,       -- sites are archived, never deleted, so old visits keep their meaning
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which FO should visit which site in which week (week_start is the Monday).
CREATE TABLE plan_items (
  device_id  text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  site_id    uuid NOT NULL REFERENCES sites(site_id),
  week_start date NOT NULL,
  PRIMARY KEY (device_id, site_id, week_start)
);

-- A check-in. visit_id is created on the phone, so a retried upload cannot create a duplicate.
CREATE TABLE visits (
  visit_id    uuid PRIMARY KEY,
  device_id   text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  site_id     uuid REFERENCES sites(site_id),      -- NULL = "somewhere not on my list"
  place_name  text,                                -- what the FO typed for an unplanned visit
  recorded_at timestamptz NOT NULL,                -- the phone's clock when GPS took the reading
  received_at timestamptz NOT NULL DEFAULT now(),  -- the server's clock when it arrived
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    real CHECK (accuracy >= 0),          -- metres
  distance_m  double precision,                    -- from the site at check-in time; NULL for unplanned
  CHECK ((site_id IS NOT NULL) <> (place_name IS NOT NULL))
);

CREATE INDEX visits_device_time_idx ON visits (device_id, recorded_at);
CREATE INDEX visits_site_idx ON visits (site_id);

CREATE TABLE visit_photos (
  visit_id uuid PRIMARY KEY REFERENCES visits(visit_id) ON DELETE CASCADE,
  mime     text NOT NULL,
  bytes    bytea NOT NULL
);
