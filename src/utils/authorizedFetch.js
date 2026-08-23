const STORAGE_KEY = 'volt-terra-operation-key';

function requestOperationKey() {
  let key = window.sessionStorage.getItem(STORAGE_KEY) || '';
  if (!key) {
    key = window.prompt('Enter the VOLT-TERRA operation key for this protected action:')?.trim() || '';
    if (key) window.sessionStorage.setItem(STORAGE_KEY, key);
  }
  return key;
}

/** Add the operator credential without embedding it in the client bundle. */
export async function authorizedFetch(path, init = {}) {
  const run = (key) => fetch(path, {
    ...init,
    headers: { ...init.headers, ...(key ? { 'X-Operation-Key': key } : {}) },
  });

  let key = requestOperationKey();
  let response = await run(key);
  if (response.status === 401) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    key = requestOperationKey();
    if (key) response = await run(key);
  }
  return response;
}
