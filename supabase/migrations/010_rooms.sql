-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 010 — Rooms module (hotel): room types, rooms, bookings
-- ════════════════════════════════════════════════════════════════════════════
-- The hotel side is BOOKINGS, not point-of-sale, so it lives in its own tables.
-- A room manager (a user with the can_manage_rooms permission) sets up room
-- types + rooms, then books guests in and out. Room types & pricing are entered
-- in the app — nothing is hardcoded.
--
-- Model:
--   room_types  — a category (e.g. "Deluxe Double") with a nightly price.
--   rooms       — a physical room (a number/label) OF a type; carries live status.
--   bookings    — a guest's stay in a room (check-in → check-out), with amount.
--
-- Occupancy is derived: a room is "occupied" while it has a booking in
-- 'checked_in' status. We also keep rooms.status as a fast flag the trigger
-- maintains, so the grid can colour rooms without scanning bookings.
--
-- Safe to run anytime. Paste into Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Room types ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  price_per_night NUMERIC(12,2) NOT NULL CHECK (price_per_night >= 0),
  capacity        INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_types_branch ON public.room_types (org_id, branch_id);

-- 2. Rooms --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  room_type_id  UUID REFERENCES public.room_types(id) ON DELETE SET NULL,
  room_no       TEXT NOT NULL,                 -- label the guest sees, e.g. "12" / "A3"
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','occupied','maintenance')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, room_no)
);
CREATE INDEX IF NOT EXISTS idx_rooms_branch ON public.rooms (org_id, branch_id);

-- 3. Bookings -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  room_id      UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  guest_name   TEXT NOT NULL,
  guest_phone  TEXT,
  guest_id_no  TEXT,                            -- national ID / passport (optional)
  check_in     DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Africa/Nairobi')::date,
  check_out    DATE,                            -- null until they leave / planned out
  nights       INTEGER,                         -- filled at check-out (or planned)
  rate         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),   -- price/night at booking
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0), -- total charged
  payment      TEXT CHECK (payment IN ('cash','mpesa','card','credit','split')),
  paid         BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL DEFAULT 'checked_in'
               CHECK (status IN ('booked','checked_in','checked_out','cancelled')),
  note         TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_branch ON public.bookings (org_id, branch_id, check_in);
CREATE INDEX IF NOT EXISTS idx_bookings_room   ON public.bookings (room_id);

-- 4. Keep rooms.status in step with bookings ---------------------------------
-- A room is occupied while it has a 'checked_in' booking; freed on check-out or
-- cancel. We don't touch rooms flagged 'maintenance' here.
CREATE OR REPLACE FUNCTION public.sync_room_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_room UUID; v_open INTEGER;
BEGIN
  v_room := COALESCE(NEW.room_id, OLD.room_id);
  IF v_room IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COUNT(*) INTO v_open FROM public.bookings
    WHERE room_id = v_room AND status = 'checked_in';
  UPDATE public.rooms
     SET status = CASE WHEN v_open > 0 THEN 'occupied' ELSE 'available' END
   WHERE id = v_room AND status <> 'maintenance';
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS bookings_room_status ON public.bookings;
CREATE TRIGGER bookings_room_status
  AFTER INSERT OR UPDATE OF status, room_id OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_room_status();

-- 5. Grants + RLS + realtime --------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings   TO anon;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_types','rooms','bookings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t || '_anon_all', t);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_types','rooms','bookings'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.room_types REPLICA IDENTITY FULL;
ALTER TABLE public.rooms      REPLICA IDENTITY FULL;
ALTER TABLE public.bookings   REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
