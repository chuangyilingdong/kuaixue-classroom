import { useState } from 'react';

const types = { GENERATION_BOX: '生成框体', PROMPT: '提示词', IMAGE: '图片', VIDEO: '视频', AUDIO: '音频' };
const modalities = { TEXT: '文字', IMAGE: '图像', VIDEO: '视频', MUSIC: '音乐' };
const modeLabels = {
  IMAGE_REFERENCE: '图生图',
  TEXT_OR_OMNI: '文生视频 / 全能参考',
  TEXT_TO_IMAGE: '文生图',
  IMAGE_TO_IMAGE: '图生图',
  TEXT_TO_VIDEO: '文生视频',
  TEXT_ONLY: '文生视频',
  OMNI_REFERENCE: '全能参考',
  FIRST_FRAME: '首帧图',
  FIRST_LAST_FRAME: '首尾帧',
};
const blankBox = (modality = 'TEXT') => ({ modality, modelBinding: 'BOX', model: '' });
function choices(map) {
  return Object.entries(map).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}
function Controls({ items, index, update }) {
  function move(offset) {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  }
  return (
    <div className="kx-controls">
      <button type="button" disabled={!index} onClick={() => move(-1)}>
        上移
      </button>
      <button type="button" disabled={index === items.length - 1} onClick={() => move(1)}>
        下移
      </button>
      <button type="button" onClick={() => update(items.filter((_, at) => at !== index))}>
        移除
      </button>
    </div>
  );
}

