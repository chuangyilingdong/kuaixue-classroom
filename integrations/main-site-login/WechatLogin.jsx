import React, { useLayoutEffect, useRef, useState } from 'react';
import { request } from './account.js';

const expired = '二维码已过期，请刷新后重新扫码。';

export default function WechatLogin({ agreed, onToken, bindPhone }) {
  if (!agreed) return <div className="kx-scan"><p role="status">请先勾选下方协议，二维码会自动显示。</p></div>;
  return <ConsentedScan onToken={onToken} bindPhone={bindPhone} />;
}

function ConsentedScan({ onToken, bindPhone }) {
  const [attempt, setAttempt] = useState(0);
  const [widget, setWidget] = useState('');
  const [error, setError] = useState('');
  const [entering, setEntering] = useState(false);
  const current = useRef({ onToken, bindPhone });
  useLayoutEffect(() => { current.current = { onToken, bindPhone }; }, [onToken, bindPhone]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function scan() {
      setError(''); setWidget(''); setEntering(false);
      const {sessionId, qrUrl, expiresAt} = await request('/api/auth/wechat/desktop-session?ui=kx-class-v1', null, signal);
      const url = new URL(qrUrl);
      if (!/^[a-f0-9]{32}$/i.test(sessionId) || url.origin !== 'https://open.weixin.qq.com' || url.pathname !== '/connect/qrconnect' || url.username || url.password || url.searchParams.get('state') !== sessionId) throw Error('微信登录码不可用，请重试。');
      const deadline = Math.min(Date.parse(expiresAt), Date.now() + 300000);
      // qrconnect serves the desktop widget. WeChat issues and updates the scannable code inside it.
      url.hash = '';
      url.searchParams.set('login_type', 'jssdk');
      url.searchParams.set('self_redirect', 'true');
      url.searchParams.set('stylelite', '1');
      url.searchParams.set('fast_login', '0');
      url.searchParams.set('color_scheme', 'dark');
      signal.throwIfAborted();
      if (!(Date.now() < deadline)) throw Error(expired);
      setWidget(url.href);
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const result = await request('/api/auth/wechat/poll/' + sessionId, null, signal);
        signal.throwIfAborted();
        if (Date.now() >= deadline || result.status === 'expired') throw Error(expired);
        if (result.status !== 'pending') {
          setWidget('');
          if (result.status === 'wechat_pending' && result.pendingToken) { current.current.bindPhone(result.pendingToken); return; }
          if (!['authorized','ok'].includes(result.status)) throw Error('微信登录未完成，请重新扫码。');
          setEntering(true); await current.current.onToken(result.token, signal); return;
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(1800, deadline - Date.now())));
      }
      throw Error(expired);
    }
    scan().catch(problem => {
      if (!signal.aborted) { setWidget(''); setEntering(false); setError(problem.message || '微信登录失败，请重试。'); }
    });
    return () => controller.abort();
  }, [attempt]);

  return <div className="kx-scan"><div className="kx-code-frame">
    {error ? <button type="button" className="kx-code-action" onClick={() => setAttempt(value => value + 1)}>刷新二维码</button> : widget ?
      <iframe key={widget} title="微信官方登录二维码" src={widget} scrolling="no" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" /> : <span className="kx-code-action" role="status">{entering ? '已确认，正在进入课堂…' : '正在加载二维码…'}</span>}
    </div>{widget && <button type="button" className="kx-reload" onClick={() => setAttempt(value => value + 1)}>刷新二维码</button>}
    <small role="status">{error || (!entering && '在手机上确认后自动进入课堂')}</small></div>;
}
