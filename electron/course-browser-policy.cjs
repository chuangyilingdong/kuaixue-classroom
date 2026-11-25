const COURSE_BROWSER_PARTITION = 'persist:zcode-embedded-browser';
const SAFE_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_POPUP_DISPOSITIONS = new Set([
  'default',
  'foreground-tab',
  'background-tab',
  'new-window',
  'other',
]);

function isSafeCourseBrowserUrl(value) {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return SAFE_BROWSER_PROTOCOLS.has(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeCourseBrowserPopup(value) {
  if (!value || typeof value !== 'object' || !isSafeCourseBrowserUrl(value.url)) return null;
  return {
    url:value.url,
    disposition:SAFE_POPUP_DISPOSITIONS.has(value.disposition) ? value.disposition : 'other',
    ...(typeof value.workspaceKey === 'string' ? {workspaceKey:value.workspaceKey} : {}),
    ...(typeof value.sessionId === 'string' ? {sessionId:value.sessionId} : {}),
    ...(typeof value.sourceTabId === 'string' ? {sourceTabId:value.sourceTabId} : {}),
    ...(typeof value.browserId === 'string' ? {browserId:value.browserId} : {}),
  };
}

module.exports = {
  COURSE_BROWSER_PARTITION,
  isSafeCourseBrowserUrl,
  normalizeCourseBrowserPopup,
};
