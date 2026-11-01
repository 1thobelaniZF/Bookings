export interface Room {
  id: number;
  name: string;
  capacity: number;
  amenities: string; // comma-separated, e.g. "Projector, Whiteboard, VC"
}

export interface Booking {
  id: number;
  roomId: number;
  title: string;
  bookedByName: string;
  bookedByEmail: string;
  attendees: string[]; // staff emails invited to the meeting
  seriesId: string | null; // groups occurrences of a recurring booking
  startTime: string; // ISO 8601 UTC
  endTime: string; // ISO 8601 UTC
  createdAt: string; // ISO 8601 UTC
}

// A booking joined with its room, as returned to the client.
export interface BookingWithRoom extends Booking {
  roomName: string;
}

export interface NewBookingInput {
  roomId: number;
  title: string;
  bookedByName: string;
  bookedByEmail: string;
  attendees: string[];
  startTime: string;
  endTime: string;
}

// Recurrence for creating several occurrences at once.
export type RepeatFrequency = 'none' | 'daily' | 'weekly';

export interface Recurrence {
  frequency: RepeatFrequency;
  count: number; // total occurrences including the first (1 = no repeat)
}
