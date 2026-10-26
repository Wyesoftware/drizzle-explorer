import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { Workspace } from "@/features/workspace/Workspace";
import { StatusBar } from "@/components/StatusBar";
import { DialogHost } from "@/features/dialogs/DialogHost";
import { AiPanel } from "@/features/ai/AiPanel";
import { useAiStore } from "@/lib/ai-store";
import { useMenuActions } from "@/lib/menu-events";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export function App() {
  const aiOpen = useAiStore((s) => s.open);
  useMenuActions();
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="flex h-screen w-screen flex-col bg-background text-foreground">
            <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={300} minSize={200} maxSize={640}>
                <Sidebar />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel minSize={400} className="min-w-0">
                <Workspace />
              </ResizablePanel>
              {aiOpen && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={540} minSize={440} maxSize={960}>
                    <AiPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
            <StatusBar />
          </div>
          <DialogHost />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
