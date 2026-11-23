import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { matchesQuery, CourseMark } from "./CourseParts.jsx";

const RESULT_LIMIT = 6;

export default function CourseSearch({ catalog, value, onChange, inputRef, isOpen, setIsOpen, onOpen, onShowAll }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => catalog.courses.filter((course) => matchesQuery(course, value)), [catalog.courses, value]);
  const results = matches.slice(0, RESULT_LIMIT);

  useEffect(() => setActiveIndex(0), [value]);

  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setActiveIndex(event.key === "ArrowUp" ? Math.max(results.length - 1, 0) : 0);
        setIsOpen(true);
        return;
      }
      setIsOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => results.length ? (index + direction + results.length) % results.length : 0);
      return;
    }
    if (event.key === "Enter" && isOpen && results.length) {
      event.preventDefault();
      setIsOpen(false);
      onOpen(results[activeIndex] || results[0], inputRef.current);
    }
  }

  const activeId = isOpen && results[activeIndex] ? `course-search-option-${results[activeIndex].id}` : undefined;
  return <div className="search-anchor" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
  }} onKeyDown={(event) => {
    if (event.key !== "Escape" || !isOpen || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.focus({ preventScroll: true });
    setIsOpen(false);
    setActiveIndex(0);
  }}>
    <div className="global-search">
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-label="搜索课程"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="course-search-results"
        aria-activedescendant={activeId}
        placeholder="搜索课程"
        onFocus={() => { setActiveIndex(0); setIsOpen(true); }}
        onClick={() => { setActiveIndex(0); setIsOpen(true); }}
        onChange={(event) => { onChange(event.target.value); setIsOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      {value && <button type="button" aria-label="清空搜索" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setIsOpen(true); inputRef.current?.focus(); }}><X size={14} /></button>}
    </div>
    <div className="search-panel" hidden={!isOpen}>
      <div className="search-panel-heading"><span>{value.trim() ? "搜索结果" : "课程推荐"}</span>{!catalog.loading && !catalog.error && <small>{matches.length} 门</small>}</div>
      <div id="course-search-results" role="listbox" aria-label="课程搜索结果">
      {catalog.loading ? <div className="search-panel-state" role="status">正在读取课程目录</div>
        : catalog.error ? <div className="search-panel-state" role="alert">课程目录暂不可用</div>
          : results.length ? <div className="search-results">{results.map((course, index) => <button
            type="button"
            role="option"
            tabIndex={-1}
            id={`course-search-option-${course.id}`}
            aria-selected={activeIndex === index}
            key={course.id}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => { setIsOpen(false); onOpen(course, inputRef.current); }}
          >
            <CourseMark course={course} />
            <span className="search-result-copy"><strong>{course.title}</strong><small>{course.category} · {course.duration}</small></span>
            <span className="search-result-price">{course.price}<small> 积分</small></span>
            <ArrowRight size={14} className="search-result-arrow" aria-hidden="true" />
          </button>)}</div>
            : <div className="search-panel-state" role="status"><Search size={17} /><span>没有找到匹配的课程</span></div>}
      </div>
      {!catalog.loading && !catalog.error && matches.length > 0 && <button className="all-matches" type="button" onClick={() => onShowAll(value.trim())}>查看全部 {matches.length} 门<ArrowRight size={15} /></button>}
    </div>
  </div>;
}

