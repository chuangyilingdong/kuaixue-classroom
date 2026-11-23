import { BookOpen, Coins } from 'lucide-react';
import { courseClient } from '../services/courseClient.js';
import { groupActiveGrants } from '../data/learningGrants.js';
import { Media, UserAvatar } from './CourseParts.jsx';

export default function LearningView({ state, catalog, read, leave, browse, open }) {
  const { account, loading, error } = state;
  return <section className="pane learning-view">
    <header><BookOpen size={28} /><h1>我的学习</h1></header>
      <div className="learning-account">
        <div><UserAvatar user={account.user} className="account-avatar"/><strong>{account.user?.name || '当前快学账号'}</strong></div>
        {account.points === null ? <p role="status">积分暂时无法读取，可继续查看已解锁课程。</p> : <>
        <p>{account.demo ? '演示账号 · 示例余额' : '可用积分'}</p>
        <div><Coins size={18} /><b>{account.points.toLocaleString('zh-CN')}</b> 积分</div>
        </>}
        {error && <p role="alert">{error}</p>}
        <footer><button onClick={read} disabled={loading}>{loading ? '读取中…' : '刷新账户'}</button><button onClick={leave}>{account.demo ? '退出演示' : '退出快学账号'}</button></footer>
      </div>
      <h2>已解锁课程</h2>
      {catalog.loading ? <p role="status">正在读取课程目录</p> : catalog.error ? <p role="alert">课程目录暂不可用</p> : <GrantList account={account} catalog={catalog} open={open} />}
    <button className="learning-browse" onClick={browse}>浏览课程库</button>
  </section>;
}
function GrantList({ account, catalog, open }) {
  const grants = groupActiveGrants(account.entitlements, catalog.courses);
  if (!grants.length) return <p>当前账号尚无已解锁课程。</p>;
  return <ul className="learning-grants">{grants.map(group => {
    const available = Boolean(courseClient || group.course?.versionId === group.grant.versionId);
    const status = group.versionCount > 1
      ? `${group.currentOwned ? '当前版本可用' : '已购历史版本'} · 共 ${group.versionCount} 个已购版本`
      : group.currentOwned ? group.course?.duration || '当前版本' : '已购历史版本';
    return <li key={group.courseId}>
      {group.course && <Media src={group.course.thumbnailUrl} />}<div><strong>{group.target.title}</strong><small>{available ? status : '该课程版本暂不可查看'}</small></div>
      {available && <button onClick={event => open(group.target, event.currentTarget)}>查看课程</button>}
    </li>;
  })}</ul>;
}
