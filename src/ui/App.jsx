import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Coins,
  Compass,
  Grid2X2,
  Layers3,
  LogOut,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  X,
} from "./icons.jsx";
import { loadCourseCatalog } from "../services/courseCatalog.js";
import CatalogWorkspace from "./CatalogWorkspace.jsx";
import CourseDetail from "./CourseDetail.jsx";
import LearningView from "./LearningView.jsx";
import LoginScreen from './LoginScreen.jsx';
import OfficialSignInGate from './OfficialSignInGate.jsx';
import { localWorkshop, loadLearningAccount, offlinePreview } from "../services/learningAccount.js";
import { courseClient } from '../services/courseClient.js';
import WorksView from './WorksView.jsx';
import Home from "./Home.jsx";
import kxClassMark from '../assets/kx-class-mark.png';
import { UserAvatar } from './CourseParts.jsx';

const CourseRun = lazy(() => import('./CourseRun.jsx'));

function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function initialFavorites() {
  try {
    const ids = JSON.parse(stored("kuaixue-favorites", "[]"));
    return new Set(
      Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}
export default function App() {
  const [account, setAccount] = useState(null);
  const live = window.location.protocol === 'kuaixue:';
  async function enterDemo() {
    const demo = await loadLearningAccount();
    if (demo.demo !== true) throw new Error('演示账户暂不可用。');
    setAccount(demo);
  }
  if (!account && live) return <OfficialSignInGate onSignedIn={setAccount} />;
  if (!account) return <LoginScreen
    onDemo={!live && offlinePreview ? enterDemo : undefined}
  />;
  return <Classroom initialAccount={account} onSignedOut={() => setAccount(null)} />;
}

function Classroom({ initialAccount, onSignedOut }) {
  const [theme, setTheme] = useState(() =>
    stored("kuaixue-theme", "dark") === "light" ? "light" : "dark",
  );
  const [route, setRoute] = useState(() => window.location.hash === '#account' ? 'learning' : 'home');
  const [run, setRun] = useState(null);
  const [pendingRoute, setPendingRoute] = useState(null);
  const saveBeforeLeaving = useRef(null);
  const [course, setCourse] = useState(null);
  const [saved, setSaved] = useState(initialFavorites);
  const [search, setSearch] = useState("");
  const [librarySearch, setLibrarySearch] = useState({ revision: 0, query: "" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState({ courses: [], loading: true });
  const [reload, setReload] = useState(0);
  const settingsPanelRef = useRef(null),
    settingsTriggerRef = useRef(null),
    searchInputRef = useRef(null),
    returnFocus = useRef(null),
    leaveDialogStayRef = useRef(null);
  const [learning, setLearning] = useState({ account: initialAccount });
  const accountRequest = useRef(null);
  async function readAccount() {
    accountRequest.current?.abort();
    const controller = new AbortController();
    accountRequest.current = controller;
    setLearning(previous => ({ ...previous, loading: true, error: null }));
    try {
      const account = await loadLearningAccount({ signal: controller.signal });
      if (!controller.signal.aborted) setLearning({ account });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status === 401) { onSignedOut(); return; }
      setLearning(previous => ({ ...previous, loading: false, error: error.message || '账户读取失败。' }));
    }
  }
  async function leaveAccount() {
    accountRequest.current?.abort();
    if (!initialAccount.demo) {
      try { await courseClient.signOut(); }
      catch (error) {
        if (error.status !== 401) { setNotice('登出未确认，请重试。'); return; }
      }
    }
    onSignedOut();
  }
  useEffect(() => {
    void readAccount();
    const refresh = () => void readAccount();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
      accountRequest.current?.abort();
    };
  }, []);
  function leaveRun() {
    if (run?.lease) void localWorkshop.closeVibe(run.lease).catch(() => {});
    setRun(null);
  }
  function performGoto(next) {
    returnFocus.current = null;
    setPendingRoute(null);
    setSearchOpen(false);
    setSettingsOpen(false);
    leaveRun();
    setCourse(null);
    setRoute(next);
  }
  async function goto(next) {
    if (run) {
      setPendingRoute(next);
      return;
    }
    performGoto(next);
  }
  async function confirmGoto() {
    if (!pendingRoute) return;
    if (!(await saveBeforeLeaving.current?.())) return;
    performGoto(pendingRoute);
  }
  useEffect(() => {
    if (!localWorkshop) return;
    const refresh = () => setReload(n => n + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  function showAllMatches(query) {
    setLibrarySearch((previous) => ({ revision: previous.revision + 1, query }));
    goto("library");
  }
  function open(item, target) {
    returnFocus.current = target;
    setSearchOpen(false);
    setSettingsOpen(false);
    setCourse(item);
  }
  function close() {
    if (run) { leaveRun(); return; }
    setCourse(null);
  }
  function toggle(id) {
    setSaved((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function retry() {
    setReload((n) => n + 1);
  }
  useEffect(() => {
    try {
      localStorage.setItem("kuaixue-theme", theme);
    } catch {}
    window.kuaixueDesktop?.setTheme?.(theme);
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem("kuaixue-favorites", JSON.stringify([...saved]));
    } catch {}
  }, [saved]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog((c) => ({ ...c, loading: true, error: null }));
    loadCourseCatalog({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setCatalog({ ...data, loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCatalog({ courses: [], loading: false, error });
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (!course && returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
      setSearchOpen(false);
    }
  }, [course]);
  useEffect(() => {
    if (!pendingRoute) return;
    leaveDialogStayRef.current?.focus({ preventScroll: true });
    function escape(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setPendingRoute(null);
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [pendingRoute]);
  useEffect(() => {
    if (!course || run) return;
    function escape(e) {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector("dialog[open]") &&
        !settingsOpen
      )
        close();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [course, run, settingsOpen]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!settingsOpen) return;
    settingsPanelRef.current?.querySelector('[aria-pressed="true"]')?.focus();
    function outside(e) {
      if (
        !settingsPanelRef.current?.contains(e.target) &&
        !settingsTriggerRef.current?.contains(e.target)
      )
        setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [settingsOpen]);
  const controls = [
    ["首页", Compass, () => goto("home"), route === "home"],
    ["课程库", Grid2X2, () => goto("library"), route === "library"],
    ["我的学习", BookOpen, () => goto("learning"), route === "learning"],
    ["我的作品", Layers3, () => goto("works"), route === "works"],
  ];
  return (
    <div
      className="desktop"
      data-theme={theme}
      data-view={run ? 'workspace' : course ? "detail" : route}
    >
      <aside className="rail" aria-label="应用导航">
        <button
          className="brand"
          title="快学课堂首页"
          aria-label="快学课堂首页"
          onClick={() => goto("home")}
        >
          <img src={kxClassMark} alt="" draggable={false}/>
        </button>
        <nav>
          {controls.map(([label, Icon, action, active]) => (
            <button
              key={label}
              className="rail-btn"
              aria-label={label}
              title={label}
              aria-current={active ? "page" : undefined}
              onClick={action}
            >
              <Icon size={21} />
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <div className="rail-account">
            <div className="rail-points" aria-live="polite" title="当前积分">
              <Coins size={17} aria-hidden="true" />
              <span className="rail-points-total">{learning.loading ? '读取中' : learning.account?.points == null ? '—' : learning.account.points.toLocaleString('zh-CN')}</span>
            </div>
            <button
              className="avatar"
              aria-label="我的账户"
              title="我的账户"
              onClick={() => goto("learning")}
            >
              <UserAvatar user={learning.account?.user}/>
            </button>
            <button
              className="rail-account-logout"
              aria-label={initialAccount.demo ? '退出演示' : '退出账号'}
              title={initialAccount.demo ? '退出演示' : '退出账号'}
              onClick={() => void leaveAccount()}
            >
              <LogOut size={14} aria-hidden="true" />
              <span>{initialAccount.demo ? '退出演示' : '退出账号'}</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="window-drag" aria-hidden="true" />
      <div className="window-tools">
        <button title="刷新课程目录" aria-label="刷新课程目录" onClick={retry}>
          <RefreshCw size={15} />
        </button>
        <div
          className="settings-anchor"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setSettingsOpen(false);
          }}
          onKeyDown={(event) => {
            if (!settingsOpen || event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setSettingsOpen(false);
            settingsTriggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <button
            ref={settingsTriggerRef}
            className="theme-toggle"
            type="button"
            aria-label="设置"
            title="设置"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-controls="client-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={16} />
          </button>
          <section
            ref={settingsPanelRef}
            id="client-settings"
            className="settings-popover"
            role="dialog"
            aria-label="设置"
            hidden={!settingsOpen}
          >
            <header>设置</header>
            <div className="settings-row">
              <div>
                <strong>外观</strong>
              </div>
              <div className="theme-options" role="group" aria-label="外观主题">
                <button
                  type="button"
                  aria-pressed={theme === "light"}
                  onClick={() => setTheme("light")}
                >
                  <Sun size={13} />
                  浅色
                </button>
                <button
                  type="button"
                  aria-pressed={theme === "dark"}
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={13} />
                  深色
                </button>
              </div>
            </div>
            <div className="settings-row">
              <strong>课程目录</strong>
              <span
                className={`settings-source ${catalog.source === "service" && !catalog.error ? "is-service" : ""}`}
              >
                <i />
                {catalog.loading
                  ? "读取中"
                  : catalog.error
                    ? "不可用"
                    : catalog.source === "service"
                      ? "服务端"
                      : "演示数据"}
              </span>
            </div>
            <div className="settings-row">
              <strong>客户端版本</strong>
              <span>0.1.0</span>
            </div>
          </section>
        </div>
      </div>
      <main>
        <div className="pane" hidden={!!course || route !== "home"}>
          <Home
            catalog={catalog}
            retry={retry}
            saved={saved}
            toggle={toggle}
            onOpen={open}
            onLibrary={() => goto("library")}
            searchProps={{
              value: search,
              onChange: setSearch,
              onShowAll: showAllMatches,
              inputRef: searchInputRef,
              isOpen: searchOpen,
              setIsOpen: setSearchOpen,
            }}
          />
        </div>
        <div className="pane" hidden={!!course || route !== "library"}>
          <CatalogWorkspace
            key={librarySearch.revision}
            initialQuery={librarySearch.query}
            focusSearch={librarySearch.revision > 0}
            catalog={catalog}
            saved={saved}
            toggle={toggle}
            onOpen={open}
            retry={retry}
          />
        </div>
        {!course && route === "works" && <WorksView account={learning.account} catalog={catalog} onAccount={() => goto('learning')} onRun={next => {
          setCourse({id:next.course.id,versionId:next.course.versionId,title:next.course.title});setRun(next);
        }} />}
        {!course && route === "learning" && (
          <LearningView state={learning} catalog={catalog} browse={() => goto("library")} open={open} saved={saved} toggle={toggle} retry={retry} />
        )}
        {run && <Suspense fallback={<p>正在打开课程工作区…</p>}><CourseRun key={`${run.id}/${run.mode}`} run={run} close={close} saveBeforeLeaving={saveBeforeLeaving} /></Suspense>}
        {course && !run && (
          <div className="pane" key={course.id}>
            <CourseDetail
              onAccount={account => setLearning({account})}
              onRun={setRun}
              entitlements={learning.account?.entitlements}
              demoAccount={learning.account?.demo}
              course={course}
              close={close}
              saved={saved}
              toggle={toggle}
            />
          </div>
        )}
      </main>
      {pendingRoute && (
        <div
          className="leave-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingRoute(null);
          }}
        >
          <section
            className="leave-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-dialog-title"
            aria-describedby="leave-dialog-description"
          >
            <h2 id="leave-dialog-title">确定要离开工作区吗？</h2>
            <p id="leave-dialog-description">当前作品可能尚未保存，离开后会返回课程页面。</p>
            <div className="leave-dialog-actions">
              <button ref={leaveDialogStayRef} type="button" onClick={() => setPendingRoute(null)}>留在工作区</button>
              <button className="leave-dialog-primary" type="button" onClick={() => void confirmGoto()}>继续离开</button>
            </div>
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