function BoxEditor({ box, models, policy, setBox }) {
  const modality = box.modality === 'MUSIC' ? 'AUDIO' : box.modality;
  const available = models.filter((row) => row.modality === modality);
  const legacy = box.modelBinding !== 'BOX';
  const inherited = policy?.find((row) => row.modality === modality)?.modelId;
  const selected = available.find((row) => row.id === box.model);
  const options = selected?.options ?? box.paramOptions ?? {};
  const visual = modality === 'IMAGE' || modality === 'VIDEO';
  function parameter(key, label, values) {
    if (!values?.length && !box[key]) return null;
    const entries = [...new Set([...(values || []), ...(box[key] ? [box[key]] : [])])];
    return (
      <label>
        {label}
        <select
          value={box[key] ?? ''}
          onChange={(event) => {
            let value = event.target.value;
            if (value && key === 'durationSeconds') value = Number(value);
            setBox({
              ...box,
              [key]: value,
              ...(key === 'inputMode'
                ? {
                    inputModeLabel:
                      (value === 'TEXT'
                        ? modality === 'IMAGE'
                          ? '文生图'
                          : '文生视频'
                        : modeLabels[value]) || value,
                  }
                : {}),
            });
          }}
        >
          <option value="">学生自选</option>
          {entries.map((value) => (
            <option key={value} value={value}>
              {(value === 'TEXT' ? (modality === 'IMAGE' ? '文生图' : '文生视频') : modeLabels[value]) ||
                value}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="kx-box">
      <div className="kx-fields">
        <label>
          框体类型
          <select
            value={modality === 'AUDIO' ? 'MUSIC' : modality}
            onChange={(e) => setBox(blankBox(e.target.value))}
          >
            {choices(modalities)}
          </select>
        </label>
        <label>
          生成模型
          <select
            value={legacy ? '__legacy' : box.model || ''}
            onChange={(e) => {
              const row = available.find((item) => item.id === e.target.value);
              setBox({
                ...blankBox(box.modality),
                model: row?.id || '',
                modelLabel: row?.label || '',
                paramOptions: row?.options,
              });
            }}
          >
            {legacy && (
              <option value="__legacy">沿用已发布配置{inherited ? ` · ${inherited}` : ' · 关闭生成'}</option>
            )}
            <option value="">关闭此框体生成</option>
            {!legacy && box.model && !selected && (
              <option value={box.model}>{box.modelLabel || box.model}（已有配置）</option>
            )}
            {available.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!available.length && <p className="kx-note">此类型暂无可选模型。已有配置可以保留。</p>}
      {!legacy && box.model && (
        <div className="kx-fields">
          {visual && parameter('inputMode', '生成方式', options.inputModes)}
          {visual && parameter('aspectRatio', '画幅比例', options.aspectRatios)}
          {visual && parameter('resolution', '清晰度', options.resolutions)}
          {modality === 'VIDEO' && parameter('durationSeconds', '时长（秒）', options.durations)}
          {modality === 'VIDEO' && (options.audio || box.audio != null) && (
            <label>
              生成音频
              <select
                value={box.audio ?? ''}
                onChange={(e) =>
                  setBox({ ...box, audio: e.target.value === '' ? null : e.target.value === 'true' })
                }
              >
                <option value="">学生自选</option>
                <option value="true">带音频</option>
                <option value="false">不带音频</option>
              </select>
            </label>
          )}
          {modality === 'VIDEO' && (!box.inputMode || box.inputMode.includes('OMNI')) && (
            <label>
              参考音频用途
              <select
                value={box.audioRole || 'LIP_SYNC'}
                onChange={(e) => setBox({ ...box, audioRole: e.target.value })}
              >
                <option value="LIP_SYNC">对口型</option>
                <option value="VOICE_REFERENCE">声音参考</option>
              </select>
            </label>
          )}
          {modality === 'AUDIO' && (
            <label>
              音乐生成方式
              <select value={box.mode || 'LYRICS'} onChange={(e) => setBox({ ...box, mode: e.target.value })}>
                <option value="LYRICS">歌词生音乐</option>
                <option value="DESCRIPTION">描述生音乐</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function MaterialEditor({ item, models, policy, update }) {
  const box = item.materialType === 'GENERATION_BOX';
  const prompt = item.materialType === 'PROMPT';
  const snapshot = (patch) => update({ snapshot: { ...item.snapshot, ...patch } });
  return (
    <>
      <div className="kx-fields">
        <label>
          素材名称
          <input required value={item.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label>
          素材类型
          <select
            value={item.materialType}
            onChange={(e) =>
              update({
                materialType: e.target.value,
                assetUrl: '',
                snapshot: e.target.value === 'GENERATION_BOX' ? { box: blankBox() } : {},
              })
            }
          >
            {choices(types)}
          </select>
        </label>
      </div>
      {box && (
        <BoxEditor
          box={item.snapshot.box}
          models={models}
          policy={policy}
          setBox={(value) => snapshot({ box: value })}
        />
      )}
      {box || prompt ? (
        <label>
          {box ? '框体预填提示词（可选）' : '素材提示词'}
          <textarea
            required={prompt}
            value={item.snapshot?.content ?? (prompt ? item.description : '') ?? ''}
            onChange={(e) => snapshot({ content: e.target.value })}
          />
        </label>
      ) : (
        <label>
          素材地址
          <input
            type="url"
            required
            value={item.assetUrl ?? ''}
            onChange={(e) => update({ assetUrl: e.target.value })}
          />
        </label>
      )}
    </>
  );
}

export function CanvasRecipe({ draft, field, models }) {
  const [error, setError] = useState('');
  const groups = draft.materialGroups ?? [];
  const setGroups = (value) => field('materialGroups', value);
  const setGroup = (index, patch) =>
    setGroups(groups.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  return (
    <>
      <h2>画布素材编排</h2>
      <p className="kx-note">学员进入画布后，按这里的顺序取用素材、提示词和生成框体。</p>
      {groups.map((group, index) => {
        const setItems = (items) => setGroup(index, { materials: items });
        return (
          <section className="kx-group" key={group.id}>
            <header>
              <h3>素材组 {index + 1}</h3>
              <Controls items={groups} index={index} update={setGroups} />
            </header>
            <label>
              素材组名称
              <input
                required
                value={group.title}
                onChange={(e) => setGroup(index, { title: e.target.value })}
              />
            </label>
            {group.materials.map((item, at) => (
              <section key={item.id} className="kx-item">
                <header>
                  <h4>
                    {types[item.materialType]} · {at + 1}
                  </h4>
                  <Controls items={group.materials} index={at} update={setItems} />
                </header>
                <MaterialEditor
                  item={item}
                  models={models}
                  policy={draft.modelPolicy}
                  update={(patch) =>
                    setItems(group.materials.map((m, i) => (i === at ? { ...m, ...patch } : m)))
                  }
                />
              </section>
            ))}
            <button
              type="button"
              onClick={() =>
                setItems([
                  ...group.materials,
                  {
                    id: crypto.randomUUID(),
                    title: '',
                    materialType: 'GENERATION_BOX',
                    snapshot: { box: blankBox() },
                  },
                ])
              }
            >
              添加素材
            </button>
          </section>
        );
      })}
      <button
        type="button"
        className="kx-add"
        onClick={() => setGroups([...groups, { id: crypto.randomUUID(), title: '', materials: [] }])}
      >
        添加素材组
      </button>
      <details>
        <summary>初始画布 · {draft.canvasSnapshot?.nodes?.length ?? 0} 个节点</summary>
        <label>
          导入画布快照
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              try {
                const value = JSON.parse(await file.text());
                if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw Error();
                field('canvasSnapshot', value);
                setError('');
              } catch {
                setError('请选择含 nodes 和 edges 的学院画布快照');
              }
            }}
          />
        </label>
        <span role="status">{error}</span>
      </details>
    </>
  );
}

export function VibeRecipe({ draft, field }) {
  const config = draft.classroomConfig ?? {};
  const vibe = config.vibeCoding ?? {};
  const presets = vibe.presetPrompts ?? [];
  const setPresets = (values) =>
    field('classroomConfig', { ...config, vibeCoding: { ...vibe, presetPrompts: values } });
  return (
    <>
      <h2>VibeCoding 提示词预设</h2>
      <p className="kx-note">学员在工作区选中按钮后，将对应的正文带入对话。</p>
      {presets.map((preset, index) => (
        <section className="kx-group" key={index}>
          <header>
            <h3>提示词 {index + 1}</h3>
            <Controls items={presets} index={index} update={setPresets} />
          </header>
          {[
            ['title', '按钮标题'],
            ['text', '提示词正文'],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                rows={key === 'title' ? 1 : 4}
                required
                value={preset[key]}
                onChange={(e) =>
                  setPresets(presets.map((p, i) => (i === index ? { ...p, [key]: e.target.value } : p)))
                }
              />
            </label>
          ))}
        </section>
      ))}
      <button
        type="button"
        className="kx-add"
        onClick={() => setPresets([...presets, { title: '', text: '' }])}
      >
        添加提示词预设
      </button>
    </>
  );
}
