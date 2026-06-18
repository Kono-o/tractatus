import type { User as SupabaseUser } from '@supabase/supabase-js';

export const auth = $state<{
  currentUser: SupabaseUser | null;
  isAuthLoading: boolean;
  isLoading: boolean;
  hasInitialLoad: boolean;
  avatarSeed: string | null;
  avatarUrl: string | null;
  showUserIcon: boolean;
  showAvatar: boolean;
}>({
  currentUser: null,
  isAuthLoading: true,
  isLoading: false,
  hasInitialLoad: false,
  avatarSeed: null,
  avatarUrl: null,
  showUserIcon: true,
  showAvatar: false,
});
