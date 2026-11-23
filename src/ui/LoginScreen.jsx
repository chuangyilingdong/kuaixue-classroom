import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ScanLine } from 'lucide-react';
import logo from '../assets/login/kx-class.webp';
import previewCode from '../assets/login/preview-code.svg';
import './login.css';

const methods = [['phone', '手机'], ['email', '邮箱'], ['wechat', '微信']];
const official = 'https://aicyld.com.cn';
const terms = `${official}/pages/user-agreement/page-mr39n395-8bzp`;
const privacy = `${official}/pages/user-agreement/page-mr39n7w0-y29q`;

export default function LoginScreen({ onAuthorize, onDemo, authorizing, onCancel }) {
  const tabs = useRef([]);
  const consent = useRef(null);
  const inFlight = useRef(false);
  const [method, setMethod] = useState('phone');
  const [agreed, setAgreed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const preview = !onAuthorize;

  useEffect(() => {
    window.kuaixueDesktop?.setTheme?.('dark');
  }, []);

  function select(next) {
    setMethod(next);
    setMessage('');
    setRevealed(false);
  }
  function tabKey(event, index) {
    const keys = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    const next = keys[event.key];
    select(methods[next][0]);
    tabs.current[next].focus();
  }
  async function authorize(action = onAuthorize) {
    if (inFlight.current) return;
    if (!agreed) {
      setMessage('请先阅读并勾选用户协议和隐私政策。');
      consent.current.focus();
      return;
    }
    if (!action) {
      setMessage('请在联网桌面客户端完成主站授权。');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(preview ? '正在打开演示课堂…' : '正在确认快学登录状态…');
    try {
      if (await action() === false) setMessage('已取消登录。');
    } catch {
      setMessage(preview ? '演示账户暂不可用，请重试。' : '未能确认登录，请重新授权或检查网络后重试。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function field(label, type, extra = {}) {
    if (!preview) return <button type="button" disabled={busy} className="kx-field-launch" onClick={() => authorize()} aria-label={`在主站填写${label}`}>{label}</button>;
    return <input type={type} aria-label={label} placeholder={label} autoComplete="off" spellCheck={false} {...extra} />;
  }

  return <main className="kx-login" aria-labelledby="kx-login-title">
    {authorizing && <header className="kx-auth-header"><div className="kx-drag" aria-hidden="true" />
      <button type="button" onClick={onCancel}>← 返回登录</button><span id="kx-auth-title">创易灵动 · 账号授权</span>
    </header>}
    <div className="kx-login-page" data-method={method} hidden={authorizing}>
      <div className="kx-drag" aria-hidden="true" />
      {preview && <span className="kx-preview-label">界面预览 · 请勿输入真实账号</span>}
      <div className="kx-column">
        <img className="kx-logo" src={logo} alt="KX CLASS" />
        <h1 id="kx-login-title">登录 KX CLASS</h1>
        <div className="kx-tabs" role="tablist" aria-label="登录方式">
          {methods.map(([id, text], i) => <button key={id} ref={node => { tabs.current[i] = node; }} type="button" role="tab" id={`kx-tab-${id}`}
            aria-controls="kx-login-panel" aria-selected={method === id} tabIndex={method === id ? 0 : -1} disabled={busy}
            onKeyDown={event => tabKey(event, i)} onClick={() => select(id)}><span>{text}</span></button>)}
        </div>
        <div role="tabpanel" id="kx-login-panel" aria-labelledby={`kx-tab-${method}`} key={method}>
          {method === 'wechat' ? <div className="kx-scan">
            <button type="button" className="kx-code-frame" onClick={() => authorize()} disabled={busy} aria-label={preview ? '查看扫码预览说明' : '前往主站获取微信登录码'}>
              {preview ? <><img src={previewCode} alt="微信登录布局示意码" /><span className="kx-code-seal">KX<small>示意</small></span></> :
                <span className="kx-code-action"><ScanLine aria-hidden="true" /><span>获取登录码</span></span>}
            </button>
            <p>使用微信扫一扫登录</p>
            <small>{preview ? '示意码仅供预览，正式登录请在手机端确认' : '点击获取主站登录码，扫描后请在手机端确认'}</small>
          </div> : <form className="kx-fields" autoComplete="off" onSubmit={event => { event.preventDefault(); void authorize(); }}>
            {method === 'phone' ? <>
              <div className="kx-field"><span className="kx-prefix">+86</span>{field('手机号', 'tel', { inputMode: 'tel', maxLength: 11 })}</div>
              <div className="kx-field">{field('验证码', 'text', { inputMode: 'numeric', maxLength: 6 })}<button className="kx-send" type="button" disabled={busy} onClick={preview ? () => setMessage('预览模式下不会发送短信。') : () => authorize()}>获取验证码</button></div>
            </> : <>
              <div className="kx-field">{field('邮箱地址', 'email')}</div>
              <div className="kx-field">{field('密码', revealed ? 'text' : 'password')}
                {preview && <button type="button" className="kx-eye" aria-label={revealed ? '隐藏密码' : '显示密码'} aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff /> : <Eye />}</button>}
              </div>
              <a className="kx-recover" href={`${official}/forgot-password`} target="_blank" rel="noreferrer">忘记密码？</a>
            </>}
            <button className="kx-submit" type="submit" disabled={busy}>{busy ? '正在授权…' : preview ? '登录' : '前往主站登录'}</button>
          </form>}
        </div>
        <div className="kx-agreement">
          <input id="kx-agree" ref={consent} type="checkbox" checked={agreed} disabled={busy} onChange={e => { setAgreed(e.target.checked); setMessage(''); }} aria-label="同意用户协议和隐私政策" />
          <span><label htmlFor="kx-agree">进入即表示同意</label> <a href={terms} target="_blank" rel="noreferrer">《用户协议》</a> 与 <a href={privacy} target="_blank" rel="noreferrer">《隐私政策》</a></span>
        </div>
        <p className="kx-status" role="status">{message || (!preview && '账号由创易灵动验证，全程在当前窗口完成。')}</p>
        {onDemo && <button type="button" className="kx-demo" disabled={busy} onClick={() => authorize(onDemo)}>使用演示学员登录</button>}
      </div>
      <footer>© 2026 KX CLASS</footer>
    </div>
  </main>;
}
