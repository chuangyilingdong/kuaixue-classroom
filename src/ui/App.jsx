import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CircleHelp,
  Compass,
  Grid2X2,
  Layers3,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { loadCourseCatalog } from "../services/courseCatalog.js";
import CatalogWorkspace from "./CatalogWorkspace.jsx";
import CourseDetail from "./CourseDetail.jsx";
import LearningView from "./LearningView.jsx";
import { localWorkshop, loadLearningAccount } from "../services/learningAccount.js";
import { courseClient } from '../services/courseClient.js';
import WorksView from './WorksView.jsx';
import Home from "./Home.jsx";

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
  const [theme, setTheme] = useState(() =>
    stored("kuaixue-theme", "dark") === "light" ? "light" : "dark",
  );
  const [route, setRoute] = useState(() => window.location.hash === "#account" ? "learning" : "home");
  const [run, setRun] = useState(null);
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
    returnFocus = useRef(null);
  const [learning, setLearning] = useState({});
  const accountRequest = useRef(null);
  async function readAccount() {
    accountRequest.current?.abort();
    const controller = new AbortController();
    accountRequest.current = controller;
    setLearning({ loading: true });
    try {
      const account = await loadLearningAccount({ signal: controller.signal });
      if (!controller.signal.aborted) setLearning({ account });
    } catch (error) {
      if (!controller.signal.aborted) setLearning({ error: error.message || "账户读取失败。" });
    }
  }
  async function leaveAccount() {
    accountRequest.current?.abort();
    if (courseClient?.signOut && !learning.account?.demo) {
      try { await courseClient.signOut(); }
      catch { setNotice('登出未确认，请重试。'); return; }
    }
    setLearning({});
  }
  useEffect(() => () => accountRequest.current?.abort(), []);
  function leaveRun() {
    if (run?.lease) void localWorkshop.closeVibe(run.lease).catch(() => {});
    setRun(null);
  }
  async function goto(next) {
    if (run && !(await saveBeforeLeaving.current?.())) return;
    returnFocus.current = null;
    setSearchOpen(false);
    setSettingsOpen(false);
    leaveRun();
    setCourse(null);
    setRoute(next);
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
  function pending(name) {
    setNotice(`${name}服务待接入。`);
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
          <span>K</span>
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
          <button
            className="rail-btn"
            aria-label="帮助与反馈"
            title="帮助与反馈"
            onClick={() => pending("帮助与反馈")}
          >
            <CircleHelp size={17} />
          </button>
          <button
            className="avatar"
            aria-label="我的账户"
            title="我的账户"
            onClick={() => goto("learning")}
          >
            <UserRound size={19} />
          </button>
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
        {!course && route === "works" && <WorksView account={learning.account} onAccount={() => goto('learning')} onRun={next => {
          setCourse({id:next.course.id,versionId:next.course.versionId,title:next.course.title});setRun(next);
        }} />}
        {!course && route === "learning" && (
          <LearningView state={learning} catalog={catalog} read={readAccount} leave={leaveAccount} browse={() => goto("library")} open={open} />
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

