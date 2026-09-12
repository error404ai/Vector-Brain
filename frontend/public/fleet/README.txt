Drop screen recordings here as run-1.mp4 ... run-6.mp4

Recording a clip (PowerShell, emulator or a paired phone):

  $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
  & $adb shell screenrecord --time-limit 10 --size 540x1170 --bit-rate 1500000 /sdcard/run-1.mp4
  & $adb pull /sdcard/run-1.mp4 .

Run a real task while it records, so the footage is genuine.
Keep each clip to 5-10 seconds and under ~1 MB: they all autoplay at once.
Portrait only. If a file is missing the tile falls back to a placeholder screen,
so the page never breaks.
