'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  LayoutList,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  Pencil,
  Trash2,
  LogOut,
  CalendarX,
  Check,
  AlertCircle,
  CalendarClock,
  Map as MapIcon,
  DoorOpen,
} from 'lucide-react';
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from '@/lib/email';
import type { BookingWithRoom, Room } from '@/lib/types';

// Deterministic, refined colour per room — used across the calendar, dashboard,
// and room chips so each room is recognisable at a glance.
const ROOM_COLORS = [
  '#5e2b8a', // purple
  '#2f7d8a', // teal
  '#b5561f', // burnt orange
  '#3a6ea5', // steel blue
  '#7a4b9c', // violet
  '#2f8a5b', // green
  '#a13b6a', // plum
  '#8a6d2f', // ochre
];
function roomColor(roomId: number): string {
  return ROOM_COLORS[Math.abs(roomId) % ROOM_COLORS.length];
}


function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// Calendar display window (local hours).
const DAY_START = 7; // 07:00
const DAY_END = 20; // 20:00
const HOUR_PX = 48;
const DEFAULT_DURATION_MIN = 60;

// ---- Date helpers (all operate in the browser's local timezone) ----------
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDateLong(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
// Convert a Date to the value string for <input type="datetime-local">.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

interface Identity {
  name: string;
  email: string;
}

// Company logo. Uses /logo.png (drop the official file into `public/logo.png`)
// and falls back to an on-brand text wordmark until that file is present.
function Logo({ className, wordmarkHeight }: { className: string; wordmarkHeight: number }) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src="/logo.png"
        alt="Zenex Foundation"
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }
  const w = wordmarkHeight * 3.7;
  return (
    <svg
      className={className}
      viewBox="0 0 260 70"
      width={w}
      height={wordmarkHeight}
      role="img"
      aria-label="Zenex Foundation"
    >
      <text x="0" y="44" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="50" fill="var(--brand-orange)" letterSpacing="1">ZENEX</text>
      <text x="3" y="65" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="15" fill="var(--primary)" letterSpacing="7.5">FOUNDATION</text>
    </svg>
  );
}

interface FormState {
  id: number | null;
  roomId: number;
  title: string;
  attendees: string[]; // selected/entered attendee emails
  repeat: 'none' | 'daily' | 'weekly';
  repeatCount: number;
  start: string; // datetime-local value
  end: string; // datetime-local value
}

