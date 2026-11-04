# يحول ملف Word إلى PDF بنسخة Word الموجودة بالجهاز، بدون تعديل الملف الأصلي
# الاستخدام:  powershell -File tools/export_word.ps1 "ملف.docx" "ناتج.pdf"
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Output)
$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open((Resolve-Path $Source).Path, $false, $true, $false)
  $doc.ExportAsFixedFormat([IO.Path]::GetFullPath($Output), 17)
  "pages: " + $doc.ComputeStatistics(2)
  $doc.Close(0)
} finally { $word.Quit() }
