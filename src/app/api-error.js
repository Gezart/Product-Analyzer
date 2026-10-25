/** An Error with the API's `{ error }` message (or the status when there is none), for a failed response. */
export async function apiError(res) {
  const body = await res.json().catch(() => null);
  return new Error(body?.error ?? `Failed (${res.status})`);
}
