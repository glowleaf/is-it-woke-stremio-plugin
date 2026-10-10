@echo off
REM Launches the Stremio desktop shell with a WebView2 remote-debugging port so the app's own
REM page can be scripted (used once to install/reorder the Woke Score addon). The env var is
REM read by the WebView2 loader at startup.
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
start "" "C:\Users\alpha\AppData\Local\Programs\Stremio\stremio-shell-ng.exe"
