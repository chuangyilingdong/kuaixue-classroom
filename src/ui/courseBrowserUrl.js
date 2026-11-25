const HOME_URL = 'about:blank';

export function normalizeCourseBrowserUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return HOME_URL;
  if (text === HOME_URL) return text;
  const explicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const explicitHttp = /^https?:\/\//i.test(text);
  const hostAndPort = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,}):\d+(?:[/?#]|$)/i.test(text);
  if (explicitScheme && !explicitHttp && !hostAndPort) return '';
  const local = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i.test(text);
  const candidate = explicitHttp
    ? text
    : `${local ? 'http' : 'https'}://${text}`;
  try {
    const url = new URL(candidate);
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
