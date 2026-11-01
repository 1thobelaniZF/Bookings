-- Room Booking — Supabase / Postgres schema.
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query),
-- or via psql against your project. It is safe to re-run: it only creates objects
-- if they don't already exist, and seeds rooms only when the table is empty.

-- Needed for the no-overlap exclusion constraint below (range + equality in one
-- GiST index). Supabase supports this extension.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS rooms (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      TEXT    NOT NULL,
  capacity  INTEGER NOT NULL DEFAULT 0,
  amenities TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id         BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  booked_by_name  TEXT        NOT NULL,
  booked_by_email TEXT        NOT NULL,
  attendees       TEXT        NOT NULL DEFAULT '',
  series_id       TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive columns for existing databases (safe no-ops if already present).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attendees TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS series_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_room_time
  ON bookings (room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_email
  ON bookings (booked_by_email);

-- Hard guarantee against double-booking: no two bookings for the same room may
-- have overlapping [start_time, end_time) ranges. This holds even under
-- simultaneous requests, which app-level checks alone cannot guarantee.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        room_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      );
  END IF;
END $$;

-- Seed the rooms once.
INSERT INTO rooms (name, capacity, amenities)
SELECT * FROM (VALUES
  ('Infinity',    22, 'Projector, Video Conferencing, Whiteboard'),
  ('Innovation',  10, 'TV Screen, Whiteboard'),
  ('Inspiration',  6, 'TV Screen, Whiteboard'),
  ('Power',        2, 'Private office, Desk, Monitor'),
  ('Square Root',  2, 'Private office, Desk, Monitor'),
  ('Congruent',    2, 'Private office, Desk, Monitor')
) AS seed(name, capacity, amenities)
WHERE NOT EXISTS (SELECT 1 FROM rooms);
