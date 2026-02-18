export async function onRequestGet(context) {
  const { env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || "";
  const SUPABASE_ANON = env.SUPABASE_ANON || "";

  if(!SUPABASE_URL || !SUPABASE_ANON){
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { "content-type":"application/json", "cache-control":"no-store" }
    });
  }

  return new Response(JSON.stringify({ SUPABASE_URL, SUPABASE_ANON }), {
    status: 200,
    headers: { "content-type":"application/json", "cache-control":"no-store" }
  });
}
