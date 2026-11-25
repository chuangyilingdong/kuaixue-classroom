import { useRef, useState } from 'react';
import { BookOpen, Coins, Heart, Search } from './icons.jsx';
import { courseClient } from '../services/courseClient.js';
import { groupActiveGrants } from '../data/learningGrants.js';
import { Favorite, Media, PageButtons, UserAvatar, matchesQuery } from './CourseParts.jsx';

const PAGE_SIZE = 12;

export default function LearningView({ state, catalog, browse, open, saved, toggle, retry }) {
  const { account, error } = state;
  const [tab, setTab] = useState('unlocked');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const heading = useRef(null);
  const grants = groupActiveGrants(account.entitlements, catalog.courses);
  const favorites = catalog.courses.filter(course => saved.has(course.id));
  const entries = tab === 'unlocked'
    ? grants.filter(group => matchesQuery(group.target, query))
    : favorites.filter(course => matchesQuery(course, query));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(page, pages);

  return <section className="pane learning-view">
    <header><BookOpen size={28} /><h1>我的学习</h1></header>
    <div className="learning-account">
      <div><UserAvatar user={account.user} className="account-avatar" /><strong>{account.user?.name || '当前快学账号'}</strong></div>
      {account.points == null ? <p role="status">积分暂时无法读取，可继续查看已解锁课程。</p> : <>
        <p>{account.demo ? '演示账号 · 示例余额' : '可用积分'}</p>
        <div><Coins size={18} /><b>{account.points.toLocaleString('zh-CN')}</b> 积分</div>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="learning-toolbar">
      <div className="library-tabs" role="group" aria-label="我的学习栏目">
        {[['unlocked', '已解锁课程', BookOpen, grants.length], ['favorites', '我的收藏', Heart, favorites.length]].map(([id, label, Icon, count]) =>
          <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}>
            <Icon size={16} />{label}<small>{count}</small>
          </button>)}
      </div>
      <label className="library-search">
        <Search size={16} />
        <input type="search" aria-label="搜索我的学习" placeholder="搜索课程" value={query}
          onChange={event => { setQuery(event.target.value); setPage(1); }} />
      </label>
    </div>
    <h2 className="learning-section-title" ref={heading} tabIndex={-1}>{tab === 'unlocked' ? '已解锁课程' : '我的收藏'}</h2>
    {catalog.loading ? <p role="status">正在读取课程目录</p> : catalog.error
      ? <p role="alert">课程目录暂不可用 <button onClick={retry}>重试</button></p>
      : entries.length ? <div className="learning-course-grid">
        {entries.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(entry => {
          const group = tab === 'unlocked' ? entry : null;
          const course = group ? group.target : entry;
          const available = !group || Boolean(courseClient || group.course?.versionId === group.grant.versionId);
          const status = group
            ? available ? group.currentOwned ? '已解锁 · 当前版本可用' : '已解锁 · 历史版本' : '该课程版本暂不可查看'
            : course.subtitle || course.category;
          return <article className="course-card" key={course.id}>
            <button className="card-open" disabled={!available} onClick={event => open(course, event.currentTarget)}
              aria-label={`查看课程：${course.title}`}>
              <Media className="card-cover" src={course.thumbnailUrl} position={course.coverPosition} lazy />
              <span className="card-body">
                <strong>{course.title}</strong>
                <span className="learning-course-status">{status}</span>
                <span className="card-footer"><span>{course.duration || '已购课程'}</span>
                  <span>{group ? '查看课程' : `${course.price} 积分`}</span></span>
              </span>
            </button>
            <Favorite compact course={course} saved={saved.has(course.id)} toggle={toggle} />
          </article>;
        })}
      </div> : <p role="status">{query ? '没有找到匹配的课程。' : tab === 'unlocked' ? '当前账号尚无已解锁课程。' : '暂时没有收藏课程。'}</p>}
    <PageButtons current={current} pages={pages} change={next => {
      setPage(next);
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: 'start' });
    }} />
    <button className="learning-browse" onClick={browse}>浏览课程库</button>
  </section>;
}
