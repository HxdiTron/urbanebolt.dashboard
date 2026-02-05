/**
 * Authentication guard for dashboard pages.
 * Include this script on all protected pages AFTER supabase-runtime.js
 * 
 * Usage: Add to <head>:
 *   <script src="assets/auth-guard.js"></script>
 * 
 * This will:
 * 1. Check if user is authenticated
 * 2. Redirect to login.html if not
 * 3. Expose user info via window.currentUser
 * 4. Add logout functionality
 */

(function authGuard() {
  'use strict';

  const LOGIN_PAGE = 'login.html';
  const CHECK_INTERVAL = 60000; // Check session every 60 seconds

  /**
   * Get the Supabase client
   */
  function getClient() {
    return window.supabaseClient || null;
  }

  /**
   * Redirect to login page
   */
  function redirectToLogin() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if (currentPage !== LOGIN_PAGE) {
      window.location.href = LOGIN_PAGE;
    }
  }

  /**
   * Check if user is authenticated
   */
  async function checkAuth() {
    const client = getClient();
    
    if (!client) {
      console.warn('[AuthGuard] Supabase client not available');
      // Allow page to load but show warning
      return null;
    }

    try {
      const { data: { session }, error } = await client.auth.getSession();
      
      if (error) {
        console.error('[AuthGuard] Session error:', error);
        redirectToLogin();
        return null;
      }

      if (!session) {
        console.log('[AuthGuard] No active session, redirecting to login');
        redirectToLogin();
        return null;
      }

      // Store user info globally
      window.currentUser = {
        id: session.user.id,
        email: session.user.email,
        role: session.user.user_metadata?.role || 'user',
        session: session,
      };

      console.log('[AuthGuard] Authenticated as:', session.user.email);
      return session;
    } catch (err) {
      console.error('[AuthGuard] Auth check failed:', err);
      redirectToLogin();
      return null;
    }
  }

  /**
   * Sign out the current user
   */
  async function signOut() {
    const client = getClient();
    if (!client) {
      redirectToLogin();
      return;
    }

    try {
      await client.auth.signOut();
    } catch (err) {
      console.error('[AuthGuard] Sign out error:', err);
    }
    
    window.currentUser = null;
    redirectToLogin();
  }

  /**
   * Listen for auth state changes
   */
  function setupAuthListener() {
    const client = getClient();
    if (!client) return;

    client.auth.onAuthStateChange((event, session) => {
      console.log('[AuthGuard] Auth state changed:', event);
      
      if (event === 'SIGNED_OUT' || !session) {
        window.currentUser = null;
        redirectToLogin();
      } else if (event === 'SIGNED_IN' && session) {
        window.currentUser = {
          id: session.user.id,
          email: session.user.email,
          role: session.user.user_metadata?.role || 'user',
          session: session,
        };
      }
    });
  }

  /**
   * Update UI elements with user info
   */
  function updateUserUI() {
    // Update any elements showing user email
    const emailElements = document.querySelectorAll('[data-user-email]');
    emailElements.forEach(el => {
      el.textContent = window.currentUser?.email || 'User';
    });

    // Setup logout buttons
    const logoutButtons = document.querySelectorAll('[data-logout]');
    logoutButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        signOut();
      });
    });
  }

  /**
   * Initialize auth guard
   */
  async function init() {
    // Wait for Supabase to be ready
    if (!window.supabaseClient) {
      // Retry after a short delay
      setTimeout(init, 100);
      return;
    }

    const session = await checkAuth();
    
    if (session) {
      setupAuthListener();
      
      // Update UI after DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateUserUI);
      } else {
        updateUserUI();
      }

      // Periodic session check
      setInterval(async () => {
        const client = getClient();
        if (client) {
          const { data: { session } } = await client.auth.getSession();
          if (!session) {
            redirectToLogin();
          }
        }
      }, CHECK_INTERVAL);
    }
  }

  // Expose signOut globally
  window.authSignOut = signOut;

  // Start auth check
  init();
})();
