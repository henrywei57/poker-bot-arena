# Speaks each line of a manifest into its own WAV file with a built-in
# Windows voice (no internet, nothing to install).
#   powershell -File tts.ps1 -Manifest lines.json [-Voice "Microsoft Zira Desktop"] [-Rate 0]
# lines.json: [{ "file": "C:\\...\\001.wav", "text": "Hello." }, ...]
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Voice = 'Microsoft Zira Desktop',
  [int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = $Rate
foreach ($item in $items) {
  $synth.SetOutputToWaveFile($item.file, $format)
  $synth.Speak([string]$item.text)
}
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output "Spoke $($items.Count) lines with $Voice"
