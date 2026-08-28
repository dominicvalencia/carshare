import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { AppState } from 'react-native';

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
