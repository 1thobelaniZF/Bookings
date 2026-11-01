import { NextRequest, NextResponse } from 'next/server';
import { deleteRoom, isValidationError, updateRoom } from '@/lib/bookings';
import { isAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT /api/rooms/:id  — edit a room (admin only).
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const roomId = Number(id);
  if (!Number.isInteger(roomId)) {
    return NextResponse.json({ error: 'Invalid room id.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!isAdmin(String(body.requesterEmail ?? ''))) {
    return NextResponse.json({ error: 'Only admins can manage rooms.' }, { status: 403 });
  }

  const result = await updateRoom(roomId, {
    name: String(body.name ?? ''),
    capacity: Number(body.capacity),
    amenities: String(body.amenities ?? ''),
  });
  if (isValidationError(result)) {
    const status = result.error === 'Room not found.' ? 404 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ room: result });
}

// DELETE /api/rooms/:id?email=  — remove a room (admin only).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const roomId = Number(id);
  if (!Number.isInteger(roomId)) {
    return NextResponse.json({ error: 'Invalid room id.' }, { status: 400 });
  }

  const email = req.nextUrl.searchParams.get('email') ?? '';
  if (!isAdmin(email)) {
    return NextResponse.json({ error: 'Only admins can manage rooms.' }, { status: 403 });
  }

  const result = await deleteRoom(roomId);
  if (isValidationError(result)) {
    const status = result.error === 'Room not found.' ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: true });
}
