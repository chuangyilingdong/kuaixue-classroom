$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path $PSScriptRoot -Parent
$courses = Get-Content -LiteralPath (Join-Path $root 'data\course-catalog.demo.json') -Raw -Encoding UTF8 | ConvertFrom-Json
for ($i=0; $i -lt $courses.Count; $i++) { Write-Host ("{0}. {1}" -f ($i+1), $courses[$i].title) }
$number = [int](Read-Host '选择课程编号'); if ($number -lt 1 -or $number -gt $courses.Count) { throw '课程编号无效' }
$targets = @('cover','gallery','intro','banner','work','focus'); $choice = [int](Read-Host '1 替换封面，2 追加预览图，3 追加介绍图，4 替换首页横幅，5 设为作品首图，6 调整卡片裁切焦点')
if ($choice -lt 1 -or $choice -gt 6) { throw '用途编号无效' }
if ($choice -eq 6) {
  $x = Read-Host '横向焦点 0 到 100（从左到右）'
  $y = Read-Host '纵向焦点 0 到 100（从上到下）'
  & node (Join-Path $PSScriptRoot 'import-course-images.mjs') $courses[$number-1].id focus $x $y
  exit $LASTEXITCODE
}
$picker = New-Object System.Windows.Forms.OpenFileDialog
$picker.Title = "选择课程图片 · $($courses[$number-1].title)"; $picker.Filter = '课程配图|*.png;*.jpg;*.jpeg;*.webp'; $picker.Multiselect = $choice -in @(2,3)
try {
  if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $files = $picker.FileNames
    & node (Join-Path $PSScriptRoot 'import-course-images.mjs') $courses[$number-1].id $targets[$choice-1] @files
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
} finally { $picker.Dispose() }
