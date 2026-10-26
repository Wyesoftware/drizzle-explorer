import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Code blocks should not appear in chat (the playground is for that); keep them collapsed as a safety net. */
function CollapsedPre({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border border-dashed text-xs">
      <button type="button" className="w-full px-2 py-1 text-left text-muted-foreground hover:bg-muted/60" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} code block (the assistant should put this in the playground)
      </button>
      {open && <pre className="overflow-auto border-t bg-muted/50 p-2 font-mono text-[11px]">{children}</pre>}
    </div>
  );
}

/** Assistant answers: GFM markdown (tables, inline code) styled for the chat panel. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <CollapsedPre>{children}</CollapsedPre> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
