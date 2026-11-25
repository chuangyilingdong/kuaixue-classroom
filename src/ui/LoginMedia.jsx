import video from '../../electron/classroom-login.mp4';
import poster from '../../electron/classroom-login-poster.webp';

export default function LoginMedia() {
  return <div className="kx-login-media" aria-hidden="true">
    <div className="kx-login-ambient" style={{backgroundImage: `url("${poster}")`}} />
    <video autoPlay loop muted playsInline preload="auto" poster={poster} src={video} tabIndex={-1} />
  </div>;
}
