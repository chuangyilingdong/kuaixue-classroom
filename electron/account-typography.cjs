const {readFileSync} = require('node:fs');
const path = require('node:path');

const typography = readFileSync(path.join(__dirname, 'classroom-font.css'), 'utf8');
const loginPresentation = readFileSync(path.join(__dirname, 'classroom-login.css'), 'utf8');
const media = {
  videoBase64: readFileSync(path.join(__dirname, 'classroom-login.mp4')).toString('base64'),
  poster: 'data:image/webp;base64,' + readFileSync(path.join(__dirname, 'classroom-login-poster.webp')).toString('base64'),
  logo: 'data:image/png;base64,' + readFileSync(path.join(__dirname, 'app-icon.png')).toString('base64'),
};
const brandPresentation = `(() => {
  const media = ${JSON.stringify(media)};
  const page = document.querySelector('.kx-login-page');
  if (!page) return;
  let panel = page.querySelector('.kx-login-media');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'kx-login-media';
    panel.setAttribute('aria-hidden', 'true');
    page.prepend(panel);
  }
  let ambient = panel.querySelector('.kx-login-ambient');
  if (!ambient) {
    ambient = document.createElement('div');
    ambient.className = 'kx-login-ambient';
    panel.prepend(ambient);
  }
  ambient.style.backgroundImage = 'url("' + media.poster + '")';
  let video = panel.querySelector('video');
  if (!video) { video = document.createElement('video'); panel.append(video); }
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'auto';
  video.tabIndex = -1;
  video.poster = media.poster;
  const bytes = Uint8Array.from(atob(media.videoBase64), character => character.charCodeAt(0));
  const videoUrl = URL.createObjectURL(new Blob([bytes], {type: 'video/mp4'}));
  video.src = videoUrl;
  const play = () => { if (!document.hidden) video.play().catch(() => {}); };
  video.addEventListener('canplay', play);
  document.addEventListener('visibilitychange', play);
  window.addEventListener('pageshow', play);
  window.addEventListener('pagehide', event => { if (!event.persisted) URL.revokeObjectURL(videoUrl); }, {once: true});
  play();
  const logo = page.querySelector('.kx-logo');
  if (logo) logo.src = media.logo;
})()`;
function applyAccountTypography(contents, origin) {
  let styling = Promise.resolve();
  contents.on('dom-ready', () => {
    const url = new URL(contents.getURL());
    if (url.origin !== origin) return;
    styling = contents.insertCSS(typography);
    if (url.pathname === '/kuaixue/sign-in/') {
      styling = styling.then(() => contents.insertCSS(loginPresentation))
        .then(() => contents.executeJavaScript(brandPresentation));
    }
    void styling.catch(() => {});
  });
  return () => styling;
}
module.exports = {applyAccountTypography};
