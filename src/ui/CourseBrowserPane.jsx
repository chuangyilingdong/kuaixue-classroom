import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ExternalLink,Globe2,Plus,RotateCw,X} from './icons.jsx';
import {normalizeCourseBrowserUrl} from './courseBrowserUrl.js';

const HUMAN_PARTITION = 'persist:zcode-embedded-browser';
const HOME_URL = 'about:blank';
let browserTabSequence = 0;

function newBrowserTab(url = HOME_URL) {
  return {
    id:`course-browser-${Date.now().toString(36)}-${++browserTabSequence}`,
    initialUrl:url,
    url,
    title:'新标签页',
    loading:false,
    ready:false,
    canGoBack:false,
    canGoForward:false,
    error:'',
  };
}

function BrowserGuest({tab,active,onView,onUpdate}) {
  const ref = useRef(null);
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;

  useEffect(() => {
    const view = ref.current;
    if (!view) return undefined;
    let alive = true;
    let ready = false;
    let pendingUrl = null;
    const patch = value => {
      if (alive) updateRef.current(tab.id,value);
    };
    const syncNavigation = () => {
      try {
        patch({
          url:view.getURL?.() || tab.url,
          title:view.getTitle?.() || '新标签页',
          canGoBack:Boolean(view.canGoBack?.()),
          canGoForward:Boolean(view.canGoForward?.()),
          loading:false,
          error:'',
        });
      } catch {}
    };
    const load = url => {
      if (!ready) {
        pendingUrl = url;
        return Promise.resolve();
      }
      return view.loadURL(url);
    };
    onView(tab.id,{element:view,load});
    const domReady = () => {
      ready = true;
      patch({ready:true});
      syncNavigation();
      if (pendingUrl) {
        const target = pendingUrl;
        pendingUrl = null;
        void view.loadURL(target).catch(error => {
          if (!/ERR_ABORTED/.test(error?.message || '')) {
            patch({error:error?.message || '网页加载失败'});
          }
        });
      }
    };
    const didStart = () => patch({loading:true,error:''});
    const didStop = () => syncNavigation();
    const didFail = event => {
      if (event.errorCode === -3) return;
      patch({loading:false,error:event.errorDescription || '网页加载失败'});
    };
    const titleUpdated = event => patch({title:event.title || '新标签页'});
    const gone = () => patch({loading:false,error:'网页进程已退出，请刷新重试'});

    view.addEventListener('dom-ready',domReady);
    view.addEventListener('did-start-loading',didStart);
    view.addEventListener('did-stop-loading',didStop);
    view.addEventListener('did-navigate',syncNavigation);
    view.addEventListener('did-navigate-in-page',syncNavigation);
    view.addEventListener('did-fail-load',didFail);
    view.addEventListener('page-title-updated',titleUpdated);
    view.addEventListener('render-process-gone',gone);
    return () => {
      alive = false;
      onView(tab.id,null);
      view.removeEventListener('dom-ready',domReady);
      view.removeEventListener('did-start-loading',didStart);
      view.removeEventListener('did-stop-loading',didStop);
      view.removeEventListener('did-navigate',syncNavigation);
      view.removeEventListener('did-navigate-in-page',syncNavigation);
      view.removeEventListener('did-fail-load',didFail);
      view.removeEventListener('page-title-updated',titleUpdated);
      view.removeEventListener('render-process-gone',gone);
    };
  },[onView,tab.id]);

  return <webview
    ref={ref}
    src={tab.initialUrl}
    partition={tab.partition || HUMAN_PARTITION}
    allowpopups="true"
    className={`course-browser-webview${active ? '' : ' is-hidden'}`}
  />;
}

