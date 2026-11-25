export const defaultCatalogCategories = [
  { id: 'canvas', label: '画布课程', mode: 'CANVAS' },
  { id: 'vibecoding', label: 'VibeCoding', mode: 'VIBECODING' },
];

export function validateCatalogCategories(items) {
  if (!Array.isArray(items) || items.length > 20) throw new Error('课程分类最多 20 项');
  const ids = new Set();
  const labels = new Set();
  return items.map(item => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || id === 'all' || ids.has(id) ||
        !label || label.length > 40 || labels.has(label) || label === '全部课程') {
      throw new Error('请填写有效且不重复的分类名称');
    }
    ids.add(id);
    labels.add(label);
    if (item.mode === 'CANVAS' || item.mode === 'VIBECODING') return { id, label, mode: item.mode };
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    if (!category || category.length > 80) throw new Error('请填写分类对应的课程归属');
    return { id, label, category };
  });
}

export function matchesCatalogCategory(course, category) {
  if (!category) return true;
  return category.mode
    ? course.permittedDeliveryModes?.includes(category.mode)
    : course.category === category.category;
}

export function normalizeCatalogEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 30) throw new Error('课程分类入口数据格式异常。');
  const ids = new Set();
  return entries.map(item => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const value = typeof item?.filterValue === 'string' ? item.filterValue.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id) || !label || label.length > 30) {
      throw new Error('课程分类入口数据格式异常。');
    }
    ids.add(id);
    let entry;
    if (item.filterType === 'mode' && ['CANVAS', 'VIBECODING'].includes(value)) entry = { id, label, mode: value };
    if (item.filterType === 'category' && value && value.length <= 80) entry = { id, label, category: value };
    if (!entry) throw new Error('课程分类筛选条件无效。');
    return item.enabled === false ? null : entry;
  }).filter(Boolean);
}
