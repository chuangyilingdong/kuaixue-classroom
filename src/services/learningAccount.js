import { previewAccount, readAccount, parseGrantList } from '../data/account.js';

const apiBase = (import.meta.env?.VITE_KUAIXUE_API_BASE_URL || '').replace(/\/+$/, '');
export const offlinePreview = !apiBase;

export const localWorkshop = offlinePreview && globalThis.location?.protocol === 'file:' && globalThis.kuaixueDesktop?.workshop;

export async function loadLearningAccount({ base = apiBase, signal, fetchImpl = fetch } = {}) {
  if (!base && localWorkshop) return localWorkshop.account();
  if (!base) return { ...previewAccount(), demo: true };
  // The session cookie is established by the agreed login handoff in staging.
  const options = { credentials: 'include', cache: 'no-store', signal, redirect: 'error' };
  let response = await fetchImpl(`${base}/api/v1/me`, options);
  let entitlementsOnly = false;
  if (response.status === 502) {
    const problem = await response.json().catch(() => null);
    if (problem?.error?.code === 'WALLET_UNAVAILABLE') {
      response = await fetchImpl(`${base}/api/v1/me/entitlements`, options);
      entitlementsOnly = true;
    }
  }
  if (response.status === 401) throw new Error('需要有效的快学登录会话，请完成平台授权后重试。');
  if (!response.ok) throw new Error('账户服务暂不可用，请稍后重试。');
  const { data } = await response.json();
  if (!data || !Array.isArray(data.entitlements)) throw new Error('账户数据格式异常。');
  if (entitlementsOnly) return { user: null, points: null, entitlements: parseGrantList(data.entitlements), demo: false };
  return { ...readAccount({ id: data.user?.id, username: data.user?.name }, { total: data.points }, data.entitlements.map(g => ({ ...g, userId: data.user?.id }))), demo: false };
}
