import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Clock3,
  Code2,
  Compass,
  Layers3,
  Search,
} from "./icons.jsx";
import { defaultCatalogCategories, matchesCatalogCategory } from "../../shared/catalog-categories.mjs";
import {
  CatalogState,
  Favorite,
  Media,
  PageButtons,
  matchesQuery,
} from "./CourseParts.jsx";

const PAGE_SIZE = 10;
export default function CatalogWorkspace({
  catalog,
  saved,
  toggle,
  onOpen,
  retry,
  initialQuery = "",
  focusSearch = false,
}) {
  const [type, setType] = useState(null);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState("recommended");
  const [page, setPage] = useState(1);
  const heading = useRef(null);
  const categories = catalog.categories ?? defaultCatalogCategories;
  const selected = type === null ? undefined : categories.find(item => item.id === type);
  useEffect(() => {
    setType(current => categories.some(item => item.id === current) ? current : null);
    setPage(1);
  }, [categories]);
  const results = catalog.courses.filter(c => matchesCatalogCategory(c, selected) && matchesQuery(c, query));
  if (sort === "price") results.sort((a, b) => a.price - b.price);
  if (sort === "duration")
    results.sort(
      (a, b) =>
        (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity),
    );
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  function reset() {
    setType(null);
    setQuery("");
    setSort("recommended");
    setPage(1);
  }
  return (
    <section className="library-view">
      <header className="library-head">
        <div className="library-identity">
          <span className="book-emblem">
            <BookOpen size={26} />
          </span>
          <div>
            <h1>课程库</h1>
            <p>
              快学课堂 <i /> {catalog.courses.length} 门课程
            </p>
          </div>
        </div>
        <div className="library-tabs" role="group" aria-label="课程类型">
          {[{id: null, label: "全部课程"}, ...categories].map(item => {
            const Icon = item.id === null
              ? Compass
              : item.label === "VibeCoding" || item.mode === "VIBECODING"
                ? Code2
                : Layers3;
            return (
              <button
                key={item.id === null ? "all-courses" : `entry-${item.id}`}
                aria-pressed={selected ? type === item.id : item.id === null}
                onClick={() => {
                  setType(item.id);
                  setPage(1);
                }}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="library-tools">
          <label className="library-search">
            <Search size={16} />
            <input
              autoFocus={focusSearch}
              aria-label="搜索课程库"
              type="search"
              value={query}
              placeholder="搜索课程名称、简介"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="课程排序"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="recommended">综合推荐</option>
            <option value="price">积分升序</option>
            <option value="duration">时长升序</option>
          </select>
        </div>
      </header>
      <section className="library-content" aria-label="课程目录">
        <h2 ref={heading} tabIndex={-1}>
          {selected?.label || "全部课程"}{" "}
          <small>{results.length}</small>
        </h2>
        <CatalogState catalog={catalog} retry={retry}>
          {results.length ? (
            <>
              <div className="course-grid">
                {results
                  .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
                  .map((course) => (
                    <article className="course-card" key={course.id}>
                      <button
                        className="card-open"
                        onClick={(e) => onOpen(course, e.currentTarget)}
                        aria-label={`查看课程详情：${course.title}`}
                      >
                        <Media
                          className="card-cover"
                          src={course.thumbnailUrl}
                          position={course.coverPosition}
                          lazy
                        />
                        <span className="card-body">
                          <strong>{course.title}</strong>
                          <span className="card-summary">
                            {course.subtitle || "暂无简介"}
                          </span>
                          <span className="card-footer">
                            <span>
                              {(course.categories?.length ? course.categories : [course.category]).join(" · ")}
                              <small>
                                <Clock3 size={12} />
                                {course.duration}
                              </small>
                            </span>
                            <b>
                              {course.price} <small>积分</small>
                            </b>
                          </span>
                        </span>
                      </button>
                      <Favorite
                        compact
                        course={course}
                        saved={saved.has(course.id)}
                        toggle={toggle}
                      />
                    </article>
                  ))}
              </div>
              <PageButtons
                current={current}
                pages={pages}
                change={(next) => {
                  setPage(next);
                  heading.current?.focus();
                  heading.current?.scrollIntoView({ block: "start" });
                }}
              />
            </>
          ) : (
            <div className="feedback" role="status">
              <Search />
              没有找到匹配的课程
              <button onClick={reset}>查看全部课程</button>
            </div>
          )}
        </CatalogState>
      </section>
    </section>
  );
}
