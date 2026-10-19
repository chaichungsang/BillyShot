param(
  [Parameter(Mandatory = $true)][string]$InPath,
  [Parameter(Mandatory = $true)][string]$OutPath
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName PresentationCore
  $uri = New-Object System.Uri((Resolve-Path -LiteralPath $InPath).Path)
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
    $uri,
    [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
    [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
  if (-not $decoder.Frames -or $decoder.Frames.Count -lt 1) { throw 'no frame' }
  $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $enc.Frames.Add($decoder.Frames[0])
  $fs = [System.IO.File]::Open($OutPath, 'Create')
  try { $enc.Save($fs) } finally { $fs.Close() }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
