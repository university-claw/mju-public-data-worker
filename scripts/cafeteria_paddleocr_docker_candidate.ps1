param(
  [Parameter(Mandatory = $true)]
  [string] $ImagePath
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$imageFullPath = (Resolve-Path -LiteralPath $ImagePath).Path
$rootUri = New-Object System.Uri(($repoRoot.TrimEnd("\") + "\"))
$imageUri = New-Object System.Uri($imageFullPath)
$relativeImagePath = [System.Uri]::UnescapeDataString(
  $rootUri.MakeRelativeUri($imageUri).ToString()
).Replace("\", "/")
$dockerImage = if ($env:PADDLE_OCR_DOCKER_IMAGE) {
  $env:PADDLE_OCR_DOCKER_IMAGE
} else {
  "mju-cafeteria-paddleocr:local"
}

$dockerArgs = @(
  "run",
  "--rm",
  "-e", "PYTHONIOENCODING=utf-8",
  "-e", "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True",
  "-e", "PADDLE_OCR_DET_MODEL_NAME=$env:PADDLE_OCR_DET_MODEL_NAME",
  "-e", "PADDLE_OCR_REC_MODEL_NAME=$env:PADDLE_OCR_REC_MODEL_NAME",
  "-v", "${repoRoot}:/workspace",
  "-v", "mju-cafeteria-paddleocr-models:/root/.paddlex",
  "-w", "/workspace",
  $dockerImage,
  "python",
  "scripts/cafeteria_paddleocr_candidate.py",
  $relativeImagePath
)

& docker @dockerArgs
exit $LASTEXITCODE
