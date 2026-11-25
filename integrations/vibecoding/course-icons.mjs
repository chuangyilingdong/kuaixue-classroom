import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

// Course-specific SVG substitution leaves custom diagram primitives available to the upstream UI.
const equivalents = {
  Activity: 'Heartbeat', AlarmClock: 'AlarmClock', AlertCircle: 'Attention', AlertTriangle: 'Caution',
  AlignCenter: 'AlignTextCenter', AlignLeft: 'AlignTextLeft', AlignRight: 'AlignTextRight', Anchor: 'Anchor',
  AppWindow: 'ApplicationMenu', Archive: 'Box', ArrowDownToLine: 'Download', ArrowDown: 'ArrowDown',
  ArrowLeftFromLine: 'ArrowLeft', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  ArrowRightLeft: 'Switch', ArrowRightToLine: 'ArrowRight', ArrowUpFromLine: 'Upload', ArrowUpToLine: 'Upload',
  ArrowUp: 'ArrowUp', ArrowUpRight: 'ArrowRightUp', Astroid: 'Star', AtSign: 'AtSign', Ban: 'Forbid',
  BarChart3: 'ChartHistogram', Bell: 'Remind', Blend: 'Contrast', Blocks: 'AllApplication',
  Book: 'Book', Bookmark: 'Bookmark', BookOpen: 'BookOpen', BookOpenText: 'BookOpen',
  Bot: 'Robot', BotMessageSquare: 'Robot', Box: 'Box', Brain: 'Brain', BriefcaseBusiness: 'Briefcase',
  Bug: 'Bug', Cable: 'Connection', CalendarClock: 'Schedule', CalendarDays: 'Calendar',
  Camera: 'Camera', ChartBar: 'ChartHistogram', ChartLine: 'ChartLine', ChartPie: 'ChartPie',
  Check: 'Check', CheckCircle2: 'CheckOne', CheckCircle: 'CheckOne',
  ChevronDown: 'Down', ChevronLeft: 'Left', ChevronRight: 'Right', ChevronsDown: 'DoubleDown',
  ChevronsUpDown: 'Sort', ChevronUp: 'Up', Circle: 'Round', CircleAlert: 'Attention',
  CircleCheck: 'CheckOne', CircleCheckBig: 'CheckOne', CircleDashed: 'LoadingOne',
  CircleDot: 'RadioTwo', CircleHelp: 'Help', CircleMinus: 'ReduceOne', CirclePlay: 'Play',
  CirclePlus: 'AddOne', CircleSlash2: 'Forbid', CircleSmall: 'Round', CircleStop: 'PauseOne',
  CircleUserRound: 'User', CircleX: 'CloseOne', Clipboard: 'Clipboard', ClipboardCheck: 'Checklist',
  ClipboardPaste: 'Clipboard', ClipboardPenLine: 'Edit', Clock3: 'Time', Clock: 'Time', ClockAlert: 'AlarmClock',
  Cloud: 'Cloudy', CloudAlert: 'Cloudy', CloudOff: 'Cloudy', CloudUpload: 'UploadWeb',
  Code: 'Code', Code2: 'Code', Copy: 'Copy', CornerDownLeft: 'EnterKey', CornerDownRight: 'ArrowRight',
  Cpu: 'Cpu', Crown: 'Crown', Database: 'DatabaseNetwork', Dot: 'Dot', Download: 'Download',
  Earth: 'Earth', Ellipsis: 'More', Eraser: 'Erase', ExternalLink: 'LinkOut',
  Eye: 'PreviewOpen', EyeOff: 'PreviewClose', FileClock: 'FileDate', FileCode2: 'FileCode', FileCode: 'FileCode',
  FileDiff: 'FileText', FileDown: 'FileDownload', File: 'FileText', FileKey: 'FileLock', FileOutput: 'FileExport',
  Files: 'Files', FileSearch: 'FileSearch', FileText: 'FileText', FileWarning: 'FileFailed',
  Flame: 'Fire', FlaskConical: 'Flask', Folder: 'FolderOpen', FolderGit2: 'FolderCode',
  FolderMinus: 'FolderMinus', FolderOpen: 'FolderOpen', FolderPlus: 'FolderPlus', Folders: 'FolderOpen',
  FolderSymlink: 'FolderConversion', FolderX: 'FolderFailed', Gauge: 'Dashboard', Gift: 'Gift',
  GitBranch: 'Branch', GitCommit: 'Neural', GitCommitVertical: 'Neural', GitGraph: 'Branch',
  GitMerge: 'Merge', GitPullRequest: 'PullRequests', Globe: 'Globe', Globe2: 'Globe', Goal: 'Target',
  GraduationCap: 'BachelorCap', GripHorizontal: 'Drag', GripVertical: 'Drag', Hand: 'HandDrag',
  HardDrive: 'HardDisk', Hash: 'HashtagKey', History: 'History', Hourglass: 'Hourglass',
  ImageDown: 'DownloadPicture', Image: 'Picture', ImageOff: 'Picture', ImagePlus: 'AddPicture',
  Import: 'ImportAndExport', Inbox: 'Inbox', Info: 'Info', Keyboard: 'Keyboard', KeyRound: 'Key',
  Laptop: 'Laptop', Layers: 'Layers', LayoutDashboard: 'LayoutTwo', Library: 'Bookshelf',
  Lightbulb: 'Lamp', Link: 'Link', List: 'List', ListChecks: 'Checklist', ListChevronsDownUp: 'List',
  ListChevronsUpDown: 'List', ListFilter: 'Filter', ListTodo: 'Checklist', ListTree: 'TreeList',
  LoaderCircle: 'LoadingOne', LocateFixed: 'Local', LockKeyhole: 'Lock', LogIn: 'Login', LogOut: 'Logout',
  Map: 'MapDraw', MapPin: 'Local', Maximize: 'FullScreen', Maximize2: 'FullScreen',
  Megaphone: 'Announcement', MessageCircle: 'Comments', MessageCircleOff: 'Comment', MessageCirclePlus: 'Comment',
  MessageCircleQuestion: 'Help', MessageCircleReply: 'Comment', MessageSquare: 'Comment',
  MessageSquarePlus: 'Comment', MessageSquareText: 'Comment', MessagesSquare: 'Comments',
  Mic: 'Microphone', Minimize2: 'OffScreen', Minus: 'Minus', Monitor: 'Monitor', MonitorCog: 'SettingComputer',
  MonitorSmartphone: 'Devices', MonitorUp: 'Monitor', Moon: 'Moon', MoreHorizontal: 'More',
  MousePointer2: 'Cursor', MousePointerClick: 'Click', Music: 'Music', Music2: 'Music',
  Network: 'Connection', NotepadText: 'Notes', OctagonX: 'CloseOne', Package: 'Box', PackageOpen: 'Box',
  Palette: 'Platte', PanelLeftClose: 'MenuFold', PanelLeftOpen: 'MenuUnfold', PanelRight: 'RightBar',
  PanelRightClose: 'MenuFold', PanelRightOpen: 'MenuUnfold', PanelsTopLeft: 'LayoutTwo',
  Paperclip: 'Attachment', PauseCircle: 'PauseOne', Pause: 'Pause', Pen: 'Write', Pencil: 'Edit',
  PencilRuler: 'Ruler', PenTool: 'Pen', Pin: 'Pin', PinOff: 'Pin', Play: 'PlayOne',
  Plug: 'Plug', Plus: 'Plus', PlusCircle: 'AddOne', Power: 'Power', Presentation: 'Ppt',
  Puzzle: 'Puzzle', QrCode: 'TwoDimensionalCode', Quote: 'Quote', Redo2: 'Redo', RefreshCcw: 'Refresh',
  RefreshCw: 'Refresh', Repeat2: 'LoopOnce', Reply: 'Return', Rocket: 'Rocket', RotateCcw: 'Rotate',
  RotateCw: 'Refresh', Route: 'Route', Save: 'Save', Scale: 'Balance', Scan: 'Scan', ScrollText: 'FileText',
  Search: 'Search', Send: 'Send', Server: 'Server', Settings: 'Setting', Settings2: 'SettingConfig',
  Share2: 'Share', Share: 'Share', Shield: 'Shield', ShieldAlert: 'Shield', ShieldCheck: 'Protect',
  ShieldQuestion: 'Shield', SlidersHorizontal: 'SettingConfig', Smartphone: 'Iphone',
  Sparkle: 'Magic', Sparkles: 'Magic', Square: 'Square', SquareArrowOutUpRight: 'LinkOut',
  SquareArrowRightEnter: 'EnterKey', SquareCode: 'CodeComputer', SquareKanban: 'LayoutThree',
  SquareMousePointer: 'Cursor', SquareSlash: 'Slash', SquareTerminal: 'Terminal',
  Store: 'Shop', Sun: 'SunOne', Table: 'Table', Tag: 'Tag', Target: 'Target',
  Terminal: 'Terminal', TerminalSquare: 'Terminal', ThumbsDown: 'Bad', ThumbsUp: 'Good',
  Timer: 'Timer', Trash2: 'Delete', TrendingUpDown: 'TrendingUp', TrendingUp: 'TrendingUp',
  TriangleAlert: 'Caution', Type: 'Text', Undo2: 'Undo', Unlink: 'Unlink', Unplug: 'Disconnect',
  Upload: 'Upload', UploadCloud: 'UploadWeb', Usb: 'Usb', User: 'User', UserCheck2: 'User',
  UserRound: 'User', Users: 'Peoples', Video: 'Video', Volume2: 'VolumeNotice',
  Wand: 'MagicWand', WandSparkles: 'MagicWand', Waypoints: 'Connection', Webhook: 'Connection',
  WifiOff: 'Wifi', Workflow: 'Connection', WrapText: 'Text', Wrench: 'Tool', X: 'Close',
  XCircle: 'CloseOne', Zap: 'Lightning', ZoomIn: 'ZoomIn', ZoomOut: 'ZoomOut',
};

