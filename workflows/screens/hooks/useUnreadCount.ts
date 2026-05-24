import { useEffect, useState } from 'react';
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

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  return count;
}
