import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import {LingdongPresetsDialog} from 'kuaixue-presets-dialog';
export function WorkspaceSidebarFooter({workspacePath,workspaceIdentity,className = ''}) {
  const [open,setOpen] = useState(false);
  return <footer className={`flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4 ${className}`}><button type="button" className="flex items-center gap-2 px-2 py-1.5 text-ui-sm" onClick={() => setOpen(true)}><BookOpen size={16}/>课堂提示词预设</button>
    <LingdongPresetsDialog open={open} onOpenChange={setOpen} workspacePath={workspacePath} workspaceIdentity={workspaceIdentity}/></footer>;
}
