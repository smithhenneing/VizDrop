param(
  [int]$Port = 8321,
  [string]$Root = (Join-Path (Split-Path $PSScriptRoot -Parent) "vizdrop")
)
$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $Root at http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
  ".csv"  = "text/csv; charset=utf-8"
  ".tsv"  = "text/tab-separated-values; charset=utf-8"
  ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ".txt"  = "text/plain; charset=utf-8"
  ".woff2" = "font/woff2"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    # dev-only capture endpoint: POST base64 body -> saved under tools/_captures
    if ($ctx.Request.HttpMethod -eq "POST" -and $path -eq "/__save") {
      $name = $ctx.Request.QueryString["name"]
      if (-not $name) { $name = "capture.bin" }
      $name = [IO.Path]::GetFileName($name)
      $capDir = Join-Path $PSScriptRoot "_captures"
      if (-not (Test-Path $capDir)) { New-Item -ItemType Directory $capDir | Out-Null }
      $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
      $b64 = $reader.ReadToEnd()
      $reader.Close()
      $bytes = [Convert]::FromBase64String($b64)
      [IO.File]::WriteAllBytes((Join-Path $capDir $name), $bytes)
      $body = [Text.Encoding]::UTF8.GetBytes("saved " + $bytes.Length + " bytes")
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.OutputStream.Close()
      continue
    }
    if ($path.EndsWith("/")) { $path += "index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart("/") -replace "/", "\")))
    if (-not $file.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
      $res.StatusCode = 404
      $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
    } else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = "application/octet-stream" }
      $res.Headers.Add("Cache-Control", "no-store")
      $body = [IO.File]::ReadAllBytes($file)
    }
    $res.ContentLength64 = $body.Length
    $res.OutputStream.Write($body, 0, $body.Length)
    $res.OutputStream.Close()
  } catch {
    # keep serving on per-request errors
  }
}
