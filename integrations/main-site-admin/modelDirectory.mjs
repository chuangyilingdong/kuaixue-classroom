const optionKeys = {
  aspectRatio: 'aspectRatios',
  resolution: 'resolutions',
  inputMode: 'inputModes',
  durationSeconds: 'durations',
};
const modalityOf = (value) => (value === 'MUSIC' ? 'AUDIO' : value);

// Expose display information only; the channel registry may also contain credentials.
export function modelDirectory(rows = []) {
  return rows
    .map(({ id, label, modality, options = {} }) => {
      const publicOptions = { audio: options.audio === true };
      for (const key of Object.values(optionKeys)) {
        publicOptions[key] = (Array.isArray(options[key]) ? options[key] : []).filter((value) =>
          key === 'durations' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string',
        );
      }
      return { id, label: label || id, modality: modalityOf(modality), options: publicOptions };
    })
    .filter(
      (row) =>
        typeof row.id === 'string' && row.id && ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO'].includes(row.modality),
    );
}

const boxesIn = (groups) =>
  (groups || []).flatMap((group) =>
    (group.materials || []).filter((item) => item.materialType === 'GENERATION_BOX'),
  );
const invalid = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};

// An unchanged, previously published box can be republished if the registry is offline.
export async function prepareBindings(draft, base, readModels) {
  if (!draft.permittedDeliveryModes?.includes('CANVAS')) return;
  const prior = new Map(boxesIn(base?.materialGroups).map((item) => [item.id, item.snapshot.box]));
  const changes = boxesIn(draft.materialGroups).filter((item) => {
    const box = item.snapshot?.box;
    return (
      box?.modelBinding === 'BOX' && box.model && JSON.stringify(box) !== JSON.stringify(prior.get(item.id))
    );
  });
  if (!changes.length) return;
  const directory = modelDirectory(await readModels());
  for (const { title, snapshot } of changes) {
    const box = snapshot.box;
    const row = directory.find((item) => item.id === box.model && item.modality === modalityOf(box.modality));
    if (!row) invalid(`「${title}」的模型当前不可选，请刷新模型目录`);
    for (const [key, option] of Object.entries(optionKeys)) {
      if (box[key] != null && box[key] !== '' && !row.options[option].includes(box[key]))
        invalid(`「${title}」的模型参数不在可选范围内`);
    }
    if (box.audio === true && !row.options.audio) invalid(`「${title}」的模型不支持生成音频`);
    box.modelLabel = row.label;
    box.paramOptions = row.options;
  }
}
