import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Fixed executable code only. Notification text is JSON on stdin, never
// interpolated into PowerShell. -EncodedCommand expects UTF-16LE base64.
const windowsToastCommand = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$appId = 'Pi.CodingAgent.Notifications'
$key = 'HKCU:\Software\Classes\AppUserModelId\' + $appId
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name DisplayName -Value 'Pi Coding Agent' -PropertyType String -Force | Out-Null
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>')
$text = $xml.GetElementsByTagName('text')
$text.Item(0).AppendChild($xml.CreateTextNode([string]$payload.title)) | Out-Null
$text.Item(1).AppendChild($xml.CreateTextNode([string]$payload.body)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.Tag = [string]$payload.tag
$toast.Group = 'pi'
$toast.ExpirationTime = [DateTimeOffset]::Now.AddHours(1)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
$notifier.Show($toast)
[Console]::Out.WriteLine('Toast submitted')
`, "utf16le").toString("base64");

export function cleanText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "[code]").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

// Only the label of a settled response is heuristic; question-tool triggers are exact.
export function isQuestion(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").trim();
  return /[?？]/u.test(prose.slice(-600)) || /(?:please (?:choose|confirm|select|tell me)|let me know (?:which|whether|if you)|需要你(?:确认|选择)|请(?:确认|选择|告诉我))/i.test(prose.slice(-600));
}

export function sendWindowsToast(title: string, body: string, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", windowsToastCommand],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve();
      });
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ title, body, tag }));
  });
}

// KDE supports notification body markup; do not interpret snippets as markup.
export function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sendLinuxNotification(title: string, body: string, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Uses session D-Bus on Plasma Wayland and X11; never invoke a shell or
    // wait for dismissal. The coalescing hint is advisory, not guaranteed.
    execFile("notify-send", [
      "--app-name=Pi", "--icon=dialog-information", "--urgency=normal",
      "--hint=string:sound-name:message-new-instant",
      `--hint=string:x-canonical-private-synchronous:pi-${tag}`,
      "--", title, escapeMarkup(body),
    ], { timeout: 15000, maxBuffer: 65536 }, (error, _stdout, stderr) => {
      if (error) {
        const detail = (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "notify-send is not installed. Install libnotify-bin (Debian/Ubuntu) or libnotify (Fedora/Arch)."
          : stderr.trim() || error.message;
        reject(new Error(`${detail} Run Pi inside your KDE desktop session with access to its session D-Bus.`));
      } else resolve();
    });
  });
}

export default function notifications(pi: ExtensionAPI) {
  let enabled = process.env.PI_NOTIFICATIONS !== "0";
  let finalText = "";
  let failed = false;
  let warned = false;
  const pending = new Set<Promise<void>>();

  function notify(kind: string, body: string, ctx: ExtensionContext): Promise<void> {
    if (!enabled || !["win32", "linux"].includes(process.platform) || !ctx.hasUI) return Promise.resolve();
    const tag = createHash("sha256").update(ctx.sessionManager.getSessionId()).digest("hex").slice(0, 16);
    const send = process.platform === "win32" ? sendWindowsToast : sendLinuxNotification;
    const task = send(`Pi — ${kind}`, cleanText(body) || `Waiting in ${basename(ctx.cwd)}`, tag)
      .catch((error) => {
        if (!warned) {
          warned = true;
          ctx.ui.notify(`Desktop notification failed: ${error.message}`, "warning");
        }
      });
    pending.add(task);
    void task.finally(() => pending.delete(task));
    return task;
  }

  pi.on("before_agent_start", () => { finalText = ""; failed = false; });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    finalText = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    failed = event.message.stopReason === "error";
  });
  // UI prompt events also cover user-opened menus, so never notify on them.
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "ask_user" && event.toolName !== "ask_user_question") return;
    const input = event.input;
    const question = event.toolName === "ask_user_question" && Array.isArray(input.questions)
      ? input.questions[0]?.question
      : input.question;
    // Do not delay the question tool while the notification process starts.
    void notify("Question / input needed", typeof question === "string" && question.trim()
      ? question : "Pi is waiting for your input.", ctx);
  });
  pi.on("agent_settled", async (event, ctx) => {
    if (event.aborted) return;
    await notify(failed ? "Turn failed" : isQuestion(finalText) ? "Question / input needed" : "Turn finished", finalText || "Ready for your next message.", ctx);
  });
  pi.on("session_shutdown", async () => { await Promise.allSettled([...pending]); });

  pi.registerCommand("notifications", {
    description: "Desktop notifications: test, on, off, or status",
    handler: async (args, ctx) => {
      switch (args.trim()) {
        case "on": enabled = true; warned = false; break;
        case "off": enabled = false; break;
        case "test":
          if (!enabled || !ctx.hasUI || !["win32", "linux"].includes(process.platform)) {
            ctx.ui.notify("Notification test skipped: enable notifications, use TUI/RPC mode, and run on Windows or Linux.", "warning");
            return;
          }
          warned = false;
          await notify("Notification test", "Pi desktop notifications are working.", ctx);
          return;
        case "": case "status": break;
        default: ctx.ui.notify("Usage: /notifications [test|on|off|status]", "info"); return;
      }
      const backend = process.platform === "win32" ? "Windows toast" : process.platform === "linux" ? "Linux/KDE via notify-send" : "unsupported platform";
      ctx.ui.notify(`Desktop notifications ${enabled ? "on" : "off"} (${backend}; interactive and RPC modes).`, "info");
    },
  });
}