export default function CourseBrowserPane({open,request,onClose,onNotice,lease,setOpen}) {
  const [tabs,setTabs] = useState([]);
  const [activeId,setActiveId] = useState('');
  const [address,setAddress] = useState('');
  const [emptyError,setEmptyError] = useState('');
  const views = useRef(new Map());
  const activeIdRef = useRef('');
  const handledRequest = useRef(0);
  activeIdRef.current = activeId;
  const activeTab = tabs.find(tab => tab.id === activeId) || null;

  const createTab = useCallback((url = HOME_URL) => {
    const tab = newBrowserTab(normalizeCourseBrowserUrl(url) || HOME_URL);
    setTabs(current => [...current,tab]);
    setActiveId(tab.id);
    setAddress(tab.url === HOME_URL ? '' : tab.url);
    return tab.id;
  },[]);

  const updateTab = useCallback((id,patch) => {
    setTabs(current => current.map(tab => tab.id === id ? {...tab,...patch} : tab));
  },[]);

  const registerView = useCallback((id,view) => {
    if (view) views.current.set(id,view);
    else views.current.delete(id);
  },[]);

  function navigate(value,id = activeIdRef.current) {
    const url = normalizeCourseBrowserUrl(value);
    if (!url) {
      setEmptyError('请输入 HTTP/HTTPS 网页地址');
      onNotice?.('课程浏览器只支持 HTTP/HTTPS 网页');
      return false;
    }
    const view = views.current.get(id);
    setEmptyError('');
    if (!view) return false;
    try {
      if (url === HOME_URL) {
        void view.load(HOME_URL).catch?.(() => {});
      } else {
        void view.load(url).catch?.(error => {
          if (!/ERR_ABORTED/.test(error?.message || '')) {
            updateTab(id,{error:error?.message || '网页加载失败'});
          }
        });
      }
      setAddress(url === HOME_URL ? '' : url);
      return true;
    } catch (error) {
      updateTab(id,{error:error?.message || '网页加载失败'});
      return false;
    }
  }

  const closeTab = useCallback(id => {
    setTabs(current => {
      const index = current.findIndex(tab => tab.id === id);
      const next = current.filter(tab => tab.id !== id);
      if (activeIdRef.current === id) {
        const target = next[Math.max(0,index - 1)];
        setActiveId(target?.id || '');
        setAddress(target && target.url !== HOME_URL ? target.url : '');
      }
      return next;
    });
  },[]);

  useEffect(()=>{
    if(!lease)return;
    return window.kuaixueDesktop?.browser?.onAgentTab?.(event=>{
      if(event.lease!==lease)return;
      const key=event.key;
      if(event.action==='close'){closeTab(key);return;}
      if(event.action==='new'){
        const tab={...newBrowserTab(),id:key,partition:key};
        setTabs(current=>[...current,tab]);
        setActiveId(key);
        setAddress('');
      }
      if(event.action==='activate')setActiveId(key);
      if(event.action==='new'||event.action==='activate')setOpen(true);
    });
  },[lease,closeTab,setOpen]);

  useEffect(() => {
    if (!open) return;
    if (request?.id && handledRequest.current !== request.id) {
      handledRequest.current = request.id;
      if (request.error) {
        setEmptyError(request.error);
        onNotice?.(request.error);
      }
      if (request.mode === 'new-tab') {
        createTab();
      } else if (request.url) {
        createTab(normalizeCourseBrowserUrl(request.url) || HOME_URL);
      } else if (tabs.length === 0) {
        createTab();
      }
      return;
    }
    if (!request && tabs.length === 0) {
      createTab();
    }
  },[createTab,onNotice,open,request,tabs.length]);

  useEffect(() => {
    if (!activeTab) {
      setAddress('');
      return;
    }
    setAddress(activeTab.url === HOME_URL ? '' : activeTab.url);
  },[activeTab?.id,activeTab?.url]);

  function submit(event) {
    event.preventDefault();
    navigate(address);
  }

  function useActive(action) {
    const view = activeTab ? views.current.get(activeTab.id) : null;
    if (!view) return;
    try { action(view.element); } catch {}
  }

  function startResize(event) {
    if (event.button !== 0) return;
    const shell = event.currentTarget.closest('.course-workbench-shell');
    if (!shell) return;
    event.preventDefault();
    const rect = shell.getBoundingClientRect();
    const move = next => {
      const percent = Math.min(72,Math.max(28,(rect.right - next.clientX) / rect.width * 100));
      shell.style.setProperty('--course-browser-width',`${percent}%`);
    };
    const stop = () => {
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',stop,{once:true});
  }

  return <aside className={`course-browser-pane${open ? '' : ' is-closed'}`} aria-label="网页浏览器" aria-hidden={!open}>
    <div className="course-browser-resizer" role="separator" aria-orientation="vertical" onPointerDown={startResize}/>
    <header className="course-browser-tabs">
      <div className="course-browser-tab-list" role="tablist" aria-label="浏览器标签页">
        {tabs.map(tab => <div key={tab.id} className={`course-browser-tab${tab.id === activeId ? ' is-active' : ''}`}>
          <button type="button" role="tab" aria-selected={tab.id === activeId} title={tab.title}
            onClick={() => setActiveId(tab.id)}>
            <Globe2 size={12}/><span>{tab.loading ? '正在加载…' : tab.title || '新标签页'}</span>
          </button>
          <button type="button" className="course-browser-tab-close" aria-label="关闭标签页" onClick={() => closeTab(tab.id)}>
            <X size={11}/>
          </button>
        </div>)}
      </div>
      <button type="button" className="course-browser-icon" aria-label="新建标签页" title="新建标签页" onClick={() => createTab()}>
        <Plus size={14}/>
      </button>
      <button type="button" className="course-browser-icon" aria-label="关闭浏览器侧栏" title="关闭浏览器侧栏" onClick={onClose}>
        <X size={15}/>
      </button>
    </header>
    <div className="course-browser-toolbar">
      <button type="button" className="course-browser-icon" aria-label="后退" title="后退"
        disabled={!activeTab?.canGoBack} onClick={() => useActive(view => view.goBack())}><ArrowLeft size={14}/></button>
      <button type="button" className="course-browser-icon" aria-label="前进" title="前进"
        disabled={!activeTab?.canGoForward} onClick={() => useActive(view => view.goForward())}><ArrowRight size={14}/></button>
      <button type="button" className="course-browser-icon" aria-label="刷新" title="刷新"
        disabled={!activeTab} onClick={() => useActive(view => view.reload())}><RotateCw size={13}/></button>
      <form className="course-browser-address" onSubmit={submit}>
        <Globe2 size={12}/>
        <input value={address} onChange={event => setAddress(event.target.value)}
          placeholder="输入网址或 localhost" aria-label="网页地址" spellCheck="false"/>
      </form>
      <button type="button" className="course-browser-icon" aria-label="在系统浏览器打开" title="在系统浏览器打开"
        disabled={!activeTab || activeTab.url === HOME_URL}
        onClick={() => activeTab && window.open(activeTab.url,'_blank','noopener,noreferrer')}><ExternalLink size={13}/></button>
    </div>
    <div className="course-browser-content">
      {!tabs.length ? <div className="course-browser-empty">
        <Globe2 size={28}/>
        <strong>网页浏览器</strong>
        <span>在地址栏输入网址，支持 HTTP/HTTPS 和本机开发服务。</span>
        <button type="button" onClick={() => createTab()}>打开新标签页</button>
        {emptyError ? <small role="alert">{emptyError}</small> : null}
      </div> : null}
      {tabs.map(tab => <div key={tab.id} className={`course-browser-tab-panel${tab.id === activeId ? '' : ' is-hidden'}`}>
        <BrowserGuest tab={tab} active={tab.id === activeId} onView={registerView} onUpdate={updateTab}/>
        {tab.error ? <div className="course-browser-error" role="alert">
          <span>{tab.error}</span><button type="button" onClick={() => navigate(tab.url,tab.id)}>重试</button>
        </div> : null}
      </div>)}
    </div>
  </aside>;
}
