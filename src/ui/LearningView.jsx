import { useState } from "react";
import { BookOpen, Coins, UserRound } from 'lucide-react';
import { courseClient } from '../services/courseClient.js';
import { offlinePreview } from '../services/learningAccount.js';
import { Media } from './CourseParts.jsx';

export default function LearningView({ state, catalog, read, leave, browse, open }) {
  const { account, loading, error } = state;
  const [opening, setOpening] = useState(false);
  const [siteError, setSiteError] = useState("");
  async function signIn() {
    setOpening(true); setSiteError('');
    try {await window.kuaixueDesktop.login(); await read();}
    catch (error) {setSiteError(error.message || '登录失败，请重试');}
    finally {setOpening(false);}
  }
  async function openOfficial() {
    setOpening(true);
    setSiteError("");
    try { await window.kuaixueDesktop.openOfficialAccount(); }
    catch { setSiteError("登录页打开失败，请重试。"); }
    finally { setOpening(false); }
  }
  return <section className="pane learning-view">
    <header><BookOpen size={28} /><h1>我的学习</h1></header>
    {window.kuaixueDesktop?.openOfficialAccount && <div className="official-account-entry">
      {!offlinePreview && window.location.protocol === 'kuaixue:' && <button className="hero-primary" disabled={opening} onClick={signIn}>使用创易灵动账号登录</button>}
      <button className="hero-primary" onClick={openOfficial} disabled={opening}>{opening ? '正在打开…' : '打开创易灵动账号'}</button>
      <p>{offlinePreview ? '可在官方窗口查看真实积分。此预览版的课程列表使用演示权益。' : '在官方窗口查看积分，课程权益由快学会话读取。'}</p>
      {siteError && <p role="alert">{siteError}</p>}
    </div>}
    {account ? <>
      <div className="learning-account">
        <div><UserRound size={18} /><strong>{account.user?.name || '当前快学账号'}</strong></div>
        {account.points === null ? <p role="status">积分暂时无法读取，可继续查看已解锁课程。</p> : <>
        <p>{account.demo ? '演示账号 · 示例余额' : '可用积分'}</p>
        <div><Coins size={18} /><b>{account.points.toLocaleString('zh-CN')}</b> 积分</div>
        </>}
        <footer><button onClick={read}>刷新账户</button><button onClick={leave}>{account.demo ? '退出演示' : courseClient?.signOut ? '退出快学账号' : '关闭账户视图'}</button></footer>
      </div>
      <h2>已解锁课程</h2>
      {catalog.loading ? <p role="status">正在读取课程目录</p> : catalog.error ? <p role="alert">课程目录暂不可用</p> : <GrantList account={account} catalog={catalog} open={open} />}
    </> : <>
      <p>{offlinePreview ? '使用演示学员查看示例积分和已解锁课程。' : '读取当前快学会话的积分余额和课程权益。'}</p>
      {error && <p role="alert">{error}</p>}
      <button className="hero-primary" onClick={read} disabled={loading}>{loading ? '读取中…' : offlinePreview ? '体验演示学员' : '读取我的账户'}</button>
    </>}
    <button className="learning-browse" onClick={browse}>浏览课程库</button>
  </section>;
}
function GrantList({ account, catalog, open }) {
  const grants = account.entitlements.filter(grant => grant.status === 'active');
  if (!grants.length) return <p>当前账号尚无已解锁课程。</p>;
  return <ul className="learning-grants">{grants.map(grant => {
    const course = catalog.courses.find(item => item.id === grant.courseId);
    const available = courseClient || course && course.versionId === grant.versionId;
    const target = courseClient ? { ...course, id: grant.courseId, versionId: grant.versionId, title: grant.title || course?.title || "已购课程" } : course;
    return <li key={`${grant.courseId}/${grant.versionId}`}>
      {course && <Media src={course.thumbnailUrl} />}<div><strong>{target?.title || '已解锁课程'}</strong><small>{available ? (course?.versionId === grant.versionId ? course.duration : '已购历史版本') : '该课程版本暂不可查看'}</small></div>
      {available && <button onClick={event => open(target, event.currentTarget)}>查看课程</button>}
    </li>;
  })}</ul>;
}
