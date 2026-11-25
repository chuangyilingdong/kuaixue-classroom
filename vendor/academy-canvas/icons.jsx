import Menu from '@icon-park/react/es/icons/HamburgerButton';
import Grid from '@icon-park/react/es/icons/AllApplication';
import Settings from '@icon-park/react/es/icons/SettingConfig';
import History from '@icon-park/react/es/icons/History';
import Sidebar from '@icon-park/react/es/icons/MenuFold';
import Close from '@icon-park/react/es/icons/Close';
import Check from '@icon-park/react/es/icons/Check';
import Minus from '@icon-park/react/es/icons/Minus';
import Undo from '@icon-park/react/es/icons/Undo';
import Redo from '@icon-park/react/es/icons/Redo';
import Fit from '@icon-park/react/es/icons/FullScreen';
import Upload from '@icon-park/react/es/icons/Upload';
import Plus from '@icon-park/react/es/icons/Plus';
import Locate from '@icon-park/react/es/icons/Target';
import Image from '@icon-park/react/es/icons/Picture';
import Video from '@icon-park/react/es/icons/Video';
import Music from '@icon-park/react/es/icons/Music';
import Text from '@icon-park/react/es/icons/FileText';
import Spark from '@icon-park/react/es/icons/Magic';
import Brush from '@icon-park/react/es/icons/Paint';
import Palette from '@icon-park/react/es/icons/Platte';
import Code from '@icon-park/react/es/icons/Code';
import Mic from '@icon-park/react/es/icons/Microphone';
import Monitor from '@icon-park/react/es/icons/Monitor';
import Gamepad from '@icon-park/react/es/icons/Gamepad';
import Globe from '@icon-park/react/es/icons/Globe';
import Share from '@icon-park/react/es/icons/Share';
import Cpu from '@icon-park/react/es/icons/Cpu';
import Flow from '@icon-park/react/es/icons/Connection';
import Book from '@icon-park/react/es/icons/BookOpen';
import Windows from '@icon-park/react/es/icons/Windows';
import Apple from '@icon-park/react/es/icons/Apple';
import Play from '@icon-park/react/es/icons/PlayOne';
import Pause from '@icon-park/react/es/icons/Pause';
import Volume from '@icon-park/react/es/icons/VolumeNotice';
import Mute from '@icon-park/react/es/icons/VolumeMute';
import Download from '@icon-park/react/es/icons/Download';
import Up from '@icon-park/react/es/icons/ArrowUp';
import User from '@icon-park/react/es/icons/User';
import Home from '@icon-park/react/es/icons/Home';
import Loading from '@icon-park/react/es/icons/LoadingOne';
import Attention from '@icon-park/react/es/icons/Attention';
import '@icon-park/react/styles/index.css';

const icons = {
  menu: Menu, grid: Grid, sliders: Settings, history: History, sidebar: Sidebar, close: Close,
  check: Check, dash: Minus, undo: Undo, redo: Redo, fit: Fit, upload: Upload, plus: Plus,
  locate: Locate, image: Image, video: Video, music: Music, text: Text, spark: Spark,
  brush: Brush, palette: Palette, code: Code, mic: Mic, monitor: Monitor, gamepad: Gamepad,
  globe: Globe, share: Share, cpu: Cpu, flow: Flow, book: Book, windows: Windows, apple: Apple,
  play: Play, pause: Pause, volume: Volume, mute: Mute, download: Download, up: Up, user: User,
  home: Home, loading: Loading, attention: Attention,
};

export function Icon({ name, size = 16, strokeWidth = 1.7, className }) {
  const Component = icons[name];
  return Component ? <Component className={className} size={size} theme="outline"
    strokeWidth={strokeWidth * 2} fill="currentColor" aria-hidden="true" spin={name === 'loading'} /> : null;
}
