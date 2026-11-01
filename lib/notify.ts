import nodemailer, { type Transporter } from 'nodemailer';
import { getSql } from './db';
import type { Booking, Recurrence } from './types';

/**
 * Emails staff whenever a booking is created, edited, or cancelled, via SMTP
 * (configured for SMTP2GO by default). The whole STAFF_EMAILS list is notified of
 * every booking, but the calendar invite (.ics) goes ONLY to the people actually
 * in the meeting — the organiser and the attendees — so it doesn't clutter
 * everyone else's calendars. Configuration is entirely from environment
 * variables (see .env.example).
 *
 * If SMTP is not configured yet, the composed message is logged instead of sent.
 * Notification failures never block or fail a booking.
 */

export type BookingAction = 'created' | 'updated' | 'cancelled';

export interface NotifyOptions {
  recurrence?: Recurrence;
  occurrenceStarts?: string[]; // ISO starts of every occurrence in a series
}

const TIMEZONE = process.env.BOOKING_TIMEZONE || 'Africa/Johannesburg';

/** STAFF_EMAILS distribution list. */
function staffGroup(): string[] {
  return (process.env.STAFF_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** De-duplicate a list of emails (case-insensitive), dropping blanks. */
function dedupeEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const addr of list) {
    const a = addr.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}

let cachedTransport: Transporter | null = null;
function getTransport(): Transporter {
  if (!cachedTransport) {
    const port = Number(process.env.SMTP_PORT || 2525);
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.smtp2go.com',
      port,
      secure: port === 465, // 465 = implicit TLS; 587/2525/8025 use STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return cachedTransport;
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

function fmtDuration(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 minutes';
}

function recurrenceLabel(rec?: Recurrence): string | null {
  if (!rec || rec.frequency === 'none' || rec.count <= 1) return null;
  const unit = rec.frequency === 'daily' ? 'day' : 'week';
  return `Repeats every ${unit}, ${rec.count} times`;
}

async function roomName(roomId: number): Promise<string> {
  const rows = await getSql()`SELECT name FROM rooms WHERE id = ${roomId}`;
  return rows.length ? (rows[0].name as string) : `Room #${roomId}`;
}

function compose(
  action: BookingAction,
  b: Booking,
  room: string,
  opts: NotifyOptions
): { subject: string; text: string; html: string } {
  const duration = fmtDuration(b.startTime, b.endTime);
  const date = fmtDate(b.startTime);
  const from = fmtTime(b.startTime);
  const to = fmtTime(b.endTime);
  const window = `${date} from ${from} to ${to}`;
  const repeat = recurrenceLabel(opts.recurrence);

  let line: string;
  let verb: string;
  switch (action) {
    case 'created':
      verb = 'booked';
      line = `${b.bookedByName} booked ${room} for ${duration} — ${window}.`;
      break;
    case 'updated':
      verb = 'updated a booking for';
      line = `${b.bookedByName} updated their booking of ${room} — now ${duration}, ${window}.`;
      break;
    case 'cancelled':
      verb = 'cancelled a booking for';
      line = `${b.bookedByName} cancelled their booking of ${room} — was ${window}.`;
      break;
  }

  const subject = `[Room Booking] ${b.bookedByName} ${verb} ${room}`;

  const rows: [string, string][] = [
    ['Room', room],
    ['Booked by', `${b.bookedByName} (${b.bookedByEmail})`],
    ['Date', date],
    ['Time', `${from} – ${to}`],
    ['Duration', duration],
    ['Meeting', b.title],
  ];
  if (b.attendees.length) rows.push(['Attendees', b.attendees.join(', ')]);
  if (repeat) rows.push(['Repeats', repeat]);

  const text =
    `${line}\n\n` +
    rows.map(([k, v]) => `${(k + ':').padEnd(11)}${v}`).join('\n') +
    `\n\n— Sent automatically by the Room Booking system.`;

  const html =
    `<p style="font-size:15px;">${line}</p>` +
    `<table style="border-collapse:collapse;font-size:14px;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#64708a;vertical-align:top;">${k}</td><td style="padding:2px 0;">${v}</td></tr>`
      )
      .join('') +
    `</table>` +
    `<p style="font-size:12px;color:#8a95a8;">— Sent automatically by the Room Booking system.</p>`;

  return { subject, text, html };
}

// ---- Calendar invite (.ics) -------------------------------------------------
function icsDate(iso: string): string {
  // 2026-09-25T07:00:00.000Z -> 20260925T070000Z
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildIcs(action: BookingAction, b: Booking, room: string, opts: NotifyOptions): string {
  const uid = b.seriesId
    ? `series-${b.seriesId}@zenexfoundation.org.za`
    : `booking-${b.id}@zenexfoundation.org.za`;
  const method = action === 'cancelled' ? 'CANCEL' : 'REQUEST';
  const status = action === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
  const sequence = action === 'created' ? 0 : Math.floor(Date.now() / 1000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zenex Foundation//Room Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(b.startTime)}`,
    `DTEND:${icsDate(b.endTime)}`,
    `SUMMARY:${icsEscape(b.title)}`,
    `LOCATION:${icsEscape(room)}`,
    `DESCRIPTION:${icsEscape(`Room booking via Zenex Room Booking. Organiser: ${b.bookedByName}.`)}`,
    `ORGANIZER;CN=${icsEscape(b.bookedByName)}:mailto:${b.bookedByEmail}`,
    `STATUS:${status}`,
  ];

  const rec = opts.recurrence;
  if (rec && rec.frequency !== 'none' && rec.count > 1) {
    lines.push(`RRULE:FREQ=${rec.frequency.toUpperCase()};COUNT=${rec.count}`);
  }

  for (const a of b.attendees) {
    lines.push(`ATTENDEE;CN=${icsEscape(a)};RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${a}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export async function notifyBooking(
  action: BookingAction,
  booking: Booking,
  opts: NotifyOptions = {}
): Promise<void> {
  const room = await roomName(booking.roomId);
  const { subject, text, html } = compose(action, booking, room, opts);

  // Invitees get the calendar invite: the organiser + the attendees.
  const inviteList = dedupeEmails([booking.bookedByEmail, ...booking.attendees]);
  const inviteSet = new Set(inviteList.map((e) => e.toLowerCase()));
  // Everyone else on the staff list gets a notification email only (no invite).
  const notifyList = staffGroup().filter((s) => !inviteSet.has(s.toLowerCase()));

  if (inviteList.length === 0 && notifyList.length === 0) return; // nobody to reach

  if (!smtpConfigured()) {
    console.info(
      `[notify] SMTP not configured —\n` +
        `  invite (with calendar): ${inviteList.join(', ') || '(none)'}\n` +
        `  notify (email only): ${notifyList.join(', ') || '(none)'}\n` +
        `  Subject: ${subject}\n  ${text.split('\n').join('\n  ')}`
    );
    return;
  }

  const from = process.env.MAIL_FROM;
  const ics = buildIcs(action, booking, room, opts);
  const jobs: Promise<unknown>[] = [];

  // 1) Invitees — same email, with the .ics calendar invite attached.
  if (inviteList.length) {
    jobs.push(
      getTransport().sendMail({
        from,
        to: inviteList,
        subject,
        text,
        html,
        icalEvent: {
          method: action === 'cancelled' ? 'CANCEL' : 'REQUEST',
          filename: 'invite.ics',
          content: ics,
        },
      })
    );
  }

  // 2) Everyone else — notification email only, no calendar invite.
  if (notifyList.length) {
    jobs.push(getTransport().sendMail({ from, to: notifyList, subject, text, html }));
  }

  await Promise.all(jobs);
}

/**
 * Awaitable, non-throwing wrapper. Callers should AWAIT this so the send
 * actually completes before the (serverless) function returns — on Vercel a
 * fire-and-forget promise is killed when the function freezes after responding.
 * Any error is swallowed (logged) so booking operations always succeed.
 */
export async function notifyBookingSafe(
  action: BookingAction,
  booking: Booking,
  opts: NotifyOptions = {}
): Promise<void> {
  try {
    await notifyBooking(action, booking, opts);
  } catch (err) {
    console.error(`[notify] Failed to send "${action}" notification:`, err);
  }
}
