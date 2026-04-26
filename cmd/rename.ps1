$basePath = "public/uploads/dtes"

Get-ChildItem -Path $basePath -Recurse -Filter *.pdf | ForEach-Object {
    $oldName = $_.Name
    $newName = $oldName `
        -replace "factura", "factura-electronica" `
        -replace "boleta", "boleta-electronica"

    if ($oldName -ne $newName) {
        $newPath = Join-Path $_.DirectoryName $newName
        Rename-Item -Path $_.FullName -NewName $newName
        Write-Host "Renombrado: $oldName -> $newName"
    }
}
