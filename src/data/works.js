export function groupCourseWorks(items, courses) {
  const groups = new Map();
  for (const item of items) {
    let group = groups.get(item.courseId);
    if (!group) {
      const course = courses.find(course => course.id === item.courseId);
      group = { id: item.courseId, title: item.title, thumbnailUrl: item.thumbnailUrl || course?.thumbnailUrl, items: [] };
      groups.set(item.courseId, group);
    }
    if (!group.items.some(saved => saved.mode === item.mode)) group.items.push(item);
  }
  return [...groups.values()];
}

export function canvasWorkAssets(work) {
  return (work?.nodes || []).flatMap(node => {
    const data = node.data || {};
    const url = data.previewUrl || data.assetUrl;
    const kind = node.type === 'animation' ? 'video' : node.type;
    if (url && ['image', 'video', 'audio'].includes(kind)) {
      return [{ id: node.id, title: data.title || '未命名作品', kind, url }];
    }
    const text = data.generatedText || (kind === 'prompt' ? data.text : '');
    return text ? [{ id: node.id, title: data.title || '文字作品', kind: 'text', text }] : [];
  });
}
