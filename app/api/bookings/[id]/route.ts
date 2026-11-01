import { NextRequest, NextResponse } from 'next/server';
import { deleteBooking, isValidationError, updateBooking } from '@/lib/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT /api/bookings/:id  — edit a booking (requester must own it)
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const requesterEmail = String(body.bookedByEmail ?? '');
  const attendees = Array.isArray(body.attendees)
    ? (body.attendees as unknown[]).map((a) => String(a))
    : [];
  const result = await updateBooking(
    bookingId,
    {
      roomId: Number(body.roomId),
      title: String(body.title ?? ''),
      bookedByName: String(body.bookedByName ?? ''),
      bookedByEmail: requesterEmail,
      attendees,
      startTime: String(body.startTime ?? ''),
      endTime: String(body.endTime ?? ''),
    },
    requesterEmail
  );

  if (isValidationError(result)) {
    const status = result.error === 'Booking not found.' ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ booking: result });
}

// DELETE /api/bookings/:id?email=  — cancel a booking (requester must own it)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 });
  }

  const email = req.nextUrl.searchParams.get('email') ?? '';
  const result = await deleteBooking(bookingId, email);

  if (isValidationError(result)) {
    const status = result.error === 'Booking not found.' ? 404 : 403;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: true });
}
