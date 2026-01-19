/**
 * Auth + authorization guard:
 * - Uses Supabase Auth for sign-in.
 * - Requires an entry in the `users` table (authorization list).
 *
 * Expected `users` table has one of these identifiers:
 * - auth_user_id (preferred) == session.user.id
 * - id == session.user.id
 * - email == session.user.email
 */

(function authHelpers() {
  /**
   * @param {string} s
   */
  function safePath(s) {
    // Prevent open redirects: allow only same-site relative paths.
    if (!s) return "index.html";
    if (s.startsWith("http://") || s.startsWith("https://")) return "index.html";
    if (s.startsWith("//")) return "index.html";
    if (s.startsWith("\\")) return "index.html";
    // Normalize: strip origin if present (defensive).
    try {
      const u = new URL(s, window.location.origin);
      if (u.origin !== window.location.origin) return "index.html";
      return u.pathname.replace(/^\/+/, "") + u.search + u.hash;
    } catch {
      return "index.html";
    }
  }

  /**
   * @returns {string}
   */
  function getNextFromQuery() {
    const u = new URL(window.location.href);
    return safePath(u.searchParams.get("next") || "");
  }

  /**
   * @returns {string}
   */
  function currentRelativePathWithQuery() {
    const p = window.location.pathname.split("/").pop() || "index.html";
    return safePath(p + window.location.search + window.location.hash);
  }

  function redirectToLogin() {
    const next = encodeURIComponent(currentRelativePathWithQuery());
    window.location.replace(`login.html?next=${next}`);
  }

  /**
   * @param {any} err
   */
  function isMissingColumnError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("does not exist") && msg.includes("column");
  }

  /**
   * @param {any} client
   * @param {string} column
   * @param {string} value
   */
  async function tryUserLookup(client, column, value) {
    if (!value) return { data: null, error: null };
    const res = await client.from("users").select("*").eq(column, value).limit(1).maybeSingle();
    return res;
  }

  /**
   * @param {any} row
   */
  function isUserActive(row) {
    if (!row) return false;
    // Common patterns: disabled/is_active/active/status
    if (typeof row.disabled === "boolean") return row.disabled === false;
    if (typeof row.is_active === "boolean") return row.is_active === true;
    if (typeof row.active === "boolean") return row.active === true;
    if (typeof row.status === "string") {
      const s = row.status.toLowerCase();
      if (["active", "enabled", "approved", "ok"].includes(s)) return true;
      if (["disabled", "inactive", "blocked", "banned"].includes(s)) return false;
    }
    // Default: presence in table implies allowed.
    return true;
  }

  /**
   * Ensures the authenticated user is authorized via `users` table.
   * @param {{ id?: string, email?: string | null }} user
   */
  async function ensureAuthorizedUser(user) {
    const client = window.__getSupabaseClient?.();
    if (!client) throw new Error("Supabase client not available.");

    // Try auth_user_id -> id -> email (handle schema variations).
    const attempts = [
      { column: "auth_user_id", value: String(user?.id || "") },
      { column: "id", value: String(user?.id || "") },
      { column: "email", value: String(user?.email || "") },
    ].filter(a => a.value);

    let lastError = null;
    for (const a of attempts) {
      try {
        const { data, error } = await tryUserLookup(client, a.column, a.value);
        if (error) {
          // If column doesn't exist, try the next identifier.
          if (isMissingColumnError(error)) continue;
          lastError = error;
          continue;
        }
        if (data && isUserActive(data)) return data;
      } catch (e) {
        lastError = e;
      }
    }

    if (lastError) {
      console.error("Authorization lookup failed:", lastError);
    }
    throw new Error("Not authorized. Your account is not enabled for this dashboard.");
  }

  /**
   * Page guard: requires Supabase session + authorized user.
   * @param {{ onReady?: (ctx: { session: any, profile: any }) => void | Promise<void> }} [opts]
   */
  async function requireAuth(opts) {
    const client = window.__getSupabaseClient?.();
    if (!client) {
      // No supabase => can't auth; fail closed.
      redirectToLogin();
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      console.error("getSession error:", error);
      redirectToLogin();
      return;
    }

    const session = data?.session || null;
    if (!session?.user) {
      redirectToLogin();
      return;
    }

    try {
      const profile = await ensureAuthorizedUser(session.user);
      if (typeof opts?.onReady === "function") {
        await opts.onReady({ session, profile });
      }
    } catch (e) {
      console.error(e);
      await client.auth.signOut();
      // Bounce to login with a safe error marker (displayed by login page).
      const next = encodeURIComponent(currentRelativePathWithQuery());
      window.location.replace(`login.html?next=${next}&error=unauthorized`);
    }
  }

  /**
   * Sign out and return to login.
   */
  async function logout() {
    const client = window.__getSupabaseClient?.();
    if (client) {
      await client.auth.signOut();
    }
    window.location.replace("login.html");
  }

  window.DashboardAuth = {
    safePath,
    getNextFromQuery,
    redirectToLogin,
    requireAuth,
    ensureAuthorizedUser,
    logout,
  };
})();

