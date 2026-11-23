import { useRef, useState } from "react";
import {
  BookOpen,
  Clock3,
  Code2,
  Compass,
  Film,
  Grid2X2,
  Heart,
  Layers3,
  Palette,
  Search,
  Camera,
} from "lucide-react";
import { categoryFilters } from "../data/courses.js";
import {
  CatalogState,
  Favorite,
  Media,
  PageButtons,
  matchesQuery,
} from "./CourseParts.jsx";

const PAGE_SIZE = 10;
const categoryIcons = {
  影像创作: Film,
  视觉设计: Palette,
  VibeCoding: Code2,
  商业视觉: Camera,
};
export default function CatalogWorkspace({
  catalog,
  saved,
  toggle,
  onOpen,
  retry,
  initialQuery = "",
  focusSearch = false,
}) {
  const [type, setType] = useState(categoryFilters[0]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState("recommended");
  const [onlySaved, setOnlySaved] = useState(false);
  const [page, setPage] = useState(1);
  const heading = useRef(null);
  const typeCourses = catalog.courses.filter(
    (c) => type === categoryFilters[0] || c.permittedDeliveryModes.includes(type === "画布课程" ? "CANVAS" : "VIBECODING"),
  );
  const categories = [...new Set(typeCourses.map((c) => c.category))];
  const results = typeCourses.filter(
    (c) =>
      (!category || c.category === category) &&
      (!onlySaved || saved.has(c.id)) &&
      matchesQuery(c, query),
  );
  if (sort === "price") results.sort((a, b) => a.price - b.price);
  if (sort === "duration")
    results.sort(
      (a, b) =>
        (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity),
    );
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  function reset() {
    setType(categoryFilters[0]);
    setCategory("");
    setQuery("");
    setSort("recommended");
    setOnlySaved(false);
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
          {categoryFilters.map((name, index) => {
            const Icon = [Compass, Layers3, Code2][index];
            return (
              <button
                key={name}
                aria-pressed={type === name}
                onClick={() => {
                  setType(name);
                  setCategory("");
                  setPage(1);
                }}
              >
                <Icon size={16} />
                {name}
              </button>
            );
          })}
        </div>
        <div className="library-tools">
          <div className="scope-tools">
            {[
              [false, "探索全部", Grid2X2],
              [true, "我的收藏", Heart],
            ].map(([value, label, Icon]) => (
              <button
                key={label}
                aria-pressed={onlySaved === value}
                onClick={() => {
                  setOnlySaved(value);
                  setPage(1);
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
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
            aria-label="课程分类"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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
        {!catalog.loading && !catalog.error && categories.length > 0 && (
          <div className="category-shortcuts">
            <h2>课程分类</h2>
            <div className="category-strip">
              {categories.slice(0, 4).map((name) => {
                const Icon = categoryIcons[name] || Layers3;
                return (
                  <button
                    key={name}
                    aria-pressed={category === name}
                    onClick={() => {
                      setCategory(category === name ? "" : name);
                      setPage(1);
                    }}
                  >
                    <span>
                      <Icon size={22} />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <small>
                        {
                          typeCourses.filter((item) => item.category === name)
                            .length
                        }{" "}
                        门课程
                      </small>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <h2 ref={heading} tabIndex={-1}>
          {onlySaved ? "我的收藏" : category || "全部课程"}{" "}
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
                              {course.category}
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
              {onlySaved ? "当前条件下没有收藏课程" : "没有找到匹配的课程"}
              <button onClick={reset}>查看全部课程</button>
            </div>
          )}
        </CatalogState>
      </section>
    </section>
  );
}
