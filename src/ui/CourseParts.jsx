import { useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImageOff,
  RefreshCw,
  UserRound,
} from "./icons.jsx";

export const typeName = (course) =>
  (course.permittedDeliveryModes || []).map(mode => mode === "CANVAS" ? "画布课程" : "VibeCoding").join(" + ") || "读取中";
export const purchases = (course) =>
  course.purchaseCount == null
    ? "暂无统计"
    : `${course.purchaseCount.toLocaleString("zh-CN")} 次${course.versionId?.startsWith("demo-") ? "（演示）" : ""}`;
export function matchesQuery(course, query) {
  return `${course.title} ${course.subtitle} ${course.category}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export function Media({ src, alt = "", className = "", lazy = false, position }) {
  const [failed, setFailed] = useState(null);
  if (!src || src === failed)
    return (
      <span
        className={`media-missing ${className}`}
        role="img"
        aria-label={alt || "暂无配图"}
      >
        <ImageOff size={24} />
      </span>
    );
  return (
    <img
      className={className}
      style={position ? { objectPosition: position } : undefined}
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : "eager"}
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
}
export function UserAvatar({ user, className = "" }) {
  const [failed,setFailed]=useState(null);
  const src=user?.avatarUrl;
  const initial=String(user?.name||'').trim().slice(0,1).toLocaleUpperCase('zh-CN');
  return <span className={`user-avatar ${className}`.trim()} aria-hidden="true">
    {src&&src!==failed?<img src={src} alt="" draggable={false} onError={()=>setFailed(src)}/>:
      initial?<b>{initial}</b>:<UserRound size={18}/>}
  </span>;
}
export function CourseMark({ course }) {
  return <Media className="course-mark" src={course.thumbnailUrl} />;
}
export function Favorite({ course, saved, toggle, compact = false }) {
  return (
    <button
      type="button"
      className={`favorite ${compact ? "compact" : ""}`}
      aria-label={`${saved ? "取消收藏" : "收藏"}：${course.title}`}
      aria-pressed={saved}
      title={saved ? "取消收藏" : "收藏课程"}
      onClick={() => toggle(course.id)}
    >
      <Heart size={16} fill={saved ? "currentColor" : "none"} />
      {!compact && (saved ? "已收藏" : "收藏课程")}
    </button>
  );
}
export function CatalogState({ catalog, retry, children }) {
  if (catalog.loading)
    return (
      <div className="feedback" role="status">
        <RefreshCw size={20} />
        正在读取课程
      </div>
    );
  if (catalog.error)
    return (
      <div className="feedback" role="alert">
        课程暂时无法读取<button onClick={retry}>重新加载</button>
      </div>
    );
  if (!catalog.courses.length)
    return (
      <div className="feedback" role="status">
        <BookOpen />
        暂无上架课程
      </div>
    );
  return children;
}
export function PageButtons({ current, pages, change }) {
  if (pages < 2) return null;
  return (
    <nav className="pagination" aria-label="课程分页">
      <button
        aria-label="上一页"
        disabled={current === 1}
        onClick={() => change(current - 1)}
      >
        <ChevronLeft />
      </button>
      {current} / {pages}
      <button
        aria-label="下一页"
        disabled={current === pages}
        onClick={() => change(current + 1)}
      >
        <ChevronRight />
      </button>
    </nav>
  );
}
