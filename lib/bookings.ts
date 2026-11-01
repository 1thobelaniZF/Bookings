import { randomUUID } from 'node:crypto';
import { getSql } from './db';
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail, isValidEmail } from './email';
import { notifyBookingSafe, type NotifyOptions } from './notify';
import type { Booking, BookingWithRoom, NewBookingInput, Recurrence, Room } from './types';

export interface ValidationError {
  error: string;
}

export function isValidationError(v: unknown): v is ValidationError {
  return typeof v === 'object' && v !== null && 'error' in v;
}

// Postgres raises this SQLSTATE when the no-overlap exclusion constraint is hit.
const EXCLUSION_VIOLATION = '23P01';
const MAX_OCCURRENCES = 26;

const OVERLAP_MESSAGE =
  'That time overlaps an existing booking in this room. Please pick another slot.';

// ---- Helpers ----------------------------------------------------------------
function cleanAttendees(list: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const a = raw.trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---- Row mappers: snake_case DB columns -> camelCase app types --------------
function toBooking(r: Record<string, unknown>): Booking {
  return {
    id: Number(r.id),
    roomId: Number(r.room_id),
    title: r.title as string,
    bookedByName: r.booked_by_name as string,
    bookedByEmail: r.booked_by_email as string,
    attendees: ((r.attendees as string) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    seriesId: (r.series_id as string) ?? null,
    startTime: new Date(r.start_time as string).toISOString(),
    endTime: new Date(r.end_time as string).toISOString(),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

function toBookingWithRoom(r: Record<string, unknown>): BookingWithRoom {
  return { ...toBooking(r), roomName: r.room_name as string };
}

// ---- Rooms ------------------------------------------------------------------
export async function getRooms(): Promise<Room[]> {
  const sql = getSql();
  const rows = await sql`SELECT id, name, capacity, amenities FROM rooms ORDER BY name`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    capacity: Number(r.capacity),
    amenities: r.amenities as string,
  }));
}

// ---- Bookings ---------------------------------------------------------------
/**
 * Return bookings, optionally filtered by room and/or a time window and/or the
 * email of the person who made them. The window filter uses overlap with
 * [from, to) so a booking spanning the edge is still included.
 */
export async function getBookings(
  opts: { roomId?: number; from?: string; to?: string; email?: string } = {}
): Promise<BookingWithRoom[]> {
  const sql = getSql();

  const conditions = [];
  if (opts.roomId != null) conditions.push(sql`b.room_id = ${opts.roomId}`);
  if (opts.email) conditions.push(sql`LOWER(b.booked_by_email) = LOWER(${opts.email})`);
  if (opts.from && opts.to) {
    conditions.push(sql`b.start_time < ${opts.to}::timestamptz AND b.end_time > ${opts.from}::timestamptz`);
  } else if (opts.from) {
    conditions.push(sql`b.end_time > ${opts.from}::timestamptz`);
  } else if (opts.to) {
    conditions.push(sql`b.start_time < ${opts.to}::timestamptz`);
  }

  const where =
    conditions.length > 0 ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`) : null;

  const rows = await sql`
    SELECT b.*, r.name AS room_name
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY b.start_time ASC
  `;
  return rows.map(toBookingWithRoom);
}

/**
 * Validate a booking's shape, times, attendees, and room capacity.
 * Returns a ValidationError or null. `now` is injectable for testing.
 */
export async function validateBooking(
  input: Partial<NewBookingInput>,
  now = new Date()
): Promise<ValidationError | null> {
  const { roomId, title, bookedByName, bookedByEmail, startTime, endTime } = input;

  if (roomId == null || !Number.isInteger(roomId)) return { error: 'A room must be selected.' };
  if (!title || !title.trim()) return { error: 'A meeting title is required.' };
  if (!bookedByName || !bookedByName.trim()) return { error: 'Your name is required.' };
  if (!bookedByEmail || !isAllowedEmail(bookedByEmail)) {
    return { error: `A valid @${ALLOWED_EMAIL_DOMAIN} email address is required.` };
  }
  if (!startTime || !endTime) return { error: 'Start and end times are required.' };

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Start and end times are invalid.' };
  }
  if (end <= start) return { error: 'End time must be after the start time.' };
  if (start < now) return { error: 'You cannot book a time in the past.' };

  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (durationHours > 12) return { error: 'A single booking cannot exceed 12 hours.' };

  // Attendees may be staff or external — any valid email address is accepted.
  const attendees = cleanAttendees(input.attendees);
  for (const a of attendees) {
    if (!isValidEmail(a)) {
      return { error: `Attendee "${a}" is not a valid email address.` };
    }
  }

  const sql = getSql();
  const rooms = await sql`SELECT id, name, capacity FROM rooms WHERE id = ${roomId}`;
  if (rooms.length === 0) return { error: 'The selected room does not exist.' };

  // Capacity: organiser + attendees must fit the room.
  const room = rooms[0];
  const headcount = new Set([
    bookedByEmail.trim().toLowerCase(),
    ...attendees.map((a) => a.toLowerCase()),
  ]).size;
  if (headcount > Number(room.capacity)) {
    return {
      error: `${room.name} seats ${room.capacity}, but this meeting has ${headcount} people (you + ${attendees.length} attendee${attendees.length === 1 ? '' : 's'}). Pick a larger room or remove attendees.`,
    };
  }

  return null;
}

/**
 * Find a conflicting booking for the same room in the given time window.
 * `excludeId` skips a booking being edited so it doesn't clash with itself.
 */
export async function findConflict(
  roomId: number,
  startTime: string,
  endTime: string,
  excludeId?: number
): Promise<Booking | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM bookings
    WHERE room_id = ${roomId}
      AND start_time < ${endTime}::timestamptz
      AND end_time > ${startTime}::timestamptz
      ${excludeId != null ? sql`AND id <> ${excludeId}` : sql``}
    LIMIT 1
  `;
  return rows.length ? toBooking(rows[0]) : null;
}

function isExclusionViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: string }).code === EXCLUSION_VIOLATION
  );
}

