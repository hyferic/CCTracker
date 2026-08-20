import { useCallback, useEffect, useState, type DependencyList } from 'react';

export function useAsync<T>(loader: () => Promise<T>, dependencies: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void loader()
      .then((value) => {
        if (live) setData(value);
      })
      .catch((caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught : new Error('Unexpected error'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // Loader ownership stays with the calling component; dependencies explicitly control refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, refreshKey]);

  return { data, error, loading, refresh };
}
