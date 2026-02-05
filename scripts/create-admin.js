/**
 * Create admin user in Supabase Auth.
 * Run this ONCE to set up the admin account.
 * 
 * Usage:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/create-admin.js
 * 
 * Or set in .env.local and run:
 *   node --env-file=.env.local scripts/create-admin.js
 */

import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'admin@ubolt.com';
const ADMIN_PASSWORD = 'admin1234';

async function createAdminUser() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing environment variables:');
    console.error('   SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓' : '✗');
    console.error('\nUsage:');
    console.error('  SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/create-admin.js');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log('🔐 Creating admin user...\n');
  console.log('   Email:', ADMIN_EMAIL);
  console.log('   Password:', ADMIN_PASSWORD);

  try {
    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === ADMIN_EMAIL);

    if (existingUser) {
      console.log('\n⚠️  User already exists with ID:', existingUser.id);
      console.log('   Updating password...');

      // Update password for existing user
      const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { role: 'admin' }
      });

      if (error) {
        throw error;
      }

      console.log('\n✅ Admin user updated successfully!');
      console.log('   User ID:', data.user.id);
    } else {
      // Create new user
      const { data, error } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { role: 'admin' }
      });

      if (error) {
        throw error;
      }

      console.log('\n✅ Admin user created successfully!');
      console.log('   User ID:', data.user.id);
    }

    console.log('\n📋 Login credentials:');
    console.log('   Email:', ADMIN_EMAIL);
    console.log('   Password:', ADMIN_PASSWORD);
    console.log('\n🔗 Login at: https://your-domain.vercel.app/login.html');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('service_role')) {
      console.error('\n   Make sure you are using the SERVICE_ROLE key, not the anon key.');
    }
    process.exit(1);
  }
}

createAdminUser();
