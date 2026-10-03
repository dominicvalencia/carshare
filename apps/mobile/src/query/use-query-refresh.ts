import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { AppState, type AppStateStatus } from 'react-native';

export function useRefreshOnFocusAndForeground(refresh: () => void) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      latest.current();
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current();
    });
    return () => subscription.remove();
  }, []);
}

export function useFocusedPollingInterval(intervalMs: number, enabled = true): number | false {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  return enabled && isFocused && appState === 'active' ? intervalMs : false;
}
