import { NextResponse } from 'next/server';
import { staffDirectory } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/staff — the staff email directory for the attendee picker.
export function GET() {
  return NextResponse.json({ staff: staffDirectory() });
}
