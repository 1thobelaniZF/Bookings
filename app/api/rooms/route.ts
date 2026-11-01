import { NextRequest, NextResponse } from 'next/server';
import { createRoom, getRooms, isValidationError } from '@/lib/bookings';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/rooms?email=  — list rooms; reports whether the caller is an admin.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  const rooms = await getRooms();
  return NextResponse.json({ rooms, isAdmin: isAdmin(email) });
}

// POST /api/rooms  — create a room (admin only).
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!isAdmin(String(body.requesterEmail ?? ''))) {
    return NextResponse.json({ error: 'Only admins can manage rooms.' }, { status: 403 });
  }

  const result = await createRoom({
    name: String(body.name ?? ''),
    capacity: Number(body.capacity),
    amenities: String(body.amenities ?? ''),
  });
  if (isValidationError(result)) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ room: result }, { status: 201 });
}
