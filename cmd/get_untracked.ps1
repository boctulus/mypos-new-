$untracked = git ls-files --others --exclude-standard

if ($untracked) {
    Write-Host "Hay archivos sin trackear:"
    Write-Host $untracked
    exit 1
}
