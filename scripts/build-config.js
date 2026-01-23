/**
 * Build script: generates assets/config.js from environment variables.
 * Run during Vercel build to inject SUPABASE_URL and SUPABASE_ANON_KEY.
 *
 * Usage: node scripts/build-config.js
 *
 * Environment variables (set in Vercel dashboard):
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️  Warning: SUPABASE_URL or SUPABASE_ANON_KEY not set. Dashboard will not connect to Supabase.');
}

const configContent = `/**
 * Runtime configuration (auto-generated during build).
 * Do not edit manually — this file is overwritten on each deploy.
 */
window.SUPABASE_URL = "${supabaseUrl}";
window.SUPABASE_ANON_KEY = "${supabaseAnonKey}";
`;

const assetsDir = join(rootDir, 'assets');
mkdirSync(assetsDir, { recursive: true });

const configPath = join(assetsDir, 'config.js');
writeFileSync(configPath, configContent, 'utf8');

console.log(`✅ Generated ${configPath}`);
if (supabaseUrl && supabaseAnonKey) {
  console.log(`   SUPABASE_URL: ${supabaseUrl.substring(0, 30)}...`);
  console.log(`   SUPABASE_ANON_KEY: [set]`);
}
