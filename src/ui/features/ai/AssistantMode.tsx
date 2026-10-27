import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ModeSwitch } from "@/components/ModeSwitch";
import { useAiStore } from "@/lib/ai-store";
import {
  AI_MAX,
  AI_MIN,
  THREADS_MAX,
  THREADS_MIN,
  useLayout,
} from "@/lib/layout";
import { useAppStore } from "@/lib/store";
import { PlaygroundPane } from "@/features/playground/PlaygroundTab";
import { AiPanel } from "./AiPanel";
import { ThreadList, ThreadRail } from "./ThreadList";

/** Assistant mode: chat threads, the active chat, and its playground. Nothing else. */
export function AssistantMode() {
  const activeId = useAiStore((s) => s.activeId);
  const playground = useAppStore((s) =>
    activeId ? (s.playgrounds[activeId] ?? null) : null,
  );
  const layout = useLayout();
  return (
    <>
      {layout.threadsCollapsed && <ThreadRail />}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 min-w-0 flex-1"
      >
        {!layout.threadsCollapsed && (
          <>
            <ResizablePanel
              id="threads"
              defaultSize={layout.threadsWidth}
              minSize={THREADS_MIN}
              maxSize={THREADS_MAX}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size, _id, prev) =>
                prev && layout.setThreadsWidth(size.inPixels)
              }
            >
              <ThreadList />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel
          id="chat"
          defaultSize={layout.aiWidth}
          minSize={AI_MIN}
          maxSize={AI_MAX}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size, _id, prev) =>
            prev && layout.setAiWidth(size.inPixels)
          }
        >
          <AiPanel />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="playground" minSize={360} className="min-w-0">
          <PlaygroundPane playground={playground} actions={<ModeSwitch />} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}
