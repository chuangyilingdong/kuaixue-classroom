// Shared response boundary for desktop, local service and the staging adapter.
export function readAccount(profile, wallet, grants) {
  if (!profile || typeof profile.id !== 'string' || !profile.id || typeof profile.username !== 'string' || !profile.username.trim()) throw new Error('Invalid account');
  if (!Number.isSafeInteger(wallet?.total) || wallet.total < 0) throw new Error('Invalid wallet');
  const entitlements = readEntitlements(profile.id, grants);
  const avatarUrl = safeAvatar(profile.avatar) || safeAvatar(profile.avatarUrl);
  return { user: { id: profile.id, name: profile.username,
    ...(avatarUrl ? {avatarUrl} : {}) }, points: wallet.total, entitlements };
}

function safeAvatar(value) {
  if(typeof value!=='string')return '';
  const text=value.trim();
  if(!text||text.includes('\\')||/[\u0000-\u001f]/.test(text))return '';
  if(text.startsWith('/')&&!text.startsWith('//'))return text;
  try{
    const url=new URL(text);
    return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
  }catch{return '';}
}

export function readEntitlements(userId, grants) {
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid entitlement owner');
  if (!Array.isArray(grants)) throw new Error('Invalid entitlement list');
  if (grants.some(grant => grant?.userId !== userId)) throw new Error('Invalid entitlement owner');
  return parseGrantList(grants);
}

export function parseGrantList(grants) {
  if (!Array.isArray(grants)) throw new Error('Invalid entitlement list');
  const versions = new Set();
  return grants.map(grant => {
    if (typeof grant?.courseId !== 'string' || !grant.courseId || typeof grant.versionId !== 'string' || !grant.versionId || !['active','revoked'].includes(grant.status)) throw new Error('Invalid entitlement');
    const key = JSON.stringify([grant.courseId, grant.versionId]);
    if (versions.has(key)) throw new Error('Duplicate entitlement');
    versions.add(key);
    return { courseId: grant.courseId, versionId: grant.versionId, status: grant.status };
  });
}

export function grantForCourse(entitlements, course) {
  if (!Array.isArray(entitlements) || !course?.id) return undefined;
  const courseGrants = entitlements.filter(grant => grant.courseId === course.id);
  const exactActive = courseGrants.find(grant =>
    grant.versionId === course.versionId && grant.status === 'active');
  if (exactActive) return exactActive;
  // 课程按课程 ID 授权，版本只用于记录最初购买和不可变内容快照。
  const inherited = courseGrants.find(grant => grant.status === 'active');
  if (inherited) return {...inherited, versionId:course.versionId, inherited:true};
  return courseGrants.find(grant =>
    grant.versionId === course.versionId && grant.status === 'revoked') ||
    courseGrants.find(grant => grant.status === 'revoked');
}

export function previewAccount() {
  const userId = 'preview-learner';
  return readAccount({ id: userId, username: '演示学员' }, { total: 360 }, [
    { userId, courseId: 'storyboard-to-film', versionId: 'demo-storyboard-v1', status: 'active' },
    { userId, courseId: 'brand-visual-system', versionId: 'demo-brand-v1', status: 'revoked' },
  ]);
}
