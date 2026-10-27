import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar, SidebarRail } from "@/features/sidebar/Sidebar";
import { Workspace } from "@/features/workspace/Workspace";
import { StatusBar } from "@/components/StatusBar";
import { DialogHost } from "@/features/dialogs/DialogHost";
import { AssistantMode } from "@/features/ai/AssistantMode";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { SIDEBAR_MAX, SIDEBAR_MIN, useLayout } from "@/lib/layout";
import { useMenuActions } from "@/lib/menu-events";
import { useAppStore } from "@/lib/store";
import { queryClient } from "@/lib/query-client";

export function App() {
  const settings = useAppStore((s) => s.settings);
  const layout = useLayout();
  useMenuActions();
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="flex h-screen w-screen flex-col bg-background text-foreground">
            <div className="relative flex min-h-0 flex-1">
              {/* Two separate modes (lib/layout.ts): explore = sidebar + tabs, assistant = chat + playground. */}
              {layout.mode === "assistant" ? (
                <AssistantMode />
              ) : (
                <>
                  {layout.sidebarCollapsed && <SidebarRail />}
                  <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
                    {!layout.sidebarCollapsed && (
                      <>
                        <ResizablePanel
                          id="sidebar"
                          defaultSize={layout.sidebarWidth}
                          minSize={SIDEBAR_MIN}
                          maxSize={SIDEBAR_MAX}
                          groupResizeBehavior="preserve-pixel-size"
                          onResize={(size, _id, prev) => prev && layout.setSidebarWidth(size.inPixels)}
                        >
                          <Sidebar />
                        </ResizablePanel>
                        <ResizableHandle />
                      </>
                    )}
                    <ResizablePanel id="workspace" minSize={400} className="min-w-0">
                      <Workspace />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </>
              )}
              {/* Settings cover the workspace instead of living in a tab; everything underneath stays mounted. */}
              {settings && (
                <div className="absolute inset-0 z-20 bg-background">
                  <SettingsPage section={settings} />
                </div>
              )}
            </div>
            <StatusBar />
          </div>
          <DialogHost />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
