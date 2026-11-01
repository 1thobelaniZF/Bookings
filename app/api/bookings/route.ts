import { NextRequest, NextResponse } from 'next/server';
import { createBookings, getBookings, isValidationError } from '@/lib/bookings';
import type { Recurrence, RepeatFrequency } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/bookings?roomId=&from=&to=&email=
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const roomIdParam = sp.get('roomId');
  const bookings = await getBookings({
    roomId: roomIdParam ? Number(roomIdParam) : undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    email: sp.get('email') ?? undefined,
  });
  return NextResponse.json({ bookings });
}

function parseRecurrence(raw: unknown): Recurrence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { frequency?: unknown; count?: unknown };
  const freq = r.frequency as RepeatFrequency;
  if (freq !== 'daily' && freq !== 'weekly') return undefined;
  const count = Math.max(1, Math.min(26, Number(r.count) || 1));
  return { frequency: freq, count };
}

// POST /api/bookings
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const attendees = Array.isArray(body.attendees)
    ? (body.attendees as unknown[]).map((a) => String(a))
    : [];

  const result = await createBookings(
    {
      roomId: Number(body.roomId),
      title: String(body.title ?? ''),
      bookedByName: String(body.bookedByName ?? ''),
      bookedByEmail: String(body.bookedByEmail ?? ''),
      attendees,
      startTime: String(body.startTime ?? ''),
      endTime: String(body.endTime ?? ''),
    },
    parseRecurrence(body.recurrence)
  );

  if (isValidationError(result)) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json({ bookings: result, count: result.length }, { status: 201 });
}
