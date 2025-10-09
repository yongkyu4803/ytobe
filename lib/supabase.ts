import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL과 Key가 환경 변수에 설정되어 있지 않습니다.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
  global: {
    headers: {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
  },
});
