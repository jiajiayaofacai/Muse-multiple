# Run with pwsh on a Windows desktop after cargo build (debug).
param([string]$Binary = "$PSScriptRoot/../../src-tauri/target/debug/muse-multiple.exe")
$ErrorActionPreference = 'Stop'
$exe = Get-Item -LiteralPath $Binary
if (-not $IsWindows -or $exe.Directory.Name -ne 'debug' -or $exe.Name -ne 'muse-multiple.exe') {
    throw 'Use a Windows debug build; only debug builds honor the temporary data directory.'
}
if (Get-Process -Name 'muse-multiple' -ErrorAction SilentlyContinue) { throw 'Close other Muse-multiple instances before running this check.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MuseWindow {
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32")] public static extern bool PostMessageW(IntPtr window, uint msg, IntPtr w, IntPtr l);
    public static IntPtr Shell(int pid) {
        var h = IntPtr.Zero;
        while ((h = FindWindowEx(IntPtr.Zero, h, "Tauri Window", null)) != IntPtr.Zero) {
            GetWindowThreadProcessId(h, out uint owner);
            if (owner == pid) return h;
        }
        return IntPtr.Zero;
    }
}
'@

$root = Join-Path ($env:PI_SCRATCH_DIR ?? [IO.Path]::GetTempPath()) (New-Guid).ToString()
$children = [Collections.Generic.List[Diagnostics.Process]]::new()
function Start-Workspace($data) {
    $start = [Diagnostics.ProcessStartInfo]::new($exe.FullName)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.Environment['MUSE_MULTIPLE_M0_DATA_DIR'] = $data
    $start.Environment['WEBVIEW2_USER_DATA_FOLDER'] = "$data-webview"
    $start.Environment['MUSE_MULTIPLE_M0_DEBUG'] = '0'
    $p = [Diagnostics.Process]::Start($start)
    $children.Add($p)
    return $p
}
function Wait-For($description, [scriptblock]$condition) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (& $condition)) {
        if ($timer.Elapsed.TotalSeconds -ge 15) { throw "Timed out: $description" }
        Start-Sleep -Milliseconds 50
    }
}
function Open-Again($data) {
    $second = Start-Workspace $data
    if (-not $second.WaitForExit(15000) -or $second.ExitCode -ne 0) { throw 'The second launch did not exit cleanly.' }
}
function Close-Shell($handle) {
    if (-not [MuseWindow]::PostMessageW($handle, 0x0010, 0, 0)) { throw 'Could not request window close.' }
}

try {
    $data = (New-Item -ItemType Directory -Path (Join-Path $root 'profile') -Force).FullName
    $a = Start-Workspace $data
    $b = Start-Workspace $data
    Wait-For 'one concurrent launch to exit' { $a.HasExited -or $b.HasExited }
    $first, $other = if ($a.HasExited) { $b, $a } else { $a, $b }
    if ($other.ExitCode -ne 0) { throw "Concurrent launch failed with exit code $($other.ExitCode)." }
    Wait-For 'the surviving shell' { [MuseWindow]::IsWindowVisible([MuseWindow]::Shell($first.Id)) }
    $handle = [MuseWindow]::Shell($first.Id)
    [void][MuseWindow]::ShowWindowAsync($handle, 6) # SW_MINIMIZE
    Wait-For 'minimized shell' { [MuseWindow]::IsIconic($handle) }
    $unused = Join-Path $root 'secondary-profile'
    Open-Again $unused
    Wait-For 'the same window to be restored' { [MuseWindow]::Shell($first.Id) -eq $handle -and -not [MuseWindow]::IsIconic($handle) }
    if (Test-Path -LiteralPath $unused) { throw 'The second launch initialized a workspace.' }

    Close-Shell $handle
    if (-not $first.WaitForExit(15000) -or $first.ExitCode -ne 0) { throw 'Closing in exit mode did not exit cleanly.' }
    # Reopen the same profile, now with the existing close-to-tray preference.
    @{closeBehavior='tray'; theme='system'; uiZoomPercent=100; webZoomPercent=100; autoSleepMinutes=15} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'settings.json') -Encoding utf8NoBOM
    $next = Start-Workspace $data
    Wait-For 'new window after exit' { [MuseWindow]::IsWindowVisible([MuseWindow]::Shell($next.Id)) }
    $nextHandle = [MuseWindow]::Shell($next.Id)
    Open-Again $data
    Close-Shell $nextHandle
    Wait-For 'shell hidden to tray' { -not [MuseWindow]::IsWindowVisible($nextHandle) }
    Open-Again $data
    Wait-For 'the original tray window' { [MuseWindow]::Shell($next.Id) -eq $nextHandle -and [MuseWindow]::IsWindowVisible($nextHandle) }
    'PASS: concurrent launches, minimized restore, exit/relaunch, tray restore.'
} finally {
    foreach ($p in $children) {
        if (-not $p.HasExited) { $p.Kill($true); [void]$p.WaitForExit(5000) }
        $p.Dispose()
    }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
