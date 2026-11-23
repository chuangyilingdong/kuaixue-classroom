import {useCallback, useEffect, useState} from 'react';
import {BookOpen, Check, LoaderCircle, Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button.js';
import {cn} from '@/components/lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';
import {useZCodeSessionStore} from '@/store/zcodeSessionStore.js';
import {usePlatform} from '@/hooks/usePlatform.js';
import {useComposerTextInsertApplied} from '@/v4/useComposerTextInsertApplied.js';

type Preset = Readonly<{title?: unknown; text?: unknown}>;

function presetKey(preset: Preset, index: number) {
  const title = typeof preset.title === 'string' ? preset.title.trim() : '';
  const text = typeof preset.text === 'string' ? preset.text : '';
  return JSON.stringify([index, title, text]);
}

export function LingdongPresetsDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath?: string;
  workspaceIdentity?: string;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [insertedKeys, setInsertedKeys] = useState<Set<string>>(() => new Set());
  const [insertingKey, setInsertingKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const classroom = usePlatform().classroom;
  const waitForComposerTextInsertApplied = useComposerTextInsertApplied(
    workspacePath ?? '',
    workspaceIdentity,
  );

  const refresh = useCallback(async () => {
    const value = classroom ? await classroom.getPresets() : undefined;
    setPresets(Array.isArray(value)
      ? value.filter((item): item is Preset => typeof item === 'object' && item !== null)
      : []);
  }, [classroom]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const insert = async (preset: Preset, key: string) => {
    const text = typeof preset.text === 'string' ? preset.text.trim() : '';
    if (!text || !workspacePath || insertingKey) return;
    const requestId = useZCodeSessionStore.getState().requestComposerTextInsert(
      workspacePath,
      text,
      workspaceIdentity,
      undefined,
      'prepend-if-missing',
    );
    setInsertingKey(key);
    setMessage('正在插入…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const applied = await waitForComposerTextInsertApplied(requestId, controller.signal);
      if (applied) {
        setInsertedKeys(current => new Set(current).add(key));
        setMessage('已插入当前任务输入框。');
      } else {
        setMessage('没能插入到输入框：请先回到该任务页面，再点一次。');
      }
    } catch {
      setMessage('没能插入到输入框：请先回到该任务页面，再点一次。');
    } finally {
      clearTimeout(timeout);
      setInsertingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-ui-lg">
            <BookOpen className="size-5" />
            课堂提示词预设
          </DialogTitle>
          <DialogDescription>
            平台下发的课堂预设会插入当前任务草稿，不会自动发送。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[360px] space-y-2 overflow-auto">
          {presets.length === 0 ? (
            <div className="p-8 text-center text-ui-sm text-foreground-subtle">
              当前课堂没有提示词预设。
            </div>
          ) : null}
          {presets.map((preset, index) => {
            const title =
              typeof preset.title === 'string' && preset.title.trim()
                ? preset.title
                : `预设 ${index + 1}`;
            const text = typeof preset.text === 'string' ? preset.text : '';
            const key = presetKey(preset, index);
            const inserted = insertedKeys.has(key);
            const inserting = insertingKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => void insert(preset, key)}
                aria-pressed={inserted}
                data-preset-key={key}
                data-inserted={inserted ? 'true' : 'false'}
                disabled={insertingKey !== null}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  inserted
                    ? 'border-success/45 bg-success/10 hover:bg-success/15'
                    : 'border-border hover:bg-surface-hover',
                  inserting && 'opacity-75',
                )}
              >
                {inserted ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-ui-sm font-medium">{title}</span>
                    {inserting ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-ui-xs text-foreground-subtle">
                        <LoaderCircle className="size-3.5 animate-spin" />
                        插入中
                      </span>
                    ) : inserted ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-ui-xs font-medium text-success">
                        <Check className="size-3" />
                        已插入
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap text-ui-xs text-foreground-subtle line-clamp-3">
                    {text}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {message ? <div className="rounded-lg bg-accent px-3 py-2 text-ui-sm">{message}</div> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
