import postgres from 'postgres';

// Single shared Postgres client for the process. Next.js may re-evaluate modules
// during dev HMR and Vercel keeps warm serverless instances, so cache the client
// on globalThis to avoid opening a new connection on every request.

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function createClient(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Point it at your Supabase Postgres connection ' +
        'string (use the Transaction pooler URL on port 6543). See .env.example.'
    );
  }

  return postgres(url, {
    // Supabase's transaction-mode pooler (port 6543) does not support prepared
    // statements, so disable them. Safe to keep on for the direct connection too.
    prepare: false,
    // A few connections so one stalled query can't wedge every request. The
    // Supabase pooler multiplexes these across shared server connections.
    max: 5,
    // Recycle connections so the pooler silently dropping an idle one can't
    // leave us holding a dead socket that hangs forever.
    idle_timeout: 20,
    max_lifetime: 60 * 10,
    connect_timeout: 10,
  });
}

export function getSql(): ReturnType<typeof postgres> {
  if (!global.__sql) {
    global.__sql = createClient();
  }
  return global.__sql;
}
