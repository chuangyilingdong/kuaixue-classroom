import React, { useEffect, useRef, useState } from 'react';
import AliyunCaptcha from '@/components/AliyunCaptcha';
import logo from '../../src/assets/login/kx-class.webp';
import { enterClass, request } from './account.js';
import WechatLogin from './WechatLogin.jsx';

const methods = [['phone','手机'], ['email','邮箱'], ['wechat','微信']];
const legal = '/pages/user-agreement/';

export default function SignIn() {
  const [method, setMethod] = useState('phone');
  const [agreed, setAgreed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [message, report] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pendingWechat, setPendingWechat] = useState('');
  const [captcha, setCaptcha] = useState(false);
  const captchaAnswer = useRef(null);
  const consent = useRef(null);
  const form = useRef(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  function verifyHuman() {
    return new Promise(resolve => { captchaAnswer.current = resolve; setCaptcha(true); });
  }
  function finishCaptcha(token) {
    const resolve = captchaAnswer.current;
    captchaAnswer.current = null;
    setCaptcha(false); resolve?.(token);
  }
  function choose(id) {
    if (method === id) return;
    setPendingWechat(''); setMethod(id); setVisible(false); report('');
  }
  function accept() {
    if (agreed) return true;
    consent.current.focus(); report('请先阅读并勾选协议和账号授权说明。'); return false;
  }
  async function perform(action) {
    if (inFlight.current || !accept()) return;
    inFlight.current = true; setBusy(true); report('');
    try { await action(); } catch (error) { report(error.message || '登录失败，请重试。'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function sendSms() {
    const field = form.current.elements.phone;
    if (!field.reportValidity()) return;
    const phone = field.value.trim();
    void perform(async () => {
      const captchaToken = await verifyHuman();
      if (!captchaToken) return;
      await request('/api/auth/send-sms', {phone, captchaToken});
      setCooldown(60); report('验证码已发送，请查收短信。');
    });
  }
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form.current));
    void perform(async () => {
      let result;
      if (method === 'email') {
        const captchaToken = await verifyHuman();
        if (!captchaToken) return;
        result = await request('/api/auth/login', {...values, captchaToken});
      } else if (pendingWechat) {
        result = await request('/api/auth/wechat/complete-register', {...values, pendingToken:pendingWechat});
      } else {
        result = await request('/api/auth/login-phone', values);
        if (result.newUser) { report('该手机号尚未注册，请在创易灵动主站完成注册后登录。'); return; }
      }
      await enterClass(result.token);
    });
  }
  const scan = method === 'wechat' && !pendingWechat;
  return <><main className="kx-login"><div className="kx-login-page" data-method={method}>
    <div className="kx-column"><img className="kx-logo" src={logo} alt="KX CLASS" /><h1>登录 KX CLASS</h1>
      <div className="kx-tabs" aria-label="登录方式">{methods.map(([id, label]) => <button key={id} type="button" aria-pressed={method === id} disabled={busy} onClick={() => choose(id)}><span>{label}</span></button>)}</div>
      {scan ? <WechatLogin agreed={agreed} onToken={enterClass} bindPhone={value => { setPendingWechat(value); report('首次微信登录，请验证手机号完成绑定。'); }} /> :
        <form key={method} ref={form} className="kx-fields" onSubmit={submit}>
          {method === 'email' ? <>
            <div className="kx-field"><input required type="email" name="email" autoComplete="username" aria-label="邮箱地址" placeholder="邮箱地址" disabled={busy} /></div>
            <div className="kx-field"><input required type={visible ? 'text' : 'password'} name="password" autoComplete="current-password" aria-label="密码" placeholder="密码" disabled={busy} /><button type="button" className="kx-recover" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</button></div>
            <a className="kx-recover" href="/forgot-password" target="_blank" rel="noreferrer">忘记密码？</a>
          </> : <>
            <div className="kx-field"><span className="kx-prefix">+86</span><input required type="tel" name="phone" pattern="1[3-9][0-9]{9}" maxLength={11} autoComplete="tel-national" aria-label="手机号" placeholder="手机号" disabled={busy} /></div>
            <div className="kx-field"><input required name="code" inputMode="numeric" autoComplete="one-time-code" aria-label="验证码" placeholder="验证码" disabled={busy} /><button type="button" className="kx-send" onClick={sendSms} disabled={busy || cooldown > 0}>{cooldown ? `${cooldown}s` : '获取验证码'}</button></div>
          </>}
          <button className="kx-submit" type="submit" disabled={busy}>{busy ? '验证中…' : pendingWechat ? '绑定并登录' : '登录'}</button>
        </form>}
      <div className="kx-agreement"><input id="agree" ref={consent} type="checkbox" checked={agreed} disabled={busy} onChange={e => { setAgreed(e.target.checked); report(''); }} aria-describedby="kx-scope" /><span><label htmlFor="agree">我已阅读并同意</label> <a href={legal+'page-mr39n395-8bzp'} target="_blank" rel="noreferrer">《用户协议》</a> 与 <a href={legal+'page-mr39n7w0-y29q'} target="_blank" rel="noreferrer">《隐私政策》</a></span></div>
      <p id="kx-scope" className="kx-scope">勾选即授权快学课堂读取主站账号、积分余额和课程权益。登录本身免费。</p>
      <p className="kx-status" role="status">{message}</p>
    </div><footer>© 2026 KX CLASS</footer></div></main>
    <AliyunCaptcha open={captcha} onSuccess={finishCaptcha} onCancel={() => finishCaptcha(null)} />
  </>;
}
