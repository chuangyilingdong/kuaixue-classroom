import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Expand,
  X,
} from "lucide-react";
import { grantForCourse } from "../data/account.js";
import { courseClient } from "../services/courseClient.js";
import { localWorkshop } from "../services/learningAccount.js";
import { catalogBaseUrl, loadCourseDetail } from "../services/courseCatalog.js";
import { Favorite, Media, purchases, typeName } from "./CourseParts.jsx";

function Gallery({ images, title }) {
  const [index, setIndex] = useState(0);
  const dialog = useRef(null);
  const pointer = useRef(null);
  const multiple = images.length > 1;
  const active = Math.min(index, Math.max(0, images.length - 1));
  function move(delta) {
    if (multiple) setIndex((i) => (i + delta + images.length) % images.length);
  }
  function key(e) {
    if (multiple && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      move(e.key === "ArrowLeft" ? -1 : 1);
    }
  }
  function stage(large) {
    return (
      <div
        className="gallery-stage"
        tabIndex={multiple ? 0 : undefined}
        role="group"
        aria-label="课程预览图"
        onKeyDown={key}
        onPointerDown={(e) => {
          if (e.target.closest("button")) return;
          pointer.current = e.clientX;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onPointerUp={(e) => {
          if (
            pointer.current !== null &&
            Math.abs(e.clientX - pointer.current) > 45
          )
            move(e.clientX < pointer.current ? 1 : -1);
          pointer.current = null;
        }}
      >
        <Media
          src={images[active]?.url}
          alt={images[active]?.alt || `${title}课程预览`}
        />
        {multiple && (
          <>
            <button
              className="prev"
              aria-label="上一张"
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              className="next"
              aria-label="下一张"
              onClick={() => move(1)}
            >
              <ChevronRight />
            </button>
            <span className="frame-count" aria-live="polite">
              {active + 1} / {images.length}
            </span>
          </>
        )}
        {!large && images.length > 0 && (
          <button className="zoom" onClick={() => dialog.current?.showModal()}>
            <Expand size={13} />
            查看大图
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {stage(false)}
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label="课程预览大图"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <button
          className="lightbox-close"
          onClick={() => dialog.current.close()}
          aria-label="关闭大图"
        >
          <X />
        </button>
        {stage(true)}
      </dialog>
    </>
  );
}

export default function CourseDetail({ course, close, saved, toggle, entitlements, demoAccount, onAccount, onRun }) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const back = useRef(null);
  const [action, setAction] = useState({});
  async function enterWorkshop(mode) {
    setAction({busy:true});
    try {
      if (!mode) {
        onAccount(await courseClient.purchase(course.id, course.versionId));
        setAction({});
        return;
      }
      const run = await courseClient.start(course.id, course.versionId, mode);
      onRun(run);
    } catch (error) { setAction({error:error.message}); }
  }
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    loadCourseDetail(course.id, { versionId:course.versionId, signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) setState({ detail });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error });
      });
    return () => controller.abort();
  }, [course.id, course.versionId, attempt]);
  const detail = state.detail;
  const item = detail || course;
  const grant = detail && grantForCourse(entitlements, detail);
  const images = detail?.galleryImages.length
    ? detail.galleryImages
    : item.thumbnailUrl
      ? [{ url: item.thumbnailUrl, alt: item.title }]
      : [];
  const rows = [
    ["课程分类", item.category],
    ["课程类型", typeName(item)],
    ["课程难度", item.level],
    ["购买次数", purchases(item)],
  ];
  if (detail)
    rows.push(["课程步骤", `${detail.steps.length} 步`]);
  return (
    <section className="detail-view" aria-labelledby="course-title">
      <button
        ref={back}
        className="detail-back"
        title="返回"
        aria-label="返回上一页"
        onClick={close}
      >
        <ArrowLeft size={18} />
      </button>
      <div className="detail-columns">
        <div className="detail-left">
          <header className="detail-title">
            <Media src={item.thumbnailUrl} />
            <div>
              <h1 id="course-title">{item.title}</h1>
              <p>{item.subtitle}</p>
            </div>
          </header>
          <figure className="work-preview">
            <figcaption>作品预览</figcaption>
            <Gallery title={item.title} images={images} />
          </figure>
          <article className="description">
            <header>
              <span>课程介绍</span>
            </header>
            <div className="description-body">
              <h2>{item.title}</h2>
              <p>{item.subtitle || "暂无课程简介"}</p>
              {state.loading && <p role="status">正在读取课程详情</p>}
              {state.error && (
                <div className="feedback" role="alert">
                  详情读取失败
                  <button onClick={() => setAttempt((n) => n + 1)}>重试</button>
                </div>
              )}
              {detail && (
                <>
                  {detail.introImages.map((image, i) => (
                    <figure key={`${i}-${image.url}`}>
                      <Media
                        lazy
                        src={image.url}
                        alt={image.alt || `${item.title}介绍图 ${i + 1}`}
                      />
                      {image.alt && <figcaption>{image.alt}</figcaption>}
                    </figure>
                  ))}
                  {detail.mediaCredit && (
                    <p className="media-credit">{detail.mediaCredit}</p>
                  )}
                  <h3>学完你将能够</h3>
                  <ul>
                    {detail.learningObjectives.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  <h3>课程步骤</h3>
                  <ol className="steps">
                    {detail.steps.map((step) => (
                      <li key={step.id}>
                        <b>{step.title}</b>
                        <p>{step.description}</p>
                        <small>阶段成果 · {step.deliverable}</small>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </article>
        </div>
        <aside className="detail-side" aria-label="课程信息与操作">
          <div className="side-panel buy-panel">
            <div className="outcome">
              <small>本课交付作品</small>
              <h2>{detail?.steps.at(-1)?.deliverable || (state.loading ? "读取中…" : "详见课程介绍")}</h2>
              <span>{item.duration} · {item.level}</span>
            </div>
            <div className="preview-price"><Coins size={18} /><b>{item.price}</b> 积分</div>
            {courseClient && detail && demoAccount !== undefined ? <>
              {grant?.status === 'active' ? <div className="workspace-entries" aria-label="已解锁工作区">
                <strong>课程工作区</strong>
                {detail.permittedDeliveryModes.map(mode => <button key={mode} className="buy" disabled={action.busy} onClick={() => enterWorkshop(mode)}>
                  {mode === 'CANVAS' ? '进入学院画布' : '进入 VibeCoding 工作区'}
                </button>)}
              </div> : <button className="buy" disabled={action.busy} onClick={() => enterWorkshop()}>
                {action.busy ? '解锁中…' : `用 ${item.price} ${demoAccount ? "演示积分" : "积分"}解锁课程`}
              </button>}
            </> : courseClient && detail ? <button className="buy" onClick={async () => {
              try { onAccount(await courseClient.account()); } catch (error) { setAction({error:error.message}); }
            }}>{localWorkshop ? "使用演示学员体验课程" : "读取我的账户"}</button> : grant?.status === "active" ? <p className="grant-status">{demoAccount ? '演示学员已解锁' : '当前账号已解锁'}</p> : <>
              {grant?.status === "revoked" && <small>此课程权益已撤销</small>}
              <button className="buy" disabled>预览版暂未开放购买</button>
            </>}
            {action.error && <p role="alert">{action.error}</p>}
            <Favorite
              course={item}
              saved={saved.has(course.id)}
              toggle={toggle}
            />
            <small>课程解锁与 AI 创作消耗分开结算</small>
          </div>
          <section className="side-panel">
            <h2>课程资料</h2>
            <dl>
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {detail && <details className="course-version">
              <summary>版本信息</summary>
              <dl>
                <div><dt>数据来源</dt><dd>{catalogBaseUrl ? "课程服务" : "本机演示"}</dd></div>
                <div><dt>课程 ID</dt><dd>{detail.id}</dd></div>
                <div><dt>版本号</dt><dd>{detail.versionId}</dd></div>
              </dl>
            </details>}
          </section>
          <section className="side-panel capabilities">
            <h2>创作能力</h2>
            <div>
              {item.models.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
            <p>模型与创作消耗以服务端报价为准。</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
