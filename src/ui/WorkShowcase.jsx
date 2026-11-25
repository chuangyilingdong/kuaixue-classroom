import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Code2, Layers3, Play } from './icons.jsx';
import { courseClient } from '../services/courseClient.js';
import { canvasWorkAssets } from '../data/works.js';
import { Media } from './CourseParts.jsx';

const modeName = mode => mode === 'CANVAS' ? '画布作品' : 'VibeCoding 作品';

function snapshotHtml(files) {
  const resources = new Map(files.map(file => [file.path, file]));
  const urls = new Map();
  const building = new Set();
  const decode = file => new TextDecoder().decode(Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)));
  function resource(value, from = 'index.html') {
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return value;
    const url = new URL(value, `https://work.invalid/${from}`);
    const path = decodeURIComponent(url.pathname.slice(1));
    const file = resources.get(path);
    if (!file || building.has(path)) return '';
    if (urls.has(path)) return urls.get(path) + url.hash;
    building.add(path);
    const base64 = file.type === 'text/css'
      ? btoa(Array.from(new TextEncoder().encode(css(decode(file), path)), byte => String.fromCharCode(byte)).join(''))
      : file.base64;
    const result = `data:${file.type};base64,${base64}`;
    building.delete(path);
    urls.set(path, result);
    return result + url.hash;
  }
  function css(text, from) {
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, quote, value) => `url("${resource(value.trim(), from)}")`);
  }
  const entry = resources.get('index.html');
  if (!entry) throw new Error('已保存工程缺少 index.html');
  const doc = new DOMParser().parseFromString(decode(entry), 'text/html');
  doc.querySelectorAll('base,meta[http-equiv="Content-Security-Policy"]').forEach(element => element.remove());
  doc.querySelectorAll('[src],[href],[poster]').forEach(element => {
    for (const name of ['src', 'href', 'poster']) {
      if (element.hasAttribute(name)) element.setAttribute(name, resource(element.getAttribute(name)));
    }
  });
  doc.querySelectorAll('[srcset]').forEach(element => element.removeAttribute('srcset'));
  doc.querySelectorAll('style').forEach(element => { element.textContent = css(element.textContent, 'index.html'); });
  doc.querySelectorAll('[style]').forEach(element => element.setAttribute('style', css(element.getAttribute('style'), 'index.html')));
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline' data: https:; style-src 'unsafe-inline' data: https:; img-src data: https:; media-src data: https:; font-src data: https:; connect-src https:; form-action 'none'; base-uri 'none'";
  doc.head.prepend(policy);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

function HtmlWorkPreview({ preview }) {
  const [state, setState] = useState({});
  useEffect(() => {
    try {
      setState({ html: preview.files ? snapshotHtml(preview.files) : preview.html });
    } catch (error) { setState({ error: error.message }); }
  }, [preview]);
  return state.error ? <p role="alert">{state.error}</p> : state.html
    ? <iframe className="saved-html-preview" title="已保存的 VibeCoding 作品" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={state.html} />
    : <p role="status">正在载入作品预览…</p>;
}

export default function WorkShowcase({ group, onBack, onRun }) {
  const [mode, setMode] = useState(group.items[0].mode);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState('');
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const item = group.items.find(item => item.mode === mode);
  useEffect(() => {
    let active = true;
    setState({});
    courseClient.workPreview(item).then(preview => {
      if (active) setState({ preview });
    }).catch(error => {
      if (active) setState({ error: error.message });
    });
    return () => { active = false; };
  }, [item, attempt]);
  async function continueWork() {
    setBusy(true);
    setRunError('');
    try { onRun(await courseClient.start(item.courseId, item.versionId, item.mode)); }
    catch (error) { setRunError(error.message); setBusy(false); }
  }
  const assets = canvasWorkAssets(state.preview?.work);
  return <>
    <button className="works-back" onClick={onBack}><ArrowLeft size={17} />我的作品</button>
    <header className="works-detail-heading">
      <h1 tabIndex={-1} ref={heading}>{group.title}</h1>
      <button className="work-continue" disabled={busy} onClick={continueWork}><Play size={15} />{busy ? '正在打开…' : '继续创作'}</button>
    </header>
    <div className="library-tabs works-mode-tabs" role="group" aria-label="作品类型">
      {group.items.map(saved => {
        const Icon = saved.mode === 'CANVAS' ? Layers3 : Code2;
        return <button key={saved.mode} aria-pressed={mode === saved.mode} onClick={() => { setMode(saved.mode); setRunError(''); }}>
          <Icon size={16} />{modeName(saved.mode)}
        </button>;
      })}
    </div>
    {runError && <p role="alert">{runError}</p>}
    {state.error ? <p role="alert">{state.error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p>
      : !state.preview ? <p role="status">正在读取已保存的作品…</p>
      : mode === 'VIBECODING' ? <HtmlWorkPreview preview={state.preview} />
      : assets.length ? <div className="work-assets">
        {assets.map(asset => <figure className={`work-asset work-asset-${asset.kind}`} key={asset.id}>
          {asset.kind === 'image' ? <Media src={asset.url} alt={asset.title} lazy />
            : asset.kind === 'video' ? <video src={asset.url} controls preload="metadata" />
            : asset.kind === 'audio' ? <audio src={asset.url} controls preload="metadata" />
            : <div className="work-text">{asset.text}</div>}
          <figcaption>{asset.title}</figcaption>
        </figure>)}
      </div> : <p role="status">这个作品还没有可展示的内容。</p>}
  </>;
}
