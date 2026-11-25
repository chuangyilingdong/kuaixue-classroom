import {useEffect,useRef,useState} from 'react';
import { Layers3, Search } from './icons.jsx';
import {courseClient} from '../services/courseClient.js';
import { groupCourseWorks } from '../data/works.js';
import { Media, PageButtons } from './CourseParts.jsx';
import WorkShowcase from './WorkShowcase.jsx';

const PAGE_SIZE = 12;

export default function WorksView({account,catalog,onAccount,onRun}) {
  const [retry,setRetry] = useState(0);
  const [state,setState] = useState({});
  const [selected,setSelected] = useState(null);
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const returnFocus = useRef(null);
  const heading = useRef(null);
  useEffect(() => {
    let active = true;
    if (courseClient && account) {
      setState({});
      courseClient.works().then(items => active && setState({items})).catch(error => active && setState({error:error.message}));
    }
    return () => {active = false;};
  },[account?.user?.id,retry]);
  const groups = groupCourseWorks(state.items || [], catalog.courses);
  const results = groups.filter(group => group.title.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  useEffect(() => {
    if (!selected && returnFocus.current) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [selected]);
  return <section className="pane learning-view works-view">
    {selected ? <WorkShowcase key={selected.id} group={selected} onBack={() => setSelected(null)} onRun={onRun} /> : <>
    <header><Layers3 size={28} /><h1 ref={heading} tabIndex={-1}>我的作品</h1></header>
    <div className="works-toolbar"><span>{groups.length} 门课程</span>
      <label className="library-search"><Search size={16} /><input type="search" aria-label="搜索我的作品" placeholder="搜索课程作品"
        value={query} onChange={event => {setQuery(event.target.value);setPage(1);}} /></label>
    </div>
    {!account ? <button className="hero-primary" onClick={onAccount}>前往我的学习，选择账号</button> : !courseClient ? <p>当前课程服务尚未开放作品。</p> : <>
      {state.error && <p role="alert">{state.error} <button onClick={() => setRetry(value => value+1)}>重试</button></p>}
      {state.items ? results.length ? <>
        <div className="learning-course-grid">{results.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(group =>
          <article className="course-card" key={group.id}>
            <button className="card-open" aria-label={`查看课程作品：${group.title}`} onClick={event => {
              returnFocus.current = event.currentTarget;
              setSelected(group);
            }}>
              <Media className="card-cover" src={group.thumbnailUrl} lazy />
              <span className="card-body"><strong>{group.title}</strong>
                <span className="learning-course-status">{group.items.map(item => item.mode === 'CANVAS' ? '画布作品' : 'VibeCoding 作品').join(' · ')}</span>
                <span className="card-footer"><span>{group.items.length} 类作品</span><span>查看作品</span></span>
              </span>
            </button>
          </article>)}</div>
        <PageButtons current={current} pages={pages} change={next => {
          setPage(next);heading.current?.focus();heading.current?.scrollIntoView({block:'start'});
        }} />
      </> : <p role="status">{query ? '没有找到匹配的课程作品。' : '暂时没有已保存的课程作品。'}</p>
        : !state.error && <p role="status">正在读取作品</p>}
    </>}
    </>}
  </section>;
}
