import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Room Booking · Zenex Foundation',
  description: 'Book boardrooms and meeting rooms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
