# Pravi PWA ikonice od logotipa (public\logo.png) — bez Node.js-a.
#
# Pokretanje iz korena projekta:
#   powershell -ExecutionPolicy Bypass -File scripts\generate-icons.ps1
#
# Skript sam pronalazi granice logotipa (odseca belu ivicu) i centrira ga
# na svakoj ikonici. Ako promeniš logo, samo zameni public\logo.png i
# pokreni ovo ponovo.

Add-Type -AssemblyName System.Drawing

$root   = Split-Path -Parent $PSScriptRoot
$logo   = Join-Path $root 'public\logo.png'
$OutDir = Join-Path $root 'public\icons'

if (-not (Test-Path $logo)) { throw "Nedostaje $logo" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$src = New-Object System.Drawing.Bitmap($logo)

# --- granice sadržaja: preskoči belu/providnu ivicu ---
$minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
        $p = $src.GetPixel($x, $y)
        if ($p.A -gt 30 -and ($p.R -lt 220 -or $p.G -lt 220 -or $p.B -lt 220)) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
if ($maxX -lt 0) { $minX = 0; $minY = 0; $maxX = $src.Width - 1; $maxY = $src.Height - 1 }
$crop = New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
Write-Output ("Logo: {0}x{1}, sadrzaj {2}x{3}" -f $src.Width, $src.Height, $crop.Width, $crop.Height)

function New-RoundedRectPath($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# $fill — koliki deo ikonice zauzima logo (maskable mora unutar "safe zone")
# $round — zaobljene ivice + tanka linija (za obične ikonice)
function New-Icon($size, $fill, $round, $file) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

    if ($round) {
        $bg = New-RoundedRectPath 0 0 $size $size ($size * 0.22)
        $g.FillPath($white, $bg)
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 231, 229, 228)), ([float]($size * 0.008))
        $g.DrawPath($pen, $bg)
        $pen.Dispose()
        $bg.Dispose()
    } else {
        $g.FillRectangle($white, 0, 0, $size, $size)
    }

    # logo, srazmerno uklopljen i centriran
    $box = $size * $fill
    $scale = [Math]::Min($box / $crop.Width, $box / $crop.Height)
    $w = $crop.Width * $scale
    $h = $crop.Height * $scale
    $dest = New-Object System.Drawing.RectangleF((($size - $w) / 2), (($size - $h) / 2), $w, $h)
    $g.DrawImage($src, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()
    $bmp.Save((Join-Path $OutDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $white.Dispose()
    Write-Output ("OK: public/icons/{0}" -f $file)
}

New-Icon 192 0.74 $true  'icon-192.png'
New-Icon 512 0.74 $true  'icon-512.png'
New-Icon 512 0.56 $false 'icon-maskable-512.png'   # safe zone za Android maske
New-Icon 180 0.66 $false 'apple-touch-icon.png'    # iOS sam zaobljava ivice

$src.Dispose()
Write-Output "Gotovo."
