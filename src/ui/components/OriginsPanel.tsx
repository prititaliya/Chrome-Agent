import { useEffect, useState } from "react";
import { getAllowedOrigins, getDeniedOrigins, setOriginConsent } from "../../../src/security/origins";

// Visible, revocable per-origin consent. Revoking mid-run blocks the next
// dispatched action with E_NO_ORIGIN_PERMISSION (no crash, run pauses).
export default function OriginsPanel() {
  const [allowed, setAllowed] = useState<string[]>([]);
  const [denied, setDenied] = useState<string[]>([]);

  async function refresh() {
    setAllowed(await getAllowedOrigins());
    setDenied(await getDeniedOrigins());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function revoke(origin: string) {
    await setOriginConsent(origin, false);
    await refresh();
  }

  async function reallow(origin: string) {
    await setOriginConsent(origin, true);
    await refresh();
  }

  return (
    <section>
      <h2>Page access</h2>
      <h3>Allowed origins</h3>
      {allowed.length === 0 && <p>None yet. The first agent run on a site asks for access.</p>}
      <ul>
        {allowed.map((origin) => (
          <li key={origin}>
            {origin} <button onClick={() => void revoke(origin)}>Revoke</button>
          </li>
        ))}
      </ul>
      {denied.length > 0 && (
        <>
          <h3>Denied origins</h3>
          <ul>
            {denied.map((origin) => (
              <li key={origin}>
                {origin} <button onClick={() => void reallow(origin)}>Allow</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
