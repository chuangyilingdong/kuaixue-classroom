import { useEffect, useRef, useState } from 'react';
import { CanvasRecipe, VibeRecipe } from './WorkspaceRecipe.jsx';
import './courses.css';
import { defaultCatalogCategories, defaultCourseCategories } from '../../shared/catalog-categories.mjs';

const names = { CANVAS: '学院画布', VIBECODING: '灵动 VibeCoding' };
const empty = () => ({ title: '', subtitle: '', category: '', categories: [], price: 0, permittedDeliveryModes: ['CANVAS'], steps: [] });
const draftFor = (course) => ({
  ...course,
  baseVersion: course.versionId,
  price: course.unlockPricePoints,
  categories: Array.isArray(course.categories) ? course.categories : course.category ? [course.category] : [],
  permittedDeliveryModes: course.permittedDeliveryModes ?? [course.type],
  steps: course.steps ?? [],
});
function Review({ draft }) {
  const groups = draft.materialGroups ?? [];
  const presets = draft.classroomConfig?.vibeCoding?.presetPrompts ?? [];
  return (
    <>
      <h2>发布核对</h2>
      <h3>{draft.title || '未命名课程'}</h3>
      <p>{draft.subtitle}</p>
      <p>
        解锁价 <strong>{draft.price} 积分</strong>
      </p>
      <p>客户端分类：{(draft.categories ?? [draft.category]).filter(Boolean).join('、') || '未选择'}</p>
      {draft.permittedDeliveryModes.includes('CANVAS') && (
        <section className="kx-group">
          <h3>学院画布 · {groups.length} 个素材组</h3>
          {groups.map((group) => (
            <div key={group.id}>
              <h4>{group.title}</h4>
              <ol>
                {group.materials.map((item) => {
                  const box = item.snapshot?.box;
                  const model =
                    box?.modelBinding === 'BOX'
                      ? box.modelLabel || box.model || '关闭生成'
                      : '沿用原版本模型策略';
                  return (
                    <li key={item.id}>
                      {item.title}
                      {box && ` · ${model}`}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      )}
      {draft.permittedDeliveryModes.includes('VIBECODING') && (
        <section className="kx-group">
          <h3>灵动 VibeCoding · {presets.length} 条提示词</h3>
          <ol>
            {presets.map((p, i) => (
              <li key={i}>{p.title}</li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
function CourseInfo({ draft, field, categories }) {
  const selectedCategories = Array.isArray(draft.categories)
    ? draft.categories
    : draft.category
      ? [draft.category]
      : [];
  function updateStep(index, patch) {
    field(
      'steps',
      draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }
  return (
    <>
      <h2>课程信息</h2>
      <label>
        课程名称
        <input
          required
          maxLength={120}
          value={draft.title}
          onChange={(e) => field('title', e.target.value)}
        />
      </label>
      <label>
        课程简介
        <textarea
          required
          maxLength={1000}
          value={draft.subtitle}
          onChange={(e) => field('subtitle', e.target.value)}
        />
      </label>
      <fieldset className="kx-course-categories">
        <legend>客户端分类（可多选）</legend>
        <div className="kx-category-options">
          {selectedCategories.filter(category => !categories.includes(category)).map(category => (
            <label key={`inactive-${category}`}>
              <input
                type="checkbox"
                checked
                onChange={event => field('categories', selectedCategories.filter(item => item !== category))}
              />
              {category}（已停用）
            </label>
          ))}
          {categories.map(category => (
            <label key={category}>
              <input
                type="checkbox"
                checked={selectedCategories.includes(category)}
                onChange={event => field('categories', event.target.checked
                  ? [...new Set([...selectedCategories, category])]
                  : selectedCategories.filter(item => item !== category))}
              />
              {category}
            </label>
          ))}
        </div>
        {!categories.length && <small>请先在课程分类设置中添加分类</small>}
      </fieldset>
      <label>
        课程解锁价（积分）
        <input
          type="number"
          min="0"
          max="1000000"
          required
          value={draft.price}
          onChange={(e) => field('price', e.target.value === '' ? '' : Number(e.target.value))}
        />
      </label>
      <fieldset>
        <legend>购课后开放的工作区</legend>
        <div className="kx-checks">
          {Object.entries(names).map(([mode, name]) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={draft.permittedDeliveryModes.includes(mode)}
                onChange={(e) =>
                  field(
                    'permittedDeliveryModes',
                    e.target.checked
                      ? [...draft.permittedDeliveryModes, mode]
                      : draft.permittedDeliveryModes.filter((m) => m !== mode),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <details>
        <summary>详情页大纲（可选）</summary>
        {draft.steps.map((s, i) => (
          <section key={s.id} className="kx-group">
            {[
              ['title', '标题'],
              ['description', '操作说明'],
              ['deliverable', '阶段成果'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input required value={s[key]} onChange={(e) => updateStep(i, { [key]: e.target.value })} />
              </label>
            ))}
            <button
              type="button"
              disabled={!i}
              onClick={() => {
                const next = [...draft.steps];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                field('steps', next);
              }}
            >
              上移
            </button>{' '}
            <button
              type="button"
              onClick={() =>
                field(
                  'steps',
                  draft.steps.filter((item) => item.id !== s.id),
                )
              }
            >
              移除条目
            </button>
          </section>
        ))}
        <button
          type="button"
          onClick={() =>
            field('steps', [
              ...draft.steps,
              { id: crypto.randomUUID(), title: '', description: '', deliverable: '' },
            ])
          }
        >
          添加大纲条目
        </button>
      </details>
    </>
  );
}
export default function KuaixueCourses({ api }) {
  const [catalog, setCatalog] = useState([]),
    [models, setModels] = useState([]);
  const [draft, setDraft] = useState(empty),
    [page, setPage] = useState('info');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const form = useRef(null),
    pending = useRef(false);
  const [categoryConfig, setCategoryConfig] = useState({
    revision: 0,
    items: defaultCatalogCategories,
    courseCategories: defaultCourseCategories,
  });
  const [categoryError, setCategoryError] = useState('');
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((list) => live && setCatalog(list))
      .catch((e) => live && setMessage(e.message));
    Promise.resolve()
      .then(() => api.categories())
      .then(config => { if (live) { setCategoryConfig(config); setCategoriesLoaded(true); } })
      .catch(error => { if (live) setCategoryError(error.message); });
    Promise.resolve()
      .then(() => api.models?.())
      .then((list) => live && setModels(Array.isArray(list) ? list : []))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [api]);
  function field(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    setMessage('');
  }
  function select(course) {
    setDraft(course ? draftFor(course) : empty());
    setPage('info');
    setMessage('');
  }
  function editCourseCategory(index, value) {
    setCategoryConfig(config => ({
      ...config,
      courseCategories: config.courseCategories.map((item, position) => position === index ? value : item),
    }));
    setCategoryError('');
  }
  function moveCourseCategory(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= categoryConfig.courseCategories.length) return;
    setCategoryConfig(config => {
      const courseCategories = [...config.courseCategories];
      [courseCategories[index], courseCategories[target]] = [courseCategories[target], courseCategories[index]];
      return { ...config, courseCategories };
    });
    setCategoryError('');
  }
  function removeCourseCategory(index) {
    setCategoryConfig(config => ({
      ...config,
      courseCategories: config.courseCategories.filter((_, position) => position !== index),
    }));
    setCategoryError('');
  }
  async function saveCategories(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setCategoryError('');
    try {
      setCategoryConfig(await api.saveCategories({
        revision: categoryConfig.revision,
        courseCategories: categoryConfig.courseCategories,
      }));
      setCategoryError('分类已保存');
    } catch (error) { setCategoryError(error.message); }
    finally { pending.current = false; setBusy(false); }
  }
  const pages = [
    ['info', '课程信息'],
    ...draft.permittedDeliveryModes.map((mode) => [mode, names[mode]]),
    ['review', '发布核对'],
  ];
  async function apply(kind) {
    if (pending.current) return;
    if (kind === 'publish') {
      if (!draft.permittedDeliveryModes.length) {
        setPage('info');
        setMessage('请至少选择一个工作区');
        return;
      }
      const selectedCategories = Array.isArray(draft.categories)
        ? draft.categories
        : draft.category
          ? [draft.category]
          : [];
      if (!selectedCategories.length) {
        setPage('info');
        setMessage('请至少选择一个客户端分类');
        return;
      }
      if (selectedCategories.some(category => !categoryConfig.courseCategories.includes(category))) {
        setPage('info');
        setMessage('请移除已停用分类，并至少选择一个有效分类');
        return;
      }
      const invalid = form.current.querySelector('input:invalid,select:invalid,textarea:invalid');
      if (invalid) {
        setPage(invalid.closest('[data-page]').dataset.page);
        if (invalid.closest('details')) invalid.closest('details').open = true;
        requestAnimationFrame(() => {
          invalid.focus();
          invalid.reportValidity();
        });
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    try {
      if (kind === 'publish') {
        const course = await api.publish({ ...draft, recipeEditor: true });
        setDraft(draftFor(course));
        setMessage('课程版本已发布');
      } else {
        await api.hide(draft.id, draft.baseVersion);
        setMessage('已下架，已购学员仍可学习该版本');
      }
      setCatalog(await api.catalog());
    } catch (error) {
      setMessage(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="kx-studio">
      <header className="kx-heading">
        <small>创易灵动 / 快学课堂</small>
        <h1>课程管理</h1>
      </header>
      <details className="kx-category-settings">
        <summary>客户端分类设置</summary>
        <form onSubmit={saveCategories}>
          <fieldset disabled={busy || !categoriesLoaded}>
            <p>课程编辑中可多选；客户端分类入口将按此顺序显示。工作区权限仍在课程里单独设置。</p>
            {categoryConfig.courseCategories.map((category, index) => <div className="kx-category-row" key={`${category}-${index}`}>
              <label>分类名称<input required maxLength={80} value={category}
                onChange={event => editCourseCategory(index, event.target.value)} /></label>
              <div className="kx-controls">
                <button type="button" aria-label={`上移${category}`} title="上移" disabled={!index}
                  onClick={() => moveCourseCategory(index, -1)}>↑</button>
                <button type="button" aria-label={`下移${category}`} title="下移" disabled={index === categoryConfig.courseCategories.length - 1}
                  onClick={() => moveCourseCategory(index, 1)}>↓</button>
                <button type="button" aria-label={`移除分类${category}`} title="移除分类" disabled={categoryConfig.courseCategories.length <= 1}
                  onClick={() => removeCourseCategory(index)}>×</button>
              </div>
            </div>)}
            <button type="button" disabled={categoryConfig.courseCategories.length >= 40}
              onClick={() => setCategoryConfig(config => ({
                ...config,
                courseCategories: [...config.courseCategories, ''],
              }))}>添加分类</button>
            <button type="submit" className="kx-primary">保存分类</button>
          </fieldset>
          {categoryError && <p role="status">{categoryError}</p>}
          <button type="button" disabled={busy} onClick={async () => {
            try { setCategoryConfig(await api.categories()); setCategoriesLoaded(true); setCategoryError(''); }
            catch (error) { setCategoryError(error.message); }
          }}>重新加载分类</button>
        </form>
      </details>
      <div className="kx-layout">
        <aside>
          <header>
            <h2>课程列表</h2>
            <span>{catalog.length}</span>
          </header>
          <button type="button" onClick={() => select()} disabled={busy}>
            ＋ 创建课程
          </button>
          {catalog.map((course) => (
            <button
              key={course.id}
              className="kx-course"
              disabled={busy}
              aria-current={draft.id === course.id ? 'true' : undefined}
              onClick={() => select(course)}
            >
              {course.title}
              <small>{course.visible ? '已发布' : '已下架'}</small>
            </button>
          ))}
        </aside>
        <form
          ref={form}
          noValidate
          onSubmit={(e) => e.preventDefault()}
        >
          <header className="kx-course-heading">
            <small>{draft.baseVersion ? '编辑课程版本' : '新建课程'}</small>
            <h2>{draft.title || '未命名课程'}</h2>
          </header>
          <nav aria-label="课程编辑栏目">
            {pages.map(([key, label]) => (
              <button
                key={key}
                disabled={busy}
                type="button"
                aria-current={page === key ? 'page' : undefined}
                onClick={() => setPage(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <fieldset className="kx-body" disabled={busy}>
            <div data-page="info" hidden={page !== 'info'}>
            <CourseInfo draft={draft} field={field} categories={categoryConfig.courseCategories} />
            </div>
            {draft.permittedDeliveryModes.includes('CANVAS') && (
              <div data-page="CANVAS" hidden={page !== 'CANVAS'}>
                <CanvasRecipe key={draft.id || 'new'} {...{ draft, field, models }} />
              </div>
            )}
            {draft.permittedDeliveryModes.includes('VIBECODING') && (
              <div data-page="VIBECODING" hidden={page !== 'VIBECODING'}>
                <VibeRecipe {...{ draft, field }} />
              </div>
            )}
            {page === 'review' && <Review draft={draft} />}
          </fieldset>
          <footer>
            <span role="status">{message}</span>
            {draft.baseVersion && (
              <button type="button" disabled={busy} onClick={() => apply('hide')}>
                下架课程
              </button>
            )}
            {page === 'review' ? (
              <button key="publish" className="kx-primary" type="button" disabled={busy} onClick={() => apply('publish')}>
                发布课程版本
              </button>
            ) : (
              <button key="review" className="kx-primary" type="button" onClick={() => setPage('review')}>
                查看发布核对
              </button>
            )}
          </footer>
        </form>
      </div>
    </main>
  );
}
