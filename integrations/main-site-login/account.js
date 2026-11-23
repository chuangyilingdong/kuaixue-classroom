// Only imported by the page hosted on the account origin.
export async function request(path, body, signal) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    ...(body && {headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '验证未完成，请重试。');
  return data;
}

export async function enterClass(token, signal) {
  if (!token || typeof token !== 'string') throw Error('登录未完成，请重试。');
  let data;
  try { data = await request('/kuaixue/desktop/authorize/complete', {token}, signal); }
  catch { throw Error('登录请求可能已过期，请点左上角返回后重新登录。'); }
  signal?.throwIfAborted();
  const target = new URL(data.redirect, location.origin);
  if (target.origin !== location.origin || target.pathname !== '/kuaixue/desktop/callback' || !target.searchParams.get('code') || !target.searchParams.get('state')) throw Error('无法返回课堂，请重新登录。');
  location.replace(target.href);
}
