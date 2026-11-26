import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Play,
  Users,
} from "./icons.jsx";
import {
  CatalogState,
  Favorite,
  Media,
  purchases,
  typeName,
} from "./CourseParts.jsx";
import CourseSearch from "./CourseSearch.jsx";

export default function Home({
  catalog,
  retry,
  saved,
  toggle,
  onOpen,
  onLibrary,
  searchProps,
}) {
  const [selected, select] = useState(null);
  const course =
    catalog.courses.find((item) => item.id === selected) || catalog.courses[0];
  const posters = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const row = posters.current;
    if (!row) return;
    function measure() {
      setEdges({ left: row.scrollLeft > 2, right: row.scrollWidth - row.scrollLeft - row.clientWidth > 2 });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    row.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); row.removeEventListener("scroll", measure); };
  }, [catalog.courses, catalog.loading, catalog.error]);
  function browse(direction) {
    const row = posters.current;
    row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return (
    <section className="home-view" aria-label="首页">
      {course && <Media className="hero-image" src={course.bannerUrl || course.thumbnailUrl} />}
      <div className="hero-scrim" />
      <div className="home-inner">
        <CourseSearch catalog={catalog} onOpen={onOpen} {...searchProps} />
        <CatalogState catalog={catalog} retry={retry}>
          {course && (
            <>
              <div className="hero-copy" key={course.id}>
                <div className="eyebrow">
                  <span>{typeName(course)}</span>
                  {(course.categories?.length ? course.categories : [course.category]).join(" · ")}
                </div>
                <h1>{course.title}</h1>
                <div className="hero-facts">
                  <span>
                    <Coins />
                    <b>{course.price}</b> 积分
                  </span>
                  <span>
                    <Users />
                    购买 {purchases(course)}
                  </span>
                </div>
                <div className="hero-meta">
                  <Clock3 size={14} />
                  {course.duration}
                  <i /> {course.level}
                </div>
                <p>
                  {course.subtitle}
                  {course.steps.length > 1 && (
                    <>
                      <br />
                      学习路径：{course.steps.slice(0, 3).join(" → ")}
                    </>
                  )}
                </p>
                <div className="hero-actions">
                  <button
                    className="hero-primary"
                    onClick={(e) => onOpen(course, e.currentTarget)}
                  >
                    <Play size={14} fill="currentColor" />
                    查看课程
                  </button>
                  <Favorite
                    course={course}
                    saved={saved.has(course.id)}
                    toggle={toggle}
                  />
                </div>
              </div>
              <section className="home-shelf" aria-label="推荐课程">
                <header>
                  <h2>
                    推荐课程 <small>{catalog.courses.length}</small>
                  </h2>
                  <button onClick={onLibrary}>
                    全部课程 <ArrowRight size={14} />
                  </button>
                </header>
                <div className="poster-row" ref={posters}>
                  {catalog.courses.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={item.id === course.id}
                      className="poster"
                      onClick={() => select(item.id)}
                    >
                      <span className="poster-frame">
                        <Media src={item.thumbnailUrl} position={item.coverPosition} />
                      </span>
                      <span className="poster-copy">
                        <strong>{item.title}</strong>
                        <small>{item.category}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {edges.left && <button className="shelf-next shelf-prev" aria-label="向前滚动推荐课程" onClick={() => browse(-1)}><ChevronLeft /></button>}
                {edges.right && (
                  <button
                    className="shelf-next"
                    aria-label="滚动推荐课程"
                    onClick={() => browse(1)}
                  >
                    <ChevronRight />
                  </button>
                )}
              </section>
            </>
          )}
        </CatalogState>
      </div>
    </section>
  );
}
