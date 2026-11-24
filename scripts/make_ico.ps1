Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap 128, 128
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Background: dark rounded rectangle or dark circle
$brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(18, 17, 16))
$g.FillEllipse($brushBg, 2, 2, 124, 124)

# Border: coral/gold
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(232, 148, 134), 6)
$g.DrawEllipse($pen, 5, 5, 118, 118)

# Text 'LS'
$font = New-Object System.Drawing.Font('Arial', 42, [System.Drawing.FontStyle]::Bold)
$brushText = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 148, 134))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF 0, 0, 128, 128
$g.DrawString('LS', $font, $brushText, $rect, $format)

$bmp.Save('C:\dich\public\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)

$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::OpenWrite('C:\dich\public\icon.ico')
$icon.Save($fs)
$fs.Close()

$bmp.Dispose()
$g.Dispose()
Write-Output "ICO created successfully"
