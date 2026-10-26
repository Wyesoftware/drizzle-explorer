import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { errorMessage } from "@/lib/rpc";

export function ErrorBanner({ error, title = "Error" }: { error: unknown; title?: string }) {
  return (
    <Alert variant="destructive" className="m-2">
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <pre className="font-mono text-xs whitespace-pre-wrap break-words">{errorMessage(error)}</pre>
      </AlertDescription>
    </Alert>
  );
}
