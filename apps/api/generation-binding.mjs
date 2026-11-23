// Resolve generation against the purchased version, never the editable node snapshot.
const modalityOf = (box) => (box.modality === 'MUSIC' ? 'AUDIO' : box.modality);
const materialsOf = (course) =>
  (course.materialGroups ?? [])
    .flatMap((group) => group.materials ?? [])
    .filter((item) => item.materialType === 'GENERATION_BOX');
export function generationModes(course) {
  const modes = (course.modelPolicy || []).map((policy) => policy.modality);
  for (const item of materialsOf(course)) {
    const box = item.snapshot?.box;
    if (box?.modelBinding === 'BOX' && box.model) modes.push(modalityOf(box));
  }
  return [...new Set(modes)];
}
export function generationBinding(course, nodeId, modality, input) {
  const materials = materialsOf(course);
  const material = materials.find((item) => `box-${item.id}` === nodeId);
  const box = material?.snapshot?.box;
  if (box?.modelBinding !== 'BOX') {
    // Old courses also allow pre-placed canvas nodes under their per-modality policy.
    if (
      materials.some((item) => item.snapshot?.box?.modelBinding === 'BOX') &&
      !material &&
      !course.canvasSnapshot?.nodes?.some((node) => node.id === nodeId)
    )
      return null;
    if (box && modalityOf(box) !== modality) return null;
    const modelId = course.modelPolicy?.find((item) => item.modality === modality)?.modelId;
    return modelId ? { modelId, input } : null;
  }
  if (!box.model || modalityOf(box) !== modality) return null;
  const options = box.paramOptions ?? {};
  const params = {};
  for (const [key, allowed] of Object.entries({
    aspectRatio: 'aspectRatios',
    resolution: 'resolutions',
    durationSeconds: 'durations',
  })) {
    const selected = input.params?.[key];
    if (box[key] != null && box[key] !== '') params[key] = box[key];
    else if (
      options[allowed]?.includes(selected) ||
      (key === 'aspectRatio' && selected === 'auto' && modality === 'VIDEO')
    )
      params[key] = selected;
  }
  if (modality === 'VIDEO') {
    params.audio = box.audio ?? (options.audio === true && input.params?.audio === true);
    params.audioRole = box.audioRole || 'LIP_SYNC';
  }
  if (modality === 'AUDIO') params.mode = box.mode || 'LYRICS';
  if (box.inputMode) params.inputMode = box.inputMode;
  const payload = { boxId: material.id, params };
  for (const key of ['prompt', 'title', 'referenceAssets', 'sourceAssetUrl', 'lastFrameAssetUrl']) {
    if (Object.hasOwn(input, key)) payload[key] = input[key];
  }
  return { modelId: box.model, modelLabel: box.modelLabel || '', input: payload };
}
