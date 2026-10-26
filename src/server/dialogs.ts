/** Native file dialogs. The webview library has none, so we shell out to OS-provided tools. */

export async function pickFile(options: { title?: string; save?: boolean } = {}): Promise<string | null> {
  const title = options.title ?? (options.save ? "Save database file" : "Open database file");
  switch (process.platform) {
    case "darwin": {
      const script = options.save
        ? `POSIX path of (choose file name with prompt ${appleString(title)})`
        : `POSIX path of (choose file with prompt ${appleString(title)})`;
      return runCommand(["osascript", "-e", script]);
    }
    case "linux": {
      if (await hasBinary("zenity")) {
        const args = ["zenity", "--file-selection", `--title=${title}`];
        if (options.save) args.push("--save", "--confirm-overwrite");
        return runCommand(args);
      }
      if (await hasBinary("kdialog")) {
        return runCommand(["kdialog", options.save ? "--getsavefilename" : "--getopenfilename", process.env.HOME ?? "."]);
      }
      return null;
    }
    case "win32": {
      const dialog = options.save ? "SaveFileDialog" : "OpenFileDialog";
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        `$d = New-Object System.Windows.Forms.${dialog}`,
        `$d.Title = '${title.replace(/'/g, "''")}'`,
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }",
      ].join("; ");
      return runCommand(["powershell", "-NoProfile", "-Command", script]);
    }
    default:
      return null;
  }
}

function appleString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function hasBinary(name: string): Promise<boolean> {
  return Bun.which(name) !== null;
}

async function runCommand(cmd: string[]): Promise<string | null> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return null; // user cancelled
  const path = stdout.trim();
  return path.length ? path : null;
}
