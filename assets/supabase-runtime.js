/**
 * Minimal Supabase client bootstrapper.
 * Reads URL/key from <meta name="supabase-url"> and <meta name="supabase-anon-key">.
 *
 * This is safe to ship with the anon/public key. Never ship sb_secret_* keys to browsers.
 */

(function initSupabaseRuntime() {
  function readMeta(name) {
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || "";
  }

  const url = String(window.SUPABASE_URL || readMeta("supabase-url") || "").trim();
  const anonKey = String(window.SUPABASE_ANON_KEY || readMeta("supabase-anon-key") || "").trim();

  // Export helper for pages that want a hard error.
  window.__getSupabaseClient = function __getSupabaseClient() {
    if (!window.supabaseClient) {
      throw new Error("Supabase client is not initialized.");
    }
    return window.supabaseClient;
  };

  if (!url || !anonKey) return;

  if (anonKey.startsWith("sb_secret_")) {
    console.error("Supabase misconfiguration: secret API key detected. Use the anon/public key in the browser.");
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("Supabase JS library not loaded. Ensure @supabase/supabase-js is included before this script.");
    return;
  }

  // Initialize only once.
  if (window.supabaseClient) return;

  window.supabaseClient = window.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();

