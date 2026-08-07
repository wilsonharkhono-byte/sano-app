import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../../tools/supabase';

export function useUnreadCount(profileId: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profileId) { setCount(0); return; }

    let alive = true;
    const refresh = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', profileId)
        .is('read_at', null);
      if (alive) setCount(c ?? 0);
    };
    void refresh();

    const channel = supabase.channel(`unread:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${profileId}` },
        () => { void refresh(); },
      )
      .subscribe();

    // Self-heal on foreground: realtime channels can silently stop
    // delivering events after the app backgrounds on a flaky connection
    // (socket dies, no reconnect fires). Refreshing whenever the app
    // becomes active re-reads the true server count independent of
    // whether the realtime channel above is still healthy.
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') { void refresh(); }
    });

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
      appStateSub.remove();
    };
  }, [profileId]);

  return count;
}