// Split raw typed text into individual email strings (handles pasted lists).
function parseAttendees(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function Page() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('booking_identity');
      if (raw) setIdentity(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const saveIdentity = (id: Identity) => {
    setIdentity(id);
    try {
      localStorage.setItem('booking_identity', JSON.stringify(id));
    } catch {
      /* ignore */
    }
  };

  const signOut = () => {
    setIdentity(null);
    try {
      localStorage.removeItem('booking_identity');
    } catch {
      /* ignore */
    }
  };

  if (!ready) return null;
  if (!identity) return <IdentityGate onSubmit={saveIdentity} />;
  return <BookingApp identity={identity} onSignOut={signOut} />;
}

// ---- Identity gate -------------------------------------------------------
function IdentityGate({ onSubmit }: { onSubmit: (id: Identity) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!name.trim()) return setErr('Please enter your name.');
    if (!isAllowedEmail(email)) return setErr(`Please use your @${ALLOWED_EMAIL_DOMAIN} email address.`);
    onSubmit({ name: name.trim(), email: email.trim() });
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <Logo className="gate-logo" wordmarkHeight={52} />
        <h1>Room Booking</h1>
        <p>Tell us who you are so we can attach your bookings to you.</p>
        <div className="form-grid">
          <label className="field">
            Your name
            <input
              type="text"
              value={name}
              placeholder="Jane Doe"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <label className="field">
            Work email
            <input
              type="email"
              value={email}
              placeholder={`jane@${ALLOWED_EMAIL_DOMAIN}`}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {err && <div className="form-error">{err}</div>}
          <button className="btn btn-primary" onClick={submit}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main app ------------------------------------------------------------
function BookingApp({ identity, onSignOut }: { identity: Identity; onSignOut: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [bookings, setBookings] = useState<BookingWithRoom[]>([]);
  const [myBookings, setMyBookings] = useState<BookingWithRoom[]>([]);
  const [allBookings, setAllBookings] = useState<BookingWithRoom[]>([]);
  const [view, setView] = useState<'calendar' | 'all' | 'admin'>('calendar');
  const [isAdmin, setIsAdmin] = useState(false);
  const [staff, setStaff] = useState<string[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(
    () => Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i),
    []
  );
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  // Load rooms (and learn whether this user is an admin).
  const loadRooms = useCallback(() => {
    fetch(`/api/rooms?email=${encodeURIComponent(identity.email)}`)
      .then((r) => r.json())
      .then((d) => {
        setRooms(d.rooms);
        setIsAdmin(Boolean(d.isAdmin));
        setSelectedRoomId((prev) =>
          prev != null && d.rooms.some((r: Room) => r.id === prev)
            ? prev
            : d.rooms[0]?.id ?? null
        );
      })
      .catch(() => showToast('Failed to load rooms.', 'err'));
  }, [identity.email, showToast]);

  useEffect(() => loadRooms(), [loadRooms]);

  // Load the staff directory once for the attendee picker.
  useEffect(() => {
    fetch('/api/staff')
      .then((r) => r.json())
      .then((d) => setStaff(d.staff ?? []))
      .catch(() => {
        /* picker still works with manual entry */
      });
  }, []);

  const loadWeekBookings = useCallback(() => {
    if (selectedRoomId == null) return;
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    fetch(`/api/bookings?roomId=${selectedRoomId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => r.json())
      .then((d) => setBookings(d.bookings))
      .catch(() => showToast('Failed to load bookings.', 'err'));
  }, [selectedRoomId, weekStart, showToast]);

  const loadMyBookings = useCallback(() => {
    fetch(`/api/bookings?email=${encodeURIComponent(identity.email)}`)
      .then((r) => r.json())
      .then((d) => setMyBookings(d.bookings))
      .catch(() => showToast('Failed to load your bookings.', 'err'));
  }, [identity.email, showToast]);

  const loadAllBookings = useCallback(() => {
    fetch(`/api/bookings?from=${encodeURIComponent(new Date().toISOString())}`)
      .then((r) => r.json())
      .then((d) => setAllBookings(d.bookings))
      .catch(() => showToast('Failed to load bookings.', 'err'));
  }, [showToast]);

  useEffect(() => loadWeekBookings(), [loadWeekBookings]);
  useEffect(() => loadMyBookings(), [loadMyBookings]);
  useEffect(() => {
    if (view === 'all') loadAllBookings();
  }, [view, loadAllBookings]);

  const refresh = () => {
    loadWeekBookings();
    loadMyBookings();
    loadAllBookings();
  };

  // Open the modal for a brand-new booking, optionally pre-filled from a slot.
  const openNew = (slotStart?: Date, roomId?: number) => {
    const start = slotStart ?? nextRoundHour();
    const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
    setForm({
      id: null,
      roomId: roomId ?? selectedRoomId ?? rooms[0]?.id ?? 0,
      title: '',
      attendees: [],
      repeat: 'none',
      repeatCount: 4,
      start: toLocalInput(start),
      end: toLocalInput(end),
    });
  };

  const openEdit = (b: BookingWithRoom) => {
    setForm({
      id: b.id,
      roomId: b.roomId,
      title: b.title,
      attendees: [...b.attendees],
      repeat: 'none', // editing changes a single occurrence only
      repeatCount: 4,
      start: toLocalInput(new Date(b.startTime)),
      end: toLocalInput(new Date(b.endTime)),
    });
  };

  const submitForm = async (f: FormState): Promise<string | null> => {
    const payload = {
      roomId: f.roomId,
      title: f.title,
      bookedByName: identity.name,
      bookedByEmail: identity.email,
      attendees: f.attendees,
      startTime: new Date(f.start).toISOString(),
      endTime: new Date(f.end).toISOString(),
      recurrence:
        !f.id && f.repeat !== 'none'
          ? { frequency: f.repeat, count: f.repeatCount }
          : undefined,
    };
    const url = f.id ? `/api/bookings/${f.id}` : '/api/bookings';
    const method = f.id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return d.error ?? 'Something went wrong.';
    }
    const data = await res.json().catch(() => ({}));
    setForm(null);
    refresh();
    const madeCount = data.count ?? 1;
    showToast(
      f.id
        ? 'Booking updated.'
        : madeCount > 1
          ? `Booked ${madeCount} sessions!`
          : 'Room booked!',
      'ok'
    );
    return null;
  };

  const cancelBooking = async (b: BookingWithRoom) => {
    if (!confirm(`Cancel "${b.title}" in ${b.roomName}?`)) return;
    const res = await fetch(`/api/bookings/${b.id}?email=${encodeURIComponent(identity.email)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showToast(d.error ?? 'Failed to cancel.', 'err');
      return;
    }
    refresh();
    showToast('Booking cancelled.', 'ok');
  };

  const upcomingMine = myBookings
    .filter((b) => new Date(b.endTime) >= new Date())
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const isThisWeek = sameDay(weekStart, startOfWeek(new Date()));

  return (
    <>
      <header className="app-header">
        <h1>
          <Logo className="app-logo" wordmarkHeight={34} />
          <span className="app-title-sep">|</span>
          <span className="app-title">Room Booking</span>
        </h1>
        <div className="identity">
          <span className="avatar" title={identity.email}>
            {initials(identity.name)}
          </span>
          <strong>{identity.name}</strong>
          <button className="btn btn-ghost" onClick={onSignOut}>
            <LogOut />
            Switch user
          </button>
        </div>
      </header>

      <div className="container">
        <div className="toolbar">
          <div className="view-toggle">
            <button
              className={view === 'calendar' ? 'active' : ''}
              onClick={() => setView('calendar')}
            >
              <CalendarDays />
              Calendar
            </button>
            <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
              <LayoutList />
              All bookings
            </button>
            {isAdmin && (
              <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
                <Settings2 />
                Manage rooms
              </button>
            )}
          </div>

          {view === 'calendar' && (
            <>
              <label className="field" style={{ minWidth: 200 }}>
                Room
                <select
                  value={selectedRoomId ?? ''}
                  onChange={(e) => setSelectedRoomId(Number(e.target.value))}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="spacer" />

              <div className="week-nav">
                <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
                  <ChevronLeft />
                </button>
                <span className="week-label">
                  {fmtDateLong(weekStart)} – {fmtDateLong(addDays(weekStart, 6))}
                </span>
                <button className="btn icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
                  <ChevronRight />
                </button>
                {!isThisWeek && (
                  <button className="btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                    Today
                  </button>
                )}
              </div>
            </>
          )}

          {view !== 'calendar' && <div className="spacer" />}

          {view !== 'admin' && (
            <button className="btn btn-primary" onClick={() => openNew()}>
              <Plus />
              New booking
            </button>
          )}
        </div>

        {view === 'admin' ? (
          <AdminRooms
            rooms={rooms}
            requesterEmail={identity.email}
            onChanged={loadRooms}
            showToast={showToast}
          />
        ) : view === 'calendar' ? (
          <>
        {selectedRoom && (
          <div className="room-meta">
            <span
              className="chip room-pill"
              style={{ background: roomColor(selectedRoom.id) }}
            >
              {selectedRoom.name}
            </span>
            <span className="chip">
              <Users /> {selectedRoom.capacity} seats
            </span>
            {selectedRoom.amenities
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean)
              .map((a) => (
                <span key={a} className="chip">
                  {a}
                </span>
              ))}
            <span className="spacer" />
            <span className="legend">
              <span>
                <span className="dot" style={{ background: roomColor(selectedRoom.id) }} />
                Booked
              </span>
              <span>
                <span
                  className="dot"
                  style={{ background: roomColor(selectedRoom.id), boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.25)' }}
                />
                Yours
              </span>
            </span>
          </div>
        )}

        <div className="calendar">
          <div className="calendar-scroll">
            <div className="cal-grid">
              {/* Header row */}
              <div className="cal-corner" />
              {weekDays.map((d) => {
                const today = sameDay(d, new Date());
                return (
                  <div key={d.toISOString()} className={`cal-dayhead${today ? ' today' : ''}`}>
                    <div className="dow">{d.toLocaleDateString([], { weekday: 'short' })}</div>
                    <div className="dnum">
                      <span>{d.getDate()}</span>
                    </div>
                  </div>
                );
              })}

              {/* Time column */}
              <div className="cal-timecol">
                {hours.map((h) => (
                  <div key={h} className="cal-timelabel">
                    {h % 12 === 0 ? 12 : h % 12}
                    {h < 12 ? 'am' : 'pm'}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((day, di) => {
                const isWeekend = di >= 5;
                const isToday = sameDay(day, new Date());
                const dayBookings = bookings.filter((b) => sameDay(new Date(b.startTime), day));
                return (
                  <div
                    key={day.toISOString()}
                    className={`cal-daycol${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}`}
                  >
                    {hours.map((h) => {
                      const slotStart = new Date(day);
                      slotStart.setHours(h, 0, 0, 0);
                      return (
                        <div
                          key={h}
                          className="cal-slot"
                          onClick={() => openNew(slotStart)}
                          title={`Book ${fmtTime(slotStart)}`}
                        />
                      );
                    })}
                    {isToday && <NowLine />}
                    {dayBookings.map((b) => (
                      <BookingBlock
                        key={b.id}
                        booking={b}
                        color={roomColor(b.roomId)}
                        mine={b.bookedByEmail.toLowerCase() === identity.email.toLowerCase()}
                        onClick={() => openEdit(b)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* My bookings */}
        <div className="panel">
          <h2>My upcoming bookings</h2>
          {upcomingMine.length === 0 ? (
            <div className="empty">
              <CalendarClock />
              You have no upcoming bookings. Click a time slot above to book a room.
            </div>
          ) : (
            <div className="mybk-list">
              {upcomingMine.map((b) => {
                const s = new Date(b.startTime);
                const e = new Date(b.endTime);
                return (
                  <div key={b.id} className="mybk-row">
                    <div className="info">
                      <div className="t">{b.title}</div>
                      <div className="s">
                        {b.roomName} — {fmtDateLong(s)}, {fmtTime(s)}–{fmtTime(e)}
                        {b.attendees.length > 0 &&
                          ` · ${b.attendees.length} guest${b.attendees.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    <div className="mybk-actions">
                      <button className="btn" onClick={() => openEdit(b)}>
                        <Pencil />
                        Edit
                      </button>
                      <button className="btn btn-danger" onClick={() => cancelBooking(b)}>
                        <Trash2 />
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </>
        ) : (
          <AllBookings
            bookings={allBookings}
            rooms={rooms}
            identityEmail={identity.email}
            onEdit={openEdit}
            onCancel={cancelBooking}
            onBookRoom={(roomId) => openNew(undefined, roomId)}
          />
        )}
      </div>

      {form && (
        <BookingModal
          form={form}
          rooms={rooms}
          staff={staff}
          organizerEmail={identity.email}
          isEdit={form.id != null}
          onClose={() => setForm(null)}
          onSubmit={submitForm}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          {toast.kind === 'err' ? <AlertCircle /> : <Check />}
          {toast.msg}
        </div>
      )}
    </>
  );
}

function nextRoundHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

// ---- All bookings dashboard ---------------------------------------------
function roomStatusNow(
  roomId: number,
  bookings: BookingWithRoom[],
  now: Date
): { busy: boolean; until?: string; title?: string } {
  const t = now.getTime();
  const cur = bookings.find(
    (b) =>
      b.roomId === roomId &&
      new Date(b.startTime).getTime() <= t &&
      new Date(b.endTime).getTime() > t
  );
  return cur ? { busy: true, until: cur.endTime, title: cur.title } : { busy: false };
}

function AllBookings({
  bookings,
  rooms,
  identityEmail,
  onEdit,
  onCancel,
  onBookRoom,
}: {
  bookings: BookingWithRoom[];
  rooms: Room[];
  identityEmail: string;
  onEdit: (b: BookingWithRoom) => void;
  onCancel: (b: BookingWithRoom) => void;
  onBookRoom: (roomId: number) => void;
}) {
  const [mode, setMode] = useState<'list' | 'plan'>('list');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const roomNames = Array.from(new Set(bookings.map((b) => b.roomName))).sort();
  const filtered = bookings
    .filter((b) => roomFilter === 'all' || b.roomName === roomFilter)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Group by calendar day (in the viewer's local timezone).
  const groups: { key: string; label: string; items: BookingWithRoom[] }[] = [];
  for (const b of filtered) {
    const d = new Date(b.startTime);
    const key = d.toDateString();
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: fmtDateLong(d), items: [] };
      groups.push(g);
    }
    g.items.push(b);
  }

  const freeCount = rooms.filter((r) => !roomStatusNow(r.id, bookings, now).busy).length;

  return (
    <div className="panel">
      <div className="allbk-head">
        <h2>All bookings</h2>
        <span className="allbk-count">
          {mode === 'plan' ? `${freeCount}/${rooms.length} free` : filtered.length}
        </span>
        <div className="spacer" />
        <div className="view-toggle sub">
          <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>
            <LayoutList />
            List
          </button>
          <button className={mode === 'plan' ? 'active' : ''} onClick={() => setMode('plan')}>
            <MapIcon />
            Floor plan
          </button>
        </div>
        {mode === 'list' && (
          <label className="field" style={{ minWidth: 170 }}>
            Filter by room
            <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              <option value="all">All rooms</option>
              {roomNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {mode === 'plan' ? (
        <FloorPlan rooms={rooms} bookings={bookings} now={now} onPick={setDetailRoom} />
      ) : filtered.length === 0 ? (
        <div className="empty">
          <CalendarX />
          No upcoming bookings yet.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="allbk-group">
            <div className="allbk-date">
              <CalendarDays />
              {g.label}
            </div>
            <div className="mybk-list">
              {g.items.map((b) => {
                const s = new Date(b.startTime);
                const e = new Date(b.endTime);
                const mine = b.bookedByEmail.toLowerCase() === identityEmail.toLowerCase();
                return (
                  <div key={b.id} className="mybk-row">
                    <div className="allbk-time">
                      {fmtTime(s)} – {fmtTime(e)}
                    </div>
                    <span className="allbk-room" style={{ background: roomColor(b.roomId) }}>
                      {b.roomName}
                    </span>
                    <div className="info">
                      <div className="t">{b.title}</div>
                      <div className="s" title={b.attendees.join(', ')}>
                        {mine ? 'You' : b.bookedByName}
                        {b.attendees.length > 0 &&
                          ` · ${b.attendees.length} guest${b.attendees.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    {mine && (
                      <div className="mybk-actions">
                        <button className="btn" onClick={() => onEdit(b)}>
                          <Pencil />
                          Edit
                        </button>
                        <button className="btn btn-danger" onClick={() => onCancel(b)}>
                          <Trash2 />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {detailRoom && (
        <RoomDetail
          room={detailRoom}
          bookings={bookings.filter((b) => b.roomId === detailRoom.id)}
          now={now}
          onClose={() => setDetailRoom(null)}
          onBook={() => {
            const id = detailRoom.id;
            setDetailRoom(null);
            onBookRoom(id);
          }}
        />
      )}
    </div>
  );
}

// ---- Floor plan (overhead office map) -----------------------------------
// Positions mirror the office layout, keyed by room name. Rooms not in the map
// (e.g. newly added) are listed below the plan so nothing is ever hidden.
const FLOOR_LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  Infinity: { x: 465, y: 24, w: 210, h: 150 },
  Inspiration: { x: 700, y: 206, w: 185, h: 128 },
  Innovation: { x: 700, y: 372, w: 185, h: 120 },
  'Square Root': { x: 690, y: 556, w: 200, h: 140 },
  Congruent: { x: 300, y: 372, w: 180, h: 120 },
  Power: { x: 70, y: 372, w: 170, h: 120 },
};

// Draws realistic overhead furniture inside a room: a conference table with
// chairs for meeting rooms, or a desk + monitor + chair for private offices.
function Furniture({
  box,
  capacity,
}: {
  box: { x: number; y: number; w: number; h: number };
  capacity: number;
}) {
  const stroke = '#1b1b1b';
  const chairFill = 'none';
  const tableFill = 'none';
  const areaX = box.x + 16;
  const areaY = box.y + 48;
  const areaW = box.w - 32;
  const areaH = box.h - 48 - 34;
  const cs = 9; // chair size (overhead)
  const gap = 6;

  // Private office: a desk against the wall, a monitor, and a chair.
  if (capacity <= 3) {
    const deskW = Math.min(areaW * 0.72, 120);
    const deskH = 15;
    const deskX = box.x + (box.w - deskW) / 2;
    const deskY = areaY + areaH - deskH - 18;
    const monW = deskW * 0.42;
    const monX = deskX + (deskW - monW) / 2;
    const chairW = 18;
    const chairH = 12;
    return (
      <g opacity={0.92} pointerEvents="none">
        <rect x={monX} y={deskY - 7} width={monW} height={6} rx={1.5} fill="none" stroke={stroke} />
        <rect x={deskX} y={deskY} width={deskW} height={deskH} rx={3} fill={tableFill} stroke={stroke} />
        <rect
          x={box.x + (box.w - chairW) / 2}
          y={deskY + deskH + 6}
          width={chairW}
          height={chairH}
          rx={3}
          fill={chairFill}
          stroke={stroke}
        />
      </g>
    );
  }

  // Meeting room: central table with chairs down both long sides (+ ends if big).
  const tableX = areaX + cs + 4;
  const tableY = areaY + cs + 4;
  const tableW = areaW - 2 * (cs + 4);
  const tableH = areaH - 2 * (cs + 4);
  const maxPerSide = Math.max(1, Math.floor((tableW + gap) / (cs + gap)));
  const perSide = Math.min(Math.max(Math.round(capacity / 2), 1), maxPerSide);
  const chairs: { x: number; y: number }[] = [];
  for (let i = 0; i < perSide; i++) {
    const cxc = tableX + ((i + 0.5) * tableW) / perSide - cs / 2;
    chairs.push({ x: cxc, y: areaY });
    chairs.push({ x: cxc, y: areaY + areaH - cs });
  }
  if (capacity >= 8 && tableH >= 24) {
    const cyc = tableY + tableH / 2 - cs / 2;
    chairs.push({ x: areaX, y: cyc });
    chairs.push({ x: areaX + areaW - cs, y: cyc });
  }
  return (
    <g opacity={0.92} pointerEvents="none">
      <rect x={tableX} y={tableY} width={tableW} height={tableH} rx={5} fill={tableFill} stroke={stroke} />
      {chairs.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={cs} height={cs} rx={2.5} fill={chairFill} stroke={stroke} />
      ))}
    </g>
  );
}

function FloorPlan({
  rooms,
  bookings,
  now,
  onPick,
}: {
  rooms: Room[];
  bookings: BookingWithRoom[];
  now: Date;
  onPick: (room: Room) => void;
}) {
  const placed = rooms.filter((r) => FLOOR_LAYOUT[r.name]);
  const unplaced = rooms.filter((r) => !FLOOR_LAYOUT[r.name]);

  const corridors = [
    { x: 560, y: 150, w: 24, h: 470 }, // vertical spine
    { x: 584, y: 262, w: 116, h: 16 }, // → Inspiration
    { x: 584, y: 424, w: 116, h: 16 }, // → Innovation
    { x: 584, y: 610, w: 106, h: 16 }, // → Square Root
    { x: 480, y: 424, w: 80, h: 16 }, // spine → Congruent
    { x: 240, y: 424, w: 60, h: 16 }, // Congruent → Power
  ];

  const ink = '#1b1b1b';

  return (
    <div>
      <div className="plan-legend bp-legend">
        <span>
          <span className="bp-swatch free" /> Free
        </span>
        <span>
          <span className="bp-swatch busy" /> In use
        </span>
        <span className="plan-asof">ZENEX FOUNDATION · OFFICE FLOOR PLAN · as of {fmtTime(now)}</span>
      </div>

      <div className="bp-wrap">
        <svg viewBox="0 0 920 720" className="bp-plan" role="img" aria-label="Office floor plan">
          <defs>
            <pattern id="bp-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="#e1e5ec" strokeWidth="1" />
            </pattern>
            <pattern id="bp-grid-major" width="120" height="120" patternUnits="userSpaceOnUse">
              <path d="M120 0H0V120" fill="none" stroke="#cfd5de" strokeWidth="1.2" />
            </pattern>
          </defs>

          {/* drafting paper + grid */}
          <rect x="0" y="0" width="920" height="720" fill="#fbfbf9" />
          <rect x="0" y="0" width="920" height="720" fill="url(#bp-grid)" />
          <rect x="0" y="0" width="920" height="720" fill="url(#bp-grid-major)" />
          {/* border frame */}
          <rect x="8" y="8" width="904" height="704" fill="none" stroke={ink} strokeWidth="2" />
          <rect x="14" y="14" width="892" height="692" fill="none" stroke={ink} strokeWidth="1" />

          {/* corridors / hallways */}
          {corridors.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill="#ffffff" stroke={ink} strokeWidth="1" />
          ))}

          {placed.map((r) => {
            const p = FLOOR_LAYOUT[r.name];
            const st = roomStatusNow(r.id, bookings, now);
            const cx = p.x + p.w / 2;
            const by = p.y + p.h;
            const dw = 26;
            // Door sits in the bottom-left corner so the status badge can use the bottom-right.
            const hx = p.x + 10;
            const label = st.busy ? `IN USE · ${fmtTime(new Date(st.until!))}` : 'FREE';
            const badgeW = Math.min(label.length * 6.2 + 16, p.w - 52);
            const badgeH = 18;
            const badgeX = p.x + p.w - 10 - badgeW;
            const badgeY = by - 10 - badgeH;
            return (
              <g
                key={r.id}
                className="bp-room"
                onClick={() => onPick(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onPick(r);
                }}
              >
                {/* room (outer wall), tinted green when free / red when in use */}
                <rect
                  className="bp-room-fill"
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  fill={st.busy ? '#fdecec' : '#eaf7ee'}
                  stroke={ink}
                  strokeWidth="2.5"
                />
                {/* inner wall line (double-line detail) */}
                <rect x={p.x + 4} y={p.y + 4} width={p.w - 8} height={p.h - 8} fill="none" stroke={ink} strokeWidth="1" />
                {/* door swing */}
                <path
                  d={`M ${hx} ${by} L ${hx} ${by - dw} A ${dw} ${dw} 0 0 1 ${hx + dw} ${by}`}
                  fill="none"
                  stroke={ink}
                  strokeWidth="1"
                />
                <Furniture box={p} capacity={r.capacity} />
                <text x={cx} y={p.y + 24} textAnchor="middle" className="bp-name">
                  {r.name.toUpperCase()}
                </text>
                <text x={cx} y={p.y + 38} textAnchor="middle" className="bp-sub">
                  {r.capacity} PAX
                </text>
                <rect
                  x={badgeX}
                  y={badgeY}
                  width={badgeW}
                  height={badgeH}
                  rx={9}
                  fill={st.busy ? 'var(--danger)' : 'var(--success)'}
                />
                <text x={badgeX + badgeW / 2} y={badgeY + 12.5} textAnchor="middle" className="bp-status">
                  {label}
                </text>
              </g>
            );
          })}

          {/* north arrow */}
          <g transform="translate(866,54)">
            <line x1="0" y1="22" x2="0" y2="-16" stroke={ink} strokeWidth="1.5" />
            <path d="M0 -24 L5 -12 L-5 -12 Z" fill={ink} />
            <text x="0" y="38" textAnchor="middle" className="bp-sub">
              N
            </text>
          </g>
        </svg>
      </div>

      {unplaced.length > 0 && (
        <div className="plan-unplaced">
          Not on the plan yet:{' '}
          {unplaced.map((r) => (
            <button key={r.id} className="chip" onClick={() => onPick(r)}>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Room detail (from the floor plan) ----------------------------------
function RoomDetail({
  room,
  bookings,
  now,
  onClose,
  onBook,
}: {
  room: Room;
  bookings: BookingWithRoom[];
  now: Date;
  onClose: () => void;
  onBook: () => void;
}) {
  const st = roomStatusNow(room.id, bookings, now);
  const upcoming = bookings
    .slice()
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, 6);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="dot"
            style={{ width: 12, height: 12, borderRadius: 4, background: roomColor(room.id) }}
          />
          {room.name}
        </h3>
        <p className="sub">
          {room.capacity} seats{room.amenities ? ` · ${room.amenities}` : ''}
        </p>

        <div className={`room-status ${st.busy ? 'busy' : 'free'}`}>
          {st.busy ? (
            <>
              <DoorOpen /> In use until {fmtTime(new Date(st.until!))}
            </>
          ) : (
            <>
              <Check /> Free right now
            </>
          )}
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          Upcoming bookings
        </div>
        {upcoming.length === 0 ? (
          <div className="empty" style={{ padding: 16 }}>
            No upcoming bookings.
          </div>
        ) : (
          <div className="mybk-list" style={{ marginTop: 6 }}>
            {upcoming.map((b) => {
              const s = new Date(b.startTime);
              const e = new Date(b.endTime);
              return (
                <div key={b.id} className="mybk-row">
                  <div className="info">
                    <div className="t">{b.title}</div>
                    <div className="s">
                      {fmtDateLong(s)}, {fmtTime(s)}–{fmtTime(e)} · {b.bookedByName}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={onBook}>
            <Plus />
            Book this room
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Admin: manage rooms ------------------------------------------------
interface RoomDraft {
  name: string;
  capacity: string;
  amenities: string;
}

function AdminRooms({
  rooms,
  requesterEmail,
  onChanged,
  showToast,
}: {
  rooms: Room[];
  requesterEmail: string;
  onChanged: () => void;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
}) {
  const toDraft = (r: Room): RoomDraft => ({
    name: r.name,
    capacity: String(r.capacity),
    amenities: r.amenities,
  });
  const [drafts, setDrafts] = useState<Record<number, RoomDraft>>(() =>
    Object.fromEntries(rooms.map((r) => [r.id, toDraft(r)]))
  );
  const [neu, setNeu] = useState<RoomDraft>({ name: '', capacity: '4', amenities: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(rooms.map((r) => [r.id, toDraft(r)])));
  }, [rooms]);

  const setDraft = (id: number, patch: Partial<RoomDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const save = async (id: number) => {
    const d = drafts[id];
    setBusy(true);
    const res = await fetch(`/api/rooms/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterEmail, name: d.name, capacity: Number(d.capacity), amenities: d.amenities }),
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      showToast(e.error ?? 'Failed to save room.', 'err');
      return;
    }
    showToast('Room saved.');
    onChanged();
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${id}?email=${encodeURIComponent(requesterEmail)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      showToast(e.error ?? 'Failed to delete room.', 'err');
      return;
    }
    showToast('Room deleted.');
    onChanged();
  };

  const add = async () => {
    if (!neu.name.trim()) return showToast('Enter a room name.', 'err');
    setBusy(true);
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterEmail, name: neu.name, capacity: Number(neu.capacity), amenities: neu.amenities }),
    });
    setBusy(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      showToast(e.error ?? 'Failed to add room.', 'err');
      return;
    }
    showToast('Room added.');
    setNeu({ name: '', capacity: '4', amenities: '' });
    onChanged();
  };

  return (
    <div className="panel">
      <h2>Manage rooms</h2>
      <div className="admin-head">
        <span>Name</span>
        <span>Seats</span>
        <span>Amenities</span>
        <span />
      </div>

      {rooms.map((r) => {
        const d = drafts[r.id] ?? toDraft(r);
        return (
          <div key={r.id} className="admin-row">
            <input value={d.name} onChange={(e) => setDraft(r.id, { name: e.target.value })} />
            <input
              type="number"
              min={1}
              value={d.capacity}
              onChange={(e) => setDraft(r.id, { capacity: e.target.value })}
            />
            <input
              value={d.amenities}
              placeholder="Projector, Whiteboard…"
              onChange={(e) => setDraft(r.id, { amenities: e.target.value })}
            />
            <div className="admin-actions">
              <button className="btn" disabled={busy} onClick={() => save(r.id)}>
                Save
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => remove(r.id, r.name)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}

      <div className="admin-row admin-new">
        <input
          value={neu.name}
          placeholder="New room name"
          onChange={(e) => setNeu({ ...neu, name: e.target.value })}
        />
        <input
          type="number"
          min={1}
          value={neu.capacity}
          onChange={(e) => setNeu({ ...neu, capacity: e.target.value })}
        />
        <input
          value={neu.amenities}
          placeholder="Amenities (comma separated)"
          onChange={(e) => setNeu({ ...neu, amenities: e.target.value })}
        />
        <div className="admin-actions">
          <button className="btn btn-primary" disabled={busy} onClick={add}>
            + Add room
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Live "now" indicator line ------------------------------------------
function NowLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dayStartMin = DAY_START * 60;
  const dayEndMin = DAY_END * 60;
  if (minutes < dayStartMin || minutes > dayEndMin) return null;
  const top = ((minutes - dayStartMin) / 60) * HOUR_PX;
  return <div className="now-line" style={{ top: `${top}px` }} aria-hidden />;
}

// ---- Booking block on the calendar --------------------------------------
function BookingBlock({
  booking,
  color,
  mine,
  onClick,
}: {
  booking: BookingWithRoom;
  color: string;
  mine: boolean;
  onClick: () => void;
}) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const dayStartMin = DAY_START * 60;

  const top = ((startMinutes - dayStartMin) / 60) * HOUR_PX;
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_PX - 2, 18);

  return (
    <div
      className={`booking-block${mine ? ' mine' : ''}`}
      style={{ top: `${top}px`, height: `${height}px`, background: color }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${booking.title} — ${fmtTime(start)}–${fmtTime(end)} (${booking.bookedByName})`}
    >
      <div className="bk-title">{booking.title}</div>
      <div className="bk-time">
        {fmtTime(start)}–{fmtTime(end)}
      </div>
      <div className="bk-who">{mine ? 'You' : booking.bookedByName}</div>
    </div>
  );
}

// ---- Create/edit modal ---------------------------------------------------
function BookingModal({
  form,
  rooms,
  staff,
  organizerEmail,
  isEdit,
  onClose,
  onSubmit,
}: {
  form: FormState;
  rooms: Room[];
  staff: string[];
  organizerEmail: string;
  isEdit: boolean;
  onClose: () => void;
  onSubmit: (f: FormState) => Promise<string | null>;
}) {
  const [state, setState] = useState<FormState>(form);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [externalInput, setExternalInput] = useState('');

  const selectedRoom = rooms.find((r) => r.id === state.roomId) ?? null;
  const headcount = 1 + state.attendees.length; // organiser + attendees
  const overCapacity = selectedRoom != null && headcount > selectedRoom.capacity;

  const attendeeSet = new Set(state.attendees.map((a) => a.toLowerCase()));
  const staffOptions = staff.filter(
    (s) => s.toLowerCase() !== organizerEmail.toLowerCase() && !attendeeSet.has(s.toLowerCase())
  );

  const addAttendees = (emails: string[]) => {
    setState((s) => {
      const have = new Set(s.attendees.map((a) => a.toLowerCase()));
      const next = [...s.attendees];
      for (const e of emails) {
        const v = e.trim();
        if (v && !have.has(v.toLowerCase())) {
          have.add(v.toLowerCase());
          next.push(v);
        }
      }
      return { ...s, attendees: next };
    });
  };

  const removeAttendee = (email: string) =>
    setState((s) => ({ ...s, attendees: s.attendees.filter((a) => a !== email) }));

  const addExternal = () => {
    const emails = parseAttendees(externalInput);
    const bad = emails.find((e) => !isEmail(e));
    if (bad) {
      setErr(`"${bad}" is not a valid email address.`);
      return;
    }
    addAttendees(emails);
    setExternalInput('');
    setErr('');
  };

  const submit = async () => {
    setErr('');
    if (!state.title.trim()) return setErr('Please enter a meeting title.');
    if (new Date(state.end) <= new Date(state.start)) return setErr('End time must be after the start time.');
    if (overCapacity && selectedRoom) {
      return setErr(
        `${selectedRoom.name} seats ${selectedRoom.capacity}. Remove attendees or pick a larger room.`
      );
    }
    setSaving(true);
    const error = await onSubmit(state);
    setSaving(false);
    if (error) setErr(error);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit booking' : 'Book a room'}</h3>
        <p className="sub">{isEdit ? 'Update the details of your booking.' : 'Reserve a room for your meeting.'}</p>
        <div className="form-grid">
          <label className="field">
            Meeting title
            <input
              type="text"
              value={state.title}
              placeholder="e.g. Weekly team sync"
              autoFocus
              onChange={(e) => setState({ ...state, title: e.target.value })}
            />
          </label>
          <label className="field">
            Room
            <select value={state.roomId} onChange={(e) => setState({ ...state, roomId: Number(e.target.value) })}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (seats {r.capacity})
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              Start
              <input
                type="datetime-local"
                value={state.start}
                onChange={(e) => setState({ ...state, start: e.target.value })}
              />
            </label>
            <label className="field">
              End
              <input
                type="datetime-local"
                value={state.end}
                onChange={(e) => setState({ ...state, end: e.target.value })}
              />
            </label>
          </div>

          <div className="field">
            Attendees (optional)
            {state.attendees.length > 0 && (
              <div className="chips">
                {state.attendees.map((a) => {
                  const external = !staff.some((s) => s.toLowerCase() === a.toLowerCase());
                  return (
                    <span key={a} className={`chip-token${external ? ' external' : ''}`}>
                      {a}
                      {external && <span className="chip-tag">external</span>}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`Remove ${a}`}
                        onClick={() => removeAttendee(a)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addAttendees([e.target.value]);
              }}
            >
              <option value="">
                {staffOptions.length ? 'Add a staff member…' : 'All staff added'}
              </option>
              {staffOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="attendee-external">
              <input
                type="email"
                value={externalInput}
                placeholder="Add external guest by email"
                onChange={(e) => setExternalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addExternal();
                  }
                }}
              />
              <button type="button" className="btn" onClick={addExternal}>
                Add
              </button>
            </div>
            {selectedRoom && (
              <span className={`capacity-hint${overCapacity ? ' over' : ''}`}>
                {headcount} of {selectedRoom.capacity} seats used
                {overCapacity ? ' — over capacity' : ''}
              </span>
            )}
          </div>

          {!isEdit && (
            <div className="form-row">
              <label className="field">
                Repeat
                <select
                  value={state.repeat}
                  onChange={(e) => setState({ ...state, repeat: e.target.value as FormState['repeat'] })}
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </label>
              {state.repeat !== 'none' && (
                <label className="field">
                  Occurrences
                  <input
                    type="number"
                    min={2}
                    max={26}
                    value={state.repeatCount}
                    onChange={(e) =>
                      setState({
                        ...state,
                        repeatCount: Math.max(2, Math.min(26, Number(e.target.value) || 2)),
                      })
                    }
                  />
                </label>
              )}
            </div>
          )}

          {err && <div className="form-error">{err}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Book room'}
          </button>
        </div>
      </div>
    </div>
  );
}
