const STORAGE_KEY = 'volt-terra-operator-key';

function getOperatorKey() {
  let key = window.sessionStorage.getItem(STORAGE_KEY);
  if (!key) {
    key = window.prompt('Enter the VOLT-TERRA operator key to authorize this metered or mutating action:')?.trim();
    if (key) window.sessionStorage.setItem(STORAGE_KEY, key);
  }
  return key;
}

export async function operatorFetch(path, options = {}) {
  const key = getOperatorKey();
  if (!key) throw new Error('Operator authorization was cancelled.');
  const response = await fetch(path, {
    ...options,
    headers: { ...options.headers, 'X-Volt-Terra-Key': key },
  });
  if (response.status === 401) window.sessionStorage.removeItem(STORAGE_KEY);
  return response;
}
