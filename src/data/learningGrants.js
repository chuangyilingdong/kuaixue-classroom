export function groupActiveGrants(grants, courses) {
  const groups = new Map();
  for (const grant of Array.isArray(grants) ? grants : []) {
    if (grant?.status !== 'active' || !grant.courseId || !grant.versionId) continue;
    let group = groups.get(grant.courseId);
    if (!group) {
      group = {courseId: grant.courseId, grants: []};
      groups.set(grant.courseId, group);
    }
    group.grants.push(grant);
  }
  return [...groups.values()].map(group => {
    const course = courses.find(item => item.id === group.courseId);
    const currentGrant = course && group.grants.find(grant => grant.versionId === course.versionId);
    const grant = currentGrant || group.grants[0];
    return {
      courseId: group.courseId,
      course,
      grant,
      target: { ...course, id: group.courseId, versionId: grant.versionId,
        title: grant.title || course?.title || '已购课程' },
      versionCount: group.grants.length,
      currentOwned: Boolean(currentGrant),
    };
  });
}
