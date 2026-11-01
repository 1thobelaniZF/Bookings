# Room Booking System

A full-stack web app for staff to book boardrooms and meeting rooms. Built with
Next.js (App Router) + React and a local SQLite database.

## Features

- **Simple sign-in** — staff enter their name and work email (no passwords). Only
  `@zenexfoundation.org.za` addresses are accepted (enforced on both the sign-in
  screen and the server). The identity is remembered in the browser.
- **Staff email notifications** — every booking create/edit/cancel sends one
  email to the staff list via SMTP (SMTP2GO). See `.env.example` for setup;
  until it's configured the message is logged instead.
- **Week calendar view** — per-room, showing existing bookings as time blocks.
  Your own bookings are highlighted in green.
- **Book a room** — click a time slot or the *New booking* button. Pick a room,
  title, start and end time.
- **Conflict prevention** — the server rejects any booking that overlaps an
  existing one **in the same room**, so a room can never be double-booked. The
  same time in a *different* room is allowed.
- **My bookings** — view your upcoming bookings and **edit** or **cancel** them.
  You can only change bookings you made.

## Getting started

1. **Create a Supabase project** (free tier is fine) at https://supabase.com.
2. **Create the schema.** In the Supabase Dashboard → SQL Editor → New query,
   paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it.
   This creates the tables, the no-overlap constraint, and seeds the six rooms.
3. **Set environment variables.** Copy `.env.example` to `.env.local` and fill in
   `DATABASE_URL` (Supabase → Project Settings → Database → the **Transaction**
   pooler connection string, port 6543) plus the SMTP2GO values.
4. **Run it:**

   ```bash
   npm install
   npm run dev
   ```

   Then open the URL printed in the terminal (default http://localhost:3000).

To run a production build locally:

```bash
npm run build
npm start
```

### Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. In the Vercel project's **Environment Variables**, add the same keys from
   `.env.local`: `DATABASE_URL`, `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `STAFF_EMAILS`,
   and optionally `BOOKING_TIMEZONE`.
3. Deploy. The schema step (2 above) only needs to be run once against the
   database, not per deploy.

## How it works

| Layer | Location |
| --- | --- |
| Database schema + seed rooms | `supabase/schema.sql` (run once) |
| Postgres client (connection) | `lib/db.ts` |
| Booking logic (validation, conflict check, CRUD) | `lib/bookings.ts` |
| REST API | `app/api/rooms`, `app/api/bookings`, `app/api/bookings/[id]` |
| UI (calendar, modal, my-bookings) | `app/page.tsx` |
| Styles | `app/globals.css` |

Data lives in **Supabase Postgres**, reached with the lightweight `postgres`
client. The six rooms are seeded by `supabase/schema.sql` — edit the `VALUES`
list there to change them. Double-booking is prevented both by an app-level
check (which can name the clashing meeting) and a database exclusion constraint
(the hard guarantee, even under simultaneous requests).

## Notes & possible next steps

- **Rooms are seeded, not managed in-app.** Add an admin screen + `POST/PUT/DELETE
  /api/rooms` routes if staff should manage rooms themselves.
- **Identity is trust-based** (name/email, no password). Swap in real auth (e.g.
  Clerk) when you need verified accounts, roles, or an admin view.
- **Times are stored in UTC** (ISO 8601) and displayed in the viewer's local
  timezone.
- Email notifications, recurring bookings, and per-room booking rules are natural
  extensions.
