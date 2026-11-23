require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  const { data, error } = await supabase.rpc('get_policies');
  if (error) {
    console.log("RPC failed, trying raw query via another method if possible.");
    // We can't run raw SQL from supabase-js client directly without RPC.
    return;
  }
  console.log(data);
}
run();
