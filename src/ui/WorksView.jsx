import {useEffect,useState} from 'react';
import {courseClient} from '../services/courseClient.js';

export default function WorksView({account,onAccount,onRun}) {
  const [retry,setRetry] = useState(0);
  const [state,setState] = useState({});
  useEffect(() => {
    let active = true;
    if (courseClient && account) {
      setState({});
      courseClient.works().then(items => active && setState({items})).catch(error => active && setState({error:error.message}));
    }
    return () => {active = false;};
  },[account,retry]);
  async function open(item) {
    setState(previous => ({...previous,busy:true,error:null}));
    try {onRun(await courseClient.start(item.courseId,item.versionId,item.mode));}
    catch (error) {setState(previous => ({...previous,busy:false,error:error.message}));}
  }
  return <section className="pane learning-view"><h1>我的作品</h1>
    {!account ? <button className="hero-primary" onClick={onAccount}>前往我的学习，选择账号</button> : !courseClient ? <p>当前课程服务尚未开放作品。</p> : <>
      {state.error && <p role="alert">{state.error} <button onClick={() => setRetry(value => value+1)}>重试</button></p>}
      {state.items ? state.items.length ? <ul className="learning-grants">{state.items.map(item => <li key={`${item.versionId}/${item.mode}`}>
        <div><strong>{item.title}</strong><small>{item.mode === 'CANVAS' ? '学院画布' : '灵动 VibeCoding'} · 已完成 {item.completed}/{item.total} 步</small></div>
        <button disabled={state.busy} onClick={() => open(item)}>继续创作</button>
      </li>)}</ul> : <p>保存课程作品后，可在这里继续创作。</p> : !state.error && <p role="status">正在读取作品</p>}
    </>}
  </section>;
}
