import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL; // https://xxxx.supabase.co
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLL_KEY; // common typo support
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // e.g. admin@yourco.com
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // set a strong password

function fail(message) {
  console.error(message);
  process.exit(1);
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  fail(
    [
      "Missing env vars.",
      "Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD",
      "Example:",
      '  SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \\',
      '  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \\',
      '  ADMIN_EMAIL="admin@yourco.com" \\',
      '  ADMIN_PASSWORD="Use-A-Strong-Password" \\',
      "  node create-admin.js",
    ].join("\n")
  );
}

const keyPayload = decodeJwtPayload(SUPABASE_SERVICE_ROLE_KEY);
if (keyPayload?.role && keyPayload.role !== "service_role") {
  fail(
    `Refusing to run: provided key role is "${keyPayload.role}". You must use the Supabase service_role key (server-side only).`
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function findUserIdByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => String(u.email || "").toLowerCase() === target);
    if (hit?.id) return hit.id;
    if (users.length < 1000) break; // no more pages
  }
  return null;
}

let authUserId = null;

const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
  email_confirm: true,
});

if (!createErr && created?.user?.id) {
  authUserId = created.user.id;
} else {
  // If user already exists, fetch and set password.
  const existingId = await findUserIdByEmail(ADMIN_EMAIL);
  if (!existingId) {
    console.error("Create user error:", createErr);
    fail("Could not create admin user and could not find an existing user by email.");
  }
  authUserId = existingId;
  const { error: updateErr } = await supabase.auth.admin.updateUserById(authUserId, {
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });
  if (updateErr) throw updateErr;
}

const { error: upsertErr } = await supabase
  .from("users")
  .upsert(
    {
      auth_user_id: authUserId,
      email: ADMIN_EMAIL,
      role: "admin",
      is_active: true,
    },
    { onConflict: "auth_user_id" }
  );

if (upsertErr) throw upsertErr;

console.log("Admin ready:", { auth_user_id: authUserId, email: ADMIN_EMAIL, role: "admin", is_active: true });