// Scheduled daily (see netlify.toml) to keep the Supabase free-tier project
// from auto-pausing after 7 days of API inactivity. A plain GET against the
// PostgREST root counts as real API traffic without needing any table to exist.
export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error('keep-alive: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    return { statusCode: 500 };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: { apikey: anonKey },
    });
    console.log(`keep-alive: Supabase REST ping responded ${res.status}`);
    return { statusCode: 200 };
  } catch (err) {
    console.error('keep-alive: ping failed:', (err as Error).message);
    return { statusCode: 500 };
  }
};
