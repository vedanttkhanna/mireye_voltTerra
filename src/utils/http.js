function errorDetail(body) {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.error === 'string') return body.error;
  if (typeof body?.message === 'string') return body.message;
  return null;
}

/**
 * Reads an API response without assuming every host returns JSON on errors.
 * Vercel and upstream providers can return plain-text or HTML error pages;
 * surfacing the URL, status and a short preview makes those failures
 * actionable instead of showing "Unexpected token ... is not valid JSON".
 */
export async function readJsonResponse(response, label = 'API request') {
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 180);
      throw new Error(
        `${label} returned ${response.status} ${response.statusText || ''} as non-JSON` +
          (preview ? `: ${preview}` : '')
      );
    }
  }

  if (!response.ok) {
    throw new Error(errorDetail(body) || `${label} returned ${response.status} ${response.statusText}`);
  }

  return body;
}