/** Expand a booking + recurrence into individual {startTime,endTime} occurrences. */
function expandOccurrences(
  input: NewBookingInput,
  recurrence?: Recurrence
): { startTime: string; endTime: string }[] {
  const freq = recurrence?.frequency ?? 'none';
  const count = freq === 'none' ? 1 : Math.min(Math.max(1, recurrence?.count ?? 1), MAX_OCCURRENCES);
  if (freq === 'none' || count <= 1) {
    return [{ startTime: input.startTime, endTime: input.endTime }];
  }
  const stepDays = freq === 'daily' ? 1 : 7;
  const stepMs = stepDays * 86_400_000;
  const start0 = new Date(input.startTime).getTime();
  const end0 = new Date(input.endTime).getTime();
  const out: { startTime: string; endTime: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      startTime: new Date(start0 + i * stepMs).toISOString(),
      endTime: new Date(end0 + i * stepMs).toISOString(),
    });
  }
  return out;
}

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.BOOKING_TIMEZONE || 'Africa/Johannesburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/**
 * Create one booking, or a recurring series. Returns the created bookings, or a
 * ValidationError. Every occurrence is conflict-checked before anything is
 * written; the whole series is inserted atomically.
 */
export async function createBookings(
  input: NewBookingInput,
  recurrence?: Recurrence
): Promise<Booking[] | ValidationError> {
  const validationError = await validateBooking(input);
  if (validationError) return validationError;

  const occurrences = expandOccurrences(input, recurrence);

  // Friendly pre-check for every occurrence (can name the clashing meeting/day).
  for (const occ of occurrences) {
    const conflict = await findConflict(input.roomId, occ.startTime, occ.endTime);
    if (conflict) {
      const when = occurrences.length > 1 ? ` on ${fmtDay(occ.startTime)}` : '';
      return {
        error: `That time overlaps an existing booking ("${conflict.title}")${when}. Please pick another slot.`,
      };
    }
  }

  const attendeesCsv = cleanAttendees(input.attendees).join(', ');
  const seriesId = occurrences.length > 1 ? randomUUID() : null;
  const sql = getSql();

  try {
    const created = await sql.begin(async (tx) => {
      const out: Booking[] = [];
      for (const occ of occurrences) {
        const rows = await tx`
          INSERT INTO bookings
            (room_id, title, booked_by_name, booked_by_email, attendees, series_id, start_time, end_time)
          VALUES (
            ${input.roomId}, ${input.title.trim()}, ${input.bookedByName.trim()},
            ${input.bookedByEmail.trim()}, ${attendeesCsv}, ${seriesId},
            ${occ.startTime}::timestamptz, ${occ.endTime}::timestamptz
          )
          RETURNING *
        `;
        out.push(toBooking(rows[0]));
      }
      return out;
    });

    const opts: NotifyOptions = {};
    if (created.length > 1) {
      opts.recurrence = recurrence;
      opts.occurrenceStarts = created.map((b) => b.startTime);
    }
    await notifyBookingSafe('created', created[0], opts);
    return created;
  } catch (err) {
    if (isExclusionViolation(err)) return { error: OVERLAP_MESSAGE };
    throw err;
  }
}