export function courseIconsPlugin(uiRoot) {
  const require = createRequire(import.meta.url);
  const upstream = createRequire(resolve(uiRoot, 'package.json'));
  const lucide = upstream.resolve('lucide-react');
  const iconRoot = resolve(require.resolve('@icon-park/react/package.json'), '../es/icons');
  const id = '\0kuaixue-course-icons';
  return {
    name: 'kuaixue-course-iconpark',
    enforce: 'pre',
    resolveId(source) { if (source === 'lucide-react') return id; },
    async load(source) {
      if (source !== id) return null;
      const lucideSource = await readFile(lucide, 'utf8');
      const available = new Set((await readdir(iconRoot)).filter(name => name.endsWith('.js')).map(name => name.slice(0, -3)));
      const names = [...new Set([...lucideSource.matchAll(/exports\.(\w+)\s*=/g)].map(match => match[1]))];
      const templates = new Map();
      const exports = [];
      for (const name of names) {
        const base = name.replace(/Icon$/, '');
        const selected = equivalents[base];
        const target = selected && available.has(selected) ? selected : available.has(base) ? base : null;
        if (!target) continue;
        if (!templates.has(target)) {
          const Component = require(`@icon-park/react/lib/icons/${target}`).default;
          const markup = theme => renderToStaticMarkup(React.createElement(Component, {
            size: 24, strokeWidth: 3.6, fill: 'currentColor', theme,
          })).match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
          templates.set(target, [markup('outline'), markup('filled')]);
        }
        exports.push(`export const ${name} = /*#__PURE__*/ icon(${JSON.stringify(target)});`);
      }
      return `import React from ${JSON.stringify(upstream.resolve('react'))};
export * from ${JSON.stringify(lucide)};
const paths = ${JSON.stringify(Object.fromEntries(templates))};
function icon(name) {
  return React.forwardRef(function CourseIcon({size = 24, strokeWidth = 1.8, fill, color, absoluteStrokeWidth, ...props}, ref) {
    const content = paths[name][fill && fill !== 'none' ? 1 : 0].replaceAll('stroke-width="3.6"', 'stroke-width="' + strokeWidth * 2 + '"');
    return React.createElement('svg', {...props, ref, width: size, height: size, viewBox: '0 0 48 48',
      fill: 'none', color, 'aria-hidden': true, 'data-iconpark': name, dangerouslySetInnerHTML: {__html: content}});
  });
}
${exports.join('\n')}`;
    },
  };
}
