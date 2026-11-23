export function requireVibeOrigin(value, separateFrom) {
  const origin = typeof value === 'string' && URL.canParse(value) ? new URL(value).origin : null;
  if (!origin || !origin.startsWith('https://') || origin === separateFrom || (value !== origin && value !== `${origin}/`)) {
    throw Error('VITE_KUAIXUE_VIBE_ORIGIN 必须是独立的 HTTPS 工作区源，不含路径、参数或凭据。');
  }
  return origin;
}