/** Back-compat single-booking helper. */
export async function createBooking(input: NewBookingInput): Promise<Booking | ValidationError> {
  const res = await createBookings(input);
  return isValidationError(res) ? res : res[0];
}

export async function getBookingById(id: number): Promise<Booking | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM bookings WHERE id = ${id}`;
  return rows.length ? toBooking(rows[0]) : null;
}

export async function updateBooking(
  id: number,
  input: NewBookingInput,
  requesterEmail: string
): Promise<Booking | ValidationError> {
  const existing = await getBookingById(id);
  if (!existing) return { error: 'Booking not found.' };
  if (existing.bookedByEmail.toLowerCase() !== requesterEmail.toLowerCase()) {
    return { error: 'You can only edit bookings you made.' };
  }

  const validationError = await validateBooking(input);
  if (validationError) return validationError;

  const conflict = await findConflict(input.roomId, input.startTime, input.endTime, id);
  if (conflict) {
    return { error: `That time overlaps an existing booking ("${conflict.title}"). Please pick another slot.` };
  }

  const attendeesCsv = cleanAttendees(input.attendees).join(', ');
  const sql = getSql();
  try {
    const rows = await sql`
      UPDATE bookings
      SET room_id = ${input.roomId}, title = ${input.title.trim()},
          attendees = ${attendeesCsv},
          start_time = ${input.startTime}::timestamptz, end_time = ${input.endTime}::timestamptz
      WHERE id = ${id}
      RETURNING *
    `;
    const updated = toBooking(rows[0]);
    await notifyBookingSafe('updated', updated);
    return updated;
  } catch (err) {
    if (isExclusionViolation(err)) return { error: OVERLAP_MESSAGE };
    throw err;
  }
}

export async function deleteBooking(
  id: number,
  requesterEmail: string
): Promise<true | ValidationError> {
  const existing = await getBookingById(id);
  if (!existing) return { error: 'Booking not found.' };
  if (existing.bookedByEmail.toLowerCase() !== requesterEmail.toLowerCase()) {
    return { error: 'You can only cancel bookings you made.' };
  }
  const sql = getSql();
  await sql`DELETE FROM bookings WHERE id = ${id}`;
  await notifyBookingSafe('cancelled', existing);
  return true;
}

// ---- Room administration ----------------------------------------------------
interface RoomInput {
  name: string;
  capacity: number;
  amenities: string;
}

function validateRoom(input: Partial<RoomInput>): ValidationError | null {
  if (!input.name || !input.name.trim()) return { error: 'Room name is required.' };
  if (input.capacity == null || !Number.isFinite(input.capacity) || input.capacity < 1) {
    return { error: 'Capacity must be at least 1.' };
  }
  return null;
}

export async function createRoom(input: RoomInput): Promise<Room | ValidationError> {
  const err = validateRoom(input);
  if (err) return err;
  const sql = getSql();
  const rows = await sql`
    INSERT INTO rooms (name, capacity, amenities)
    VALUES (${input.name.trim()}, ${Math.round(input.capacity)}, ${(input.amenities ?? '').trim()})
    RETURNING id, name, capacity, amenities
  `;
  const r = rows[0];
  return { id: Number(r.id), name: r.name as string, capacity: Number(r.capacity), amenities: r.amenities as string };
}

export async function updateRoom(id: number, input: RoomInput): Promise<Room | ValidationError> {
  const err = validateRoom(input);
  if (err) return err;
  const sql = getSql();
  const rows = await sql`
    UPDATE rooms
    SET name = ${input.name.trim()}, capacity = ${Math.round(input.capacity)},
        amenities = ${(input.amenities ?? '').trim()}
    WHERE id = ${id}
    RETURNING id, name, capacity, amenities
  `;
  if (rows.length === 0) return { error: 'Room not found.' };
  const r = rows[0];
  return { id: Number(r.id), name: r.name as string, capacity: Number(r.capacity), amenities: r.amenities as string };
}

export async function deleteRoom(id: number): Promise<true | ValidationError> {
  const sql = getSql();
  const upcoming = await sql`
    SELECT count(*)::int AS n FROM bookings WHERE room_id = ${id} AND end_time > now()
  `;
  if (Number(upcoming[0].n) > 0) {
    return { error: 'This room has upcoming bookings. Cancel them before deleting the room.' };
  }
  const rows = await sql`DELETE FROM rooms WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) return { error: 'Room not found.' };
  return true;
}
