// Watches which window is in front and minimizes or restores windows on request
// (APP-03, APP-07). A small C# helper runs inside Windows PowerShell, so the app
// needs no native module. It writes one JSON line per event:
//   { "type": "foreground", "hwnd": 1234, "pid": 56, "path": "C:\\...\\Code.exe" | null }
//   { "type": "minimized", "hwnd": 1234, "ok": true }
// and reads commands on stdin: "min <hwnd>" and "restore <hwnd>".
// The foreground line repeats every two seconds so a limit that starts while an
// app is already in front still sees it.
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const HELPER = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FixMyselfWatcher {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

  static readonly object Gate = new object();

  static void Emit(string json) {
    lock (Gate) { Console.Out.WriteLine(json); Console.Out.Flush(); }
  }

  static string Quote(string text) {
    if (text == null) return "null";
    var builder = new StringBuilder("\"");
    foreach (char c in text) {
      if (c == '"' || c == '\\') builder.Append('\\').Append(c);
      else if (c < ' ') builder.Append("\\u").Append(((int)c).ToString("x4"));
      else builder.Append(c);
    }
    return builder.Append('"').ToString();
  }

  static string PathOf(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return null;
    try {
      var name = new StringBuilder(1024);
      int size = name.Capacity;
      return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : null;
    } finally {
      CloseHandle(process);
    }
  }

  static void Commands() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      string[] parts = line.Trim().Split(' ');
      long value;
      if (parts.Length != 2 || !long.TryParse(parts[1], out value)) continue;
      IntPtr window = new IntPtr(value);
      if (!IsWindow(window)) continue;
      if (parts[0] == "min") {
        ShowWindow(window, 6);
        Thread.Sleep(150);
        Emit("{\"type\":\"minimized\",\"hwnd\":" + value + ",\"ok\":" + (IsIconic(window) ? "true" : "false") + "}");
      } else if (parts[0] == "restore") {
        ShowWindow(window, 9);
        SetForegroundWindow(window);
      }
    }
    Environment.Exit(0);
  }

  public static void Run() {
    var reader = new Thread(Commands);
    reader.IsBackground = true;
    reader.Start();
    IntPtr last = IntPtr.Zero;
    int beat = 0;
    while (true) {
      IntPtr window = GetForegroundWindow();
      if (window != last || ++beat >= 8) {
        beat = 0;
        last = window;
        uint pid = 0;
        if (window != IntPtr.Zero) GetWindowThreadProcessId(window, out pid);
        string path = pid == 0 ? null : PathOf(pid);
        Emit("{\"type\":\"foreground\",\"hwnd\":" + window.ToInt64() + ",\"pid\":" + pid + ",\"path\":" + Quote(path) + "}");
      }
      Thread.Sleep(250);
    }
  }
}
`;

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  `Add-Type -Language CSharp -TypeDefinition @'\n${HELPER}\n'@`,
  '[FixMyselfWatcher]::Run()'
].join('\n');

// Starts the helper. Returns { send(command), stop() }; calls onEvent for each
// parsed line and onExit(code) when the helper ends.
function startWatcher({ onEvent, onExit }) {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let stopped = false;
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event && typeof event === 'object') onEvent(event);
  });
  child.on('error', () => { if (!stopped) onExit(-1); stopped = true; });
  child.on('exit', (code) => { if (!stopped) onExit(code ?? -1); stopped = true; });
  // A helper that dies between two commands must not crash the app; its exit
  // event restarts it.
  child.stdin.on('error', () => {});
  return {
    send(command) {
      if (stopped || !child.stdin.writable) return;
      try {
        child.stdin.write(command + '\n');
      } catch {
        // Reported through the exit event.
      }
    },
    stop() {
      stopped = true;
      child.stdin.end();
      child.kill();
    }
  };
}

module.exports = { startWatcher };
