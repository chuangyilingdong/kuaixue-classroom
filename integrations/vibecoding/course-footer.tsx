import {useState} from 'react';
import {BookOpen} from 'lucide-react';
import {LingdongPresetsDialog} from './LingdongPresetsDialog.js';
export function WorkspaceSidebarFooter({workspacePath,workspaceIdentity}) {
  const [open,setOpen] = useState(false);
  return <footer className="p-2"><button type="button" className="flex items-center gap-2 px-2 py-1.5 text-ui-sm" onClick={() => setOpen(true)}><BookOpen size={16}/>课堂提示词预设</button>
    <LingdongPresetsDialog open={open} onOpenChange={setOpen} workspacePath={workspacePath} workspaceIdentity={workspaceIdentity}/></footer>;
}
