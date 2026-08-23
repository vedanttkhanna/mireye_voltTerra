import { useCallback, useEffect, useState } from 'react';
import { authorizedFetch } from '../utils/authorizedFetch.js';

/** Fetches a GET endpoint on mount and exposes a manual refetch. */
export function useApi(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, error, loading, refetch };
}

/** POSTs to an endpoint on demand; caller controls when it fires. */
export function usePostAction(path) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch(path, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
      return body;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [path]);

  return { run, loading, error };
}

/** POSTs a JSON body to an endpoint on demand; caller passes the body at call time. */
export function usePostJson(path) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (payload) => {
      setLoading(true);
      setError(null);
      try {
        const res = await authorizedFetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
        return body;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [path]
  );

  return { run, loading, error };
}
