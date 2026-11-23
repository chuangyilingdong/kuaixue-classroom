import { readAccount, readEntitlements } from '../../src/data/account.js';

// identity resolves the Kuaixue session and returns a server-side main-site token.
// listGrants is scoped to the subject. The mapper checks ownership again.
export class WalletUnavailable extends Error {}

export function createAccountReader({ identity, mainSite, listGrants, fetchImpl = fetch }) {
  const base = new URL(mainSite);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname))) throw new Error('Invalid account service origin');
  async function read(path, token) {
    const response = await fetchImpl(new URL(path, base), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Main-site read failed');
    return response.json();
  }
  return async function account(session, { entitlementsOnly = false } = {}) {
    const principal = await identity(session);
    if (!principal) return null;
    if (!principal.userId || !principal.mainSiteToken) throw new Error('Invalid identity mapping');
    const [profile, grants] = await Promise.all([
      read('/api/auth/me', principal.mainSiteToken), listGrants(principal.userId),
    ]);
    if (profile.id !== principal.userId) throw new Error('Identity mismatch');
    if (entitlementsOnly) return { entitlements: readEntitlements(principal.userId, grants) };
    let wallet;
    try {
      wallet = await read('/api/points/wallet', principal.mainSiteToken);
    } catch {
      throw new WalletUnavailable('Wallet temporarily unavailable');
    }
    return readAccount(profile, wallet, grants);
  };
}
