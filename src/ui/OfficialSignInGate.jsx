import { useEffect, useState } from 'react';
import { loadLearningAccount } from '../services/learningAccount.js';
import logo from '../assets/login/kx-class.webp';
import LoginMedia from './LoginMedia.jsx';
import { ArrowLeft } from './icons.jsx';
import './login.css';

export default function OfficialSignInGate({ onSignedIn }) {
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState('loading');
  const [message, setMessage] = useState('正在打开登录页…');
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const verify = () => loadLearningAccount({signal:AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
    async function start() {
      try {
        let account;
        try { account = await verify(); }
        catch (error) {
          if (!current || error.status !== 401) throw error;
          setStage('signing');
          const result = await window.kuaixueDesktop.login();
          if (!current) return;
          if (result?.cancelled) { setMessage('已取消登录。'); setStage('retry'); return; }
          account = await verify();
        }
        if (account?.demo !== false) throw Error('无有效快学会话');
        if (current) onSignedIn(account);
      } catch (error) {
        if (!current) return;
        setMessage(error.message?.includes('主站尚未提供') ? '新版登录页尚未在主站启用，请稍后重试。' : '无法连接登录服务，请检查网络后重试。');
        setStage('retry');
      }
    }
    window.kuaixueDesktop?.setTheme?.('light');
    setMessage('正在打开登录页…'); setStage('loading'); void start();
    return () => { current = false; controller.abort(); };
  }, [attempt, onSignedIn]);
  return <main className="kx-login"><div className="kx-drag" />
    {stage === 'signing' && <button className="kx-back" type="button" onClick={() => window.kuaixueDesktop.cancelLogin()}><ArrowLeft size={15} />返回</button>}
    <div className="kx-login-page"><LoginMedia /><div className="kx-column"><img className="kx-logo" src={logo} alt="KX CLASS" /><h1>登录 KX CLASS</h1>
      <p className="kx-status" role="status">{message}</p>
      {stage === 'retry' && <button className="kx-submit" onClick={() => setAttempt(value => value + 1)}>重新登录</button>}
    </div><footer>© 2026 KX CLASS</footer></div></main>;
}
